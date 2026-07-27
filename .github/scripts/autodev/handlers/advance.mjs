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
  STATES,
  WORKFLOWS,
  getArtifactPath,
} from '../config.mjs';
import { ContractValidationError } from '../comments.mjs';
import { formatTaskComment } from '../task.mjs';
import { validateTransitionRequest } from '../transitions.mjs';
import { findDisallowedPaths } from '../validation.mjs';
import { loadCanonicalTask } from './shared.mjs';

// States that commit a required artifact when they run. Initialization is not
// here: it hands off to Research without producing a reviewable artifact, so its
// output is validated by head-SHA equality rather than by a committed diff.
const PRODUCER_STATES = Object.freeze([
  STATES.RESEARCH,
  STATES.DESIGN,
  STATES.SECURITY_REVIEW,
]);

function isProducerState(state) {
  return PRODUCER_STATES.includes(state);
}

// The GitHub compare endpoint returns at most 300 file entries. A diff at that
// size is likely truncated, so the change-policy check below could miss files
// beyond the cap; a legitimate producer only writes its single artifact, so a
// capped diff is treated as unvalidatable rather than trusted.
const MAX_COMPARISON_FILES = 300;

// The most recent attempt recorded for a state, or 0 if it has never run. A
// re-entry (feedback loop) launches the target at prior attempt + 1.
function priorAttemptForState(history, state) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].state === state) {
      return history[index].attempt;
    }
  }
  return 0;
}

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

  const liveHead = await github.getRef(`heads/${currentTask.headRef}`);
  const liveHeadSha = liveHead?.object?.sha;
  if (typeof liveHeadSha !== 'string' || liveHeadSha.length === 0) {
    throw new ContractValidationError(
      'missing-branch-head',
      `Issue branch ${currentTask.headRef} has no resolvable head.`,
    );
  }

  let dispatchHeadSha;
  if (isProducerState(sourceState)) {
    // The source ran as a dispatched workflow and committed through its safe
    // output after posting the callback, so the callback echoes the pre-dispatch
    // SHA. Re-resolve the real head and validate the source's committed diff
    // against the SHA recorded when the source was launched.
    if (liveHeadSha === currentTask.headSha) {
      throw new ContractValidationError(
        'missing-source-commit',
        `${sourceState} reported success but committed no change to ${currentTask.headRef}.`,
      );
    }
    const comparison = await github.compareCommits(currentTask.headSha, liveHeadSha);
    // compareCommits is a three-dot diff (base...head), computed from the merge
    // base of the two commits. Trust it only when the recorded SHA IS that merge
    // base, i.e. the live head descends from it — the append-only invariant the
    // issue branch is supposed to hold. If the branch diverged (force-push or
    // rebase), the diff would omit changes made relative to the recorded head,
    // so reject rather than validate a partial file list.
    if (comparison?.merge_base_commit?.sha !== currentTask.headSha) {
      throw new ContractValidationError(
        'divergent-branch-head',
        `Issue branch ${currentTask.headRef} head ${liveHeadSha} does not descend from `
          + `the recorded head ${currentTask.headSha}.`,
      );
    }
    const files = Array.isArray(comparison?.files) ? comparison.files : [];
    // The compare endpoint caps files at 300; a diff that hits the cap may be
    // truncated, so the change-policy check could miss out-of-policy files
    // beyond it. Reject rather than validate a partial list.
    if (files.length >= MAX_COMPARISON_FILES) {
      throw new ContractValidationError(
        'diff-too-large',
        `${sourceState} changed at least ${MAX_COMPARISON_FILES} files, which exceeds the number `
          + 'the orchestrator can validate against its change policy.',
      );
    }
    // A renamed file changes both its new path and its previous_filename, so
    // both are subject to the source's change policy; extracting only filename
    // would let a rename move a disallowed control file onto the artifact path.
    const changedPaths = [];
    for (const file of files) {
      if (typeof file?.filename === 'string') {
        changedPaths.push(file.filename);
      }
      if (typeof file?.previous_filename === 'string') {
        changedPaths.push(file.previous_filename);
      }
    }
    // Check the required deliverable first so a producer that committed the
    // wrong files reports the missing artifact rather than only the disallowed
    // paths. The artifact must be present as a real write (added/modified/
    // renamed), not merely referenced by a removal or a rename away from it.
    const sourceArtifact = getArtifactPath(sourceState, issueNumber);
    const artifactEntry = files.find((file) => file?.filename === sourceArtifact);
    if (!artifactEntry || artifactEntry.status === 'removed') {
      throw new ContractValidationError(
        'missing-source-artifact',
        `${sourceState} did not produce its required artifact ${sourceArtifact}.`,
      );
    }
    const disallowed = findDisallowedPaths(sourceState, issueNumber, changedPaths);
    if (disallowed.length > 0) {
      throw new ContractValidationError(
        'disallowed-source-changes',
        `${sourceState} changed files outside its policy: ${disallowed.join(', ')}.`,
      );
    }
    dispatchHeadSha = liveHeadSha;
  } else {
    // Initialization handoff: no producer commit, so the branch head must still
    // match the SHA the orchestrator recorded before Research runs. Otherwise a
    // later SHA-based validation would compare against a head Research never saw.
    if (liveHeadSha !== currentTask.headSha) {
      throw new ContractValidationError(
        'stale-head-sha',
        `Issue branch ${currentTask.headRef} head ${liveHeadSha} no longer matches `
          + `the recorded head ${currentTask.headSha}.`,
      );
    }
    dispatchHeadSha = currentTask.headSha;
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
