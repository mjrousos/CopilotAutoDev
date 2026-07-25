// Launches the Research state in the follow-up orchestrator run triggered by the
// Initialization handoff result. It validates the Initialization -> Research
// transition against canonical state, then dispatches the autodev-research
// Agentic Workflow (the worker), which commits the artifact and posts the
// callback.
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  SCHEMA_VERSION,
  STATES,
  WORKFLOWS,
  getArtifactPath,
} from '../config.mjs';
import { ContractValidationError } from '../comments.mjs';
import { formatTaskComment } from '../task.mjs';
import { validateTransitionRequest } from '../transitions.mjs';
import { loadCanonicalTask } from './shared.mjs';

// Runs in the follow-up orchestrator execution triggered by the Initialization
// handoff result. It validates the Initialization -> Research transition against
// canonical state, then dispatches the Research Agentic Workflow to run on the
// shared issue branch's tracking pull request.
export async function advanceToResearch({
  github,
  issueNumber,
  orchestratorLogin = DEFAULT_ORCHESTRATOR_LOGIN,
  result,
  dispatchRef,
  correlationId = randomUUID(),
  now = () => new Date(),
}) {
  if (
    dispatchRef !== undefined
    && (typeof dispatchRef !== 'string' || dispatchRef.trim().length === 0)
  ) {
    throw new TypeError('dispatchRef must be a non-empty string when provided.');
  }

  const canonical = await loadCanonicalTask({
    github,
    issueNumber,
    orchestratorLogin,
    required: true,
  });
  const currentTask = canonical.task;

  if (currentTask.state !== STATES.INITIALIZATION) {
    // Today the only transition that resolves to Research is the
    // Initialization handoff. Once Design is implemented (Milestone 4), its
    // Design -> Research feedback loop will need routing that keys on the source
    // state rather than being funneled here and ignored.
    return Object.freeze({
      status: 'ignored',
      reason: 'research-already-started',
      state: currentTask.state,
    });
  }

  validateTransitionRequest(currentTask, result);

  // Guard against out-of-band branch changes (force-push, manual commits) since
  // Initialization recorded the head. Research must start from the exact SHA the
  // canonical Initialization task and handoff validated against; otherwise later
  // SHA-based validation would compare against a head Research never saw.
  const liveHead = await github.getRef(`heads/${currentTask.headRef}`);
  const liveHeadSha = liveHead?.object?.sha;
  if (liveHeadSha !== currentTask.headSha) {
    throw new ContractValidationError(
      'stale-head-sha',
      `Issue branch ${currentTask.headRef} head ${liveHeadSha ?? 'missing'} no longer matches `
        + `the recorded Initialization head ${currentTask.headSha}.`,
    );
  }

  const repository = await github.getRepository();
  const defaultBranch = repository.default_branch;
  if (typeof defaultBranch !== 'string' || defaultBranch.length === 0) {
    throw new ContractValidationError(
      'missing-default-branch',
      'Repository metadata does not contain a default branch.',
    );
  }

  // The Agentic Workflow commits through the push-to-pull-request-branch safe
  // output, which targets the issue branch's tracking pull request.
  const pullRequest = await github.findPullRequest({
    head: currentTask.headRef,
    base: defaultBranch,
  });
  if (!pullRequest || !Number.isSafeInteger(pullRequest.number)) {
    throw new ContractValidationError(
      'missing-tracking-pull-request',
      `No open tracking pull request found for ${currentTask.headRef}.`,
    );
  }

  const attempt = 1;
  const artifactPath = getArtifactPath(STATES.RESEARCH, issueNumber);
  await github.dispatchWorkflow(
    WORKFLOWS[STATES.RESEARCH],
    dispatchRef ?? defaultBranch,
    {
      issue_number: String(issueNumber),
      head_ref: currentTask.headRef,
      head_sha: currentTask.headSha,
      pull_request_number: String(pullRequest.number),
      artifact_path: artifactPath,
      attempt: String(attempt),
      correlation_id: correlationId,
    },
  );

  // workflow_dispatch does not return a run ID, so the caller-generated
  // correlation ID is the canonical executionId. Reconciliation correlates on it.
  const task = {
    schemaVersion: SCHEMA_VERSION,
    issue: issueNumber,
    sequence: currentTask.sequence + 1,
    state: STATES.RESEARCH,
    executionId: correlationId,
    attempt,
    headRef: currentTask.headRef,
    headSha: currentTask.headSha,
    createdAt: now().toISOString(),
  };
  const comment = await github.createIssueComment(
    issueNumber,
    formatTaskComment(
      task,
      `### AutoDev Research started\n\nDispatched \`${WORKFLOWS[STATES.RESEARCH]}\` for \`${currentTask.headRef}\` `
        + `(correlation \`${correlationId}\`).`,
    ),
  );

  return Object.freeze({
    status: 'research-started',
    task: Object.freeze(task),
    pullRequest,
    correlationId,
    comment,
  });
}
