// Validates the completed Research task and records Design as the new current
// state. Milestone 4 will replace the dry-run Design task with a real agent.
import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  SCHEMA_VERSION,
  STATES,
  getArtifactPath,
} from '../config.mjs';
import { ContractValidationError } from '../comments.mjs';
import { formatTaskComment } from '../task.mjs';
import { validateTransitionRequest } from '../transitions.mjs';
import { findDisallowedPaths } from '../validation.mjs';
import { loadCanonicalTask } from './shared.mjs';

const CALLBACK_TASK_STATES = Object.freeze(['in_progress', 'idle', 'completed']);

function taskTargetsBranch(task, headRef) {
  const branchArtifactMatches = task.artifacts?.some(
    (artifact) => artifact.type === 'branch' && artifact.data?.head_ref === headRef,
  );
  const sessionMatches = task.sessions?.some((session) => session.head_ref === headRef);
  return branchArtifactMatches === true || sessionMatches === true;
}

export async function enterDesign({
  github,
  agentTasks,
  issueNumber,
  result,
  orchestratorLogin = DEFAULT_ORCHESTRATOR_LOGIN,
  now = () => new Date(),
}) {
  const canonical = await loadCanonicalTask({
    github,
    issueNumber,
    orchestratorLogin,
  });
  const currentTask = canonical.task;
  validateTransitionRequest(currentTask, result);

  if (currentTask.state !== STATES.RESEARCH || currentTask.executionId === null) {
    throw new ContractValidationError(
      'invalid-research-task',
      'Design can begin only after a recorded Research Agent Task.',
    );
  }

  const execution = await agentTasks.getTask(currentTask.executionId);
  if (!CALLBACK_TASK_STATES.includes(execution.state)) {
    throw new ContractValidationError(
      'invalid-agent-task-state',
      `Research task ${execution.id} cannot complete from state ${execution.state}.`,
    );
  }
  if (!taskTargetsBranch(execution, currentTask.headRef)) {
    throw new ContractValidationError(
      'agent-task-branch-mismatch',
      `Research task ${execution.id} does not target ${currentTask.headRef}.`,
    );
  }

  const branch = await github.getRef(`heads/${currentTask.headRef}`);
  if (branch?.object?.sha !== result.headSha) {
    throw new ContractValidationError(
      'branch-head-mismatch',
      `Reported SHA ${result.headSha} is not the head of ${currentTask.headRef}.`,
    );
  }

  const comparison = await github.compareCommits(currentTask.headSha, result.headSha);
  const changedPaths = comparison.files.flatMap((file) => [
    file.filename,
    ...(file.previous_filename ? [file.previous_filename] : []),
  ]);
  const disallowedPaths = findDisallowedPaths(STATES.RESEARCH, issueNumber, changedPaths);
  if (disallowedPaths.length > 0) {
    throw new ContractValidationError(
      'disallowed-research-change',
      `Research changed disallowed files: ${disallowedPaths.join(', ')}.`,
    );
  }

  const artifactPath = getArtifactPath(STATES.RESEARCH, issueNumber);
  if (
    result.artifacts.length !== 1
    || result.artifacts[0] !== artifactPath
  ) {
    throw new ContractValidationError(
      'invalid-research-artifacts',
      `Research must report only ${artifactPath}.`,
    );
  }
  const artifact = await github.getContent(artifactPath, result.headSha);
  if (artifact?.type !== 'file') {
    throw new ContractValidationError(
      'missing-research-artifact',
      `Research artifact ${artifactPath} does not exist at ${result.headSha}.`,
    );
  }

  const task = {
    schemaVersion: SCHEMA_VERSION,
    issue: issueNumber,
    sequence: currentTask.sequence + 1,
    state: STATES.DESIGN,
    executionId: null,
    attempt: 1,
    headRef: currentTask.headRef,
    headSha: result.headSha,
    createdAt: now().toISOString(),
  };
  const comment = await github.createIssueComment(
    issueNumber,
    formatTaskComment(
      task,
      '### AutoDev Research completed\n\nResearch was validated. Design is next and remains a dry-run until Milestone 4.',
    ),
  );

  return Object.freeze({
    status: 'design-ready',
    task: Object.freeze(task),
    execution,
    comment,
  });
}
