// Shared helpers for AutoDev state handlers: canonical-state loading, the
// per-state attempt counter, and the validation that confirms a source state's
// committed output before the orchestrator advances to the next state. These are
// reused by every producer-advance handler so the logic lives in one place.
import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  STATES,
  getArtifactPath,
} from '../config.mjs';
import { ContractValidationError } from '../comments.mjs';
import { selectCanonicalTask } from '../task.mjs';
import { findDisallowedPaths } from '../validation.mjs';

function hasBlockingCanonicalErrors(selection) {
  return selection.errors.some((error) => error.code !== 'unauthorized-task-author');
}

export async function loadCanonicalTask({
  github,
  issueNumber,
  orchestratorLogin = DEFAULT_ORCHESTRATOR_LOGIN,
  required = true,
}) {
  const comments = await github.getIssueComments(issueNumber);
  const selection = selectCanonicalTask(comments, {
    issueNumber,
    isOrchestrator: (comment) => comment.user?.login === orchestratorLogin,
  });

  if (hasBlockingCanonicalErrors(selection)) {
    throw new ContractValidationError(
      'invalid-canonical-history',
      'AutoDev cannot continue because existing orchestrator task comments are invalid.',
    );
  }
  if (required && selection.task === null) {
    throw new ContractValidationError(
      'missing-canonical-task',
      'AutoDev cannot continue because no canonical task exists.',
    );
  }

  return selection;
}

// States that commit a required artifact when they run. Initialization and the
// human review states are not here: they do not produce a reviewable artifact,
// so their output is validated by head-SHA equality rather than by a diff.
export const PRODUCER_STATES = Object.freeze([
  STATES.RESEARCH,
  STATES.DESIGN,
  STATES.SECURITY_REVIEW,
]);

export function isProducerState(state) {
  return PRODUCER_STATES.includes(state);
}

// The GitHub compare endpoint returns at most 300 file entries. A diff at that
// size is likely truncated, so a change-policy check could miss files beyond the
// cap; a legitimate producer only writes its single artifact, so a capped diff
// is treated as unvalidatable rather than trusted.
export const MAX_COMPARISON_FILES = 300;

// The most recent attempt recorded for a state, or 0 if it has never run. A
// re-entry (feedback loop) launches the target at prior attempt + 1.
export function priorAttemptForState(history, state) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].state === state) {
      return history[index].attempt;
    }
  }
  return 0;
}

// Confirms the source state's committed output and returns the branch head SHA
// the target task should record. For a producer source it re-resolves the live
// head (the callback echoes the stale pre-dispatch SHA), requires linear history
// from the SHA recorded at launch, and validates the committed diff against the
// source's change policy. For a non-producer source (Initialization handoff or a
// human review) no producer ran, so the head must be unchanged.
export async function resolveTargetHeadSha({ github, currentTask, issueNumber }) {
  const liveHead = await github.getRef(`heads/${currentTask.headRef}`);
  const liveHeadSha = liveHead?.object?.sha;
  if (typeof liveHeadSha !== 'string' || liveHeadSha.length === 0) {
    throw new ContractValidationError(
      'missing-branch-head',
      `Issue branch ${currentTask.headRef} has no resolvable head.`,
    );
  }

  if (!isProducerState(currentTask.state)) {
    if (liveHeadSha !== currentTask.headSha) {
      throw new ContractValidationError(
        'stale-head-sha',
        `Issue branch ${currentTask.headRef} head ${liveHeadSha} no longer matches `
          + `the recorded head ${currentTask.headSha}.`,
      );
    }
    return currentTask.headSha;
  }

  if (liveHeadSha === currentTask.headSha) {
    throw new ContractValidationError(
      'missing-source-commit',
      `${currentTask.state} reported success but committed no change to ${currentTask.headRef}.`,
    );
  }
  const comparison = await github.compareCommits(currentTask.headSha, liveHeadSha);
  // compareCommits is a three-dot diff (base...head) computed from the merge
  // base. Trust it only when the recorded SHA IS that merge base, i.e. the live
  // head descends from it — the append-only invariant the issue branch holds. A
  // diverged branch (force-push, rebase) would omit changes relative to the
  // recorded head, so reject rather than validate a partial list.
  if (comparison?.merge_base_commit?.sha !== currentTask.headSha) {
    throw new ContractValidationError(
      'divergent-branch-head',
      `Issue branch ${currentTask.headRef} head ${liveHeadSha} does not descend from `
        + `the recorded head ${currentTask.headSha}.`,
    );
  }
  const files = Array.isArray(comparison?.files) ? comparison.files : [];
  if (files.length >= MAX_COMPARISON_FILES) {
    throw new ContractValidationError(
      'diff-too-large',
      `${currentTask.state} changed at least ${MAX_COMPARISON_FILES} files, which exceeds the `
        + 'number the orchestrator can validate against its change policy.',
    );
  }
  // A renamed file changes both its new path and its previous_filename, so both
  // are subject to the source's change policy; extracting only filename would let
  // a rename move a disallowed control file onto the artifact path.
  const changedPaths = [];
  for (const file of files) {
    if (typeof file?.filename === 'string') {
      changedPaths.push(file.filename);
    }
    if (typeof file?.previous_filename === 'string') {
      changedPaths.push(file.previous_filename);
    }
  }
  // Check the required deliverable first so a producer that committed the wrong
  // files reports the missing artifact rather than only the disallowed paths.
  // The artifact must be present as a real write (added/modified/renamed), not
  // merely referenced by a removal or a rename away from it.
  const sourceArtifact = getArtifactPath(currentTask.state, issueNumber);
  const artifactEntry = files.find((file) => file?.filename === sourceArtifact);
  if (!artifactEntry || artifactEntry.status === 'removed') {
    throw new ContractValidationError(
      'missing-source-artifact',
      `${currentTask.state} did not produce its required artifact ${sourceArtifact}.`,
    );
  }
  const disallowed = findDisallowedPaths(currentTask.state, issueNumber, changedPaths);
  if (disallowed.length > 0) {
    throw new ContractValidationError(
      'disallowed-source-changes',
      `${currentTask.state} changed files outside its policy: ${disallowed.join(', ')}.`,
    );
  }
  return liveHeadSha;
}
