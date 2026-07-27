// Shared launcher for AutoDev's dispatched Agentic Workflow states (Research,
// Design, SecurityReview). It runs in the follow-up orchestrator execution
// triggered by an Initialization handoff or a producer's autodev-result
// callback. It validates the requested transition against canonical state,
// validates the source state's committed output, dispatches the target workflow
// on the issue branch's tracking pull request, and records the new canonical
// task. Milestone 4 intentionally shares one launcher across these states
// rather than duplicating orchestration logic per handler.
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  SCHEMA_VERSION,
  WORKFLOWS,
  getArtifactPath,
} from '../config.mjs';
import { ContractValidationError } from '../comments.mjs';
import { formatTaskComment } from '../task.mjs';
import { validateTransitionRequest } from '../transitions.mjs';
import {
  loadCanonicalTask,
  priorAttemptForState,
  resolveTargetHeadSha,
} from './shared.mjs';

export async function advanceState({
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
  const sourceState = currentTask.state;
  const targetState = result?.nextState;

  // Idempotency and stale-callback protection. The callback's declared source
  // must be the live canonical state. If canonical already sits at the target,
  // this transition was applied (a duplicate callback); otherwise the callback
  // is stale or out of order. Either way, do not act.
  if (result?.state !== sourceState) {
    return Object.freeze({
      status: 'ignored',
      reason: sourceState === targetState ? 'already-advanced' : 'stale-callback',
      state: sourceState,
    });
  }

  // Validate schema, attempt, ref, outcome, and that source -> target is allowed.
  validateTransitionRequest(currentTask, result);

  const workflowFile = WORKFLOWS[targetState];
  if (!workflowFile) {
    // Reached only if a later-milestone state is routed here before its workflow
    // exists; the dispatcher only routes implemented producer states today.
    throw new ContractValidationError(
      'missing-target-workflow',
      `No Agentic Workflow is configured for state ${String(targetState)}.`,
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

  // Confirm the source committed its output and resolve the head the target
  // records: the post-source commit for a producer, or the unchanged recorded
  // head for the Initialization handoff.
  const dispatchHeadSha = await resolveTargetHeadSha({ github, currentTask, issueNumber });

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

  const attempt = priorAttemptForState(canonical.history, targetState) + 1;
  const artifactPath = getArtifactPath(targetState, issueNumber);
  await github.dispatchWorkflow(
    workflowFile,
    dispatchRef ?? defaultBranch,
    {
      issue_number: String(issueNumber),
      head_ref: currentTask.headRef,
      head_sha: dispatchHeadSha,
      pull_request_number: String(pullRequest.number),
      artifact_path: artifactPath,
      attempt: String(attempt),
      correlation_id: correlationId,
      // The source's rationale is the change request on a feedback loop and the
      // completion summary on a forward step; the target workflow treats it as
      // untrusted context.
      feedback: result.decisionRationale,
    },
  );

  // workflow_dispatch does not return a run ID, so the caller-generated
  // correlation ID is the canonical executionId. Reconciliation correlates on it.
  const task = {
    schemaVersion: SCHEMA_VERSION,
    issue: issueNumber,
    sequence: currentTask.sequence + 1,
    state: targetState,
    executionId: correlationId,
    attempt,
    headRef: currentTask.headRef,
    headSha: dispatchHeadSha,
    createdAt: now().toISOString(),
  };
  const comment = await github.createIssueComment(
    issueNumber,
    formatTaskComment(
      task,
      `### AutoDev ${targetState} started\n\nDispatched \`${workflowFile}\` for \`${currentTask.headRef}\` `
        + `(attempt ${attempt}, correlation \`${correlationId}\`).`,
    ),
  );

  return Object.freeze({
    status: 'state-advanced',
    fromState: sourceState,
    state: targetState,
    task: Object.freeze(task),
    pullRequest,
    correlationId,
    comment,
  });
}
