// Enters the HumanPlanReview state. This runs in the orchestrator execution
// triggered by the SecurityReview -> human-plan-review callback. It validates
// that SecurityReview committed its artifact, records canonical HumanPlanReview
// state, applies the ready-for-plan-review label, and posts copy-paste
// instructions for a trusted human (or an external human-review tool) to approve
// or request changes. The orchestrator then waits: the human's decision arrives
// as its own autodev-result:v1 comment, which the dispatcher routes on its
// nextState (approve -> Implementation, changes-requested -> Design).
import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  LABELS,
  SCHEMA_VERSION,
  STATES,
  getIssueBranch,
} from '../config.mjs';
import { RESULT_MARKER, formatVersionedMarker } from '../comments.mjs';
import { formatTaskComment } from '../task.mjs';
import { validateTransitionRequest } from '../transitions.mjs';
import {
  loadCanonicalTask,
  priorAttemptForState,
  resolveTargetHeadSha,
} from './shared.mjs';

// Builds a ready-to-copy human result marker for one decision. A trusted human
// (or a human-review tool acting as one) posts an edited copy as a new comment.
function exampleResultMarker({ issueNumber, headRef, headSha, attempt, outcome, nextState, rationale }) {
  return formatVersionedMarker(RESULT_MARKER, {
    schemaVersion: SCHEMA_VERSION,
    issue: issueNumber,
    state: STATES.HUMAN_PLAN_REVIEW,
    attempt,
    outcome,
    nextState,
    decisionRationale: rationale,
    headRef,
    headSha,
    artifacts: [],
  });
}

function buildPlanReviewInstructions({ issueNumber, headRef, headSha, attempt }) {
  const approve = exampleResultMarker({
    issueNumber,
    headRef,
    headSha,
    attempt,
    outcome: 'approved',
    nextState: STATES.IMPLEMENTATION,
    rationale: 'Replace with why the plan is approved.',
  });
  const requestChanges = exampleResultMarker({
    issueNumber,
    headRef,
    headSha,
    attempt,
    outcome: 'changes-requested',
    nextState: STATES.DESIGN,
    rationale: 'Replace with the specific changes the plan needs.',
  });

  return [
    '### AutoDev is ready for human plan review',
    '',
    'The automated Research, Design, and SecurityReview stages are complete and '
      + `their artifacts are committed to \`${headRef}\`. AutoDev is now paused waiting `
      + 'for a trusted human reviewer (a repository owner, member, or collaborator) to '
      + 'approve the plan or request changes.',
    '',
    'To respond, add a **new issue comment** containing exactly one of the result '
      + 'markers below, edited with your rationale. Approving advances to '
      + 'Implementation; requesting changes returns to Design.',
    '',
    `The marker must reference the current head SHA \`${headSha}\`; do not edit the `
      + '`state`, `attempt`, `headRef`, or `headSha` fields.',
    '',
    '**Approve the plan:**',
    '',
    approve,
    '',
    '**Request changes:**',
    '',
    requestChanges,
  ].join('\n');
}

export async function enterHumanPlanReview({
  github,
  issueNumber,
  orchestratorLogin = DEFAULT_ORCHESTRATOR_LOGIN,
  result,
  now = () => new Date(),
}) {
  const canonical = await loadCanonicalTask({
    github,
    issueNumber,
    orchestratorLogin,
    required: true,
  });
  const currentTask = canonical.task;
  const sourceState = currentTask.state;
  const targetState = STATES.HUMAN_PLAN_REVIEW;

  // Idempotency and stale-callback protection, matching advanceState: the
  // callback's declared source must be the live canonical state. If canonical
  // already sits at HumanPlanReview the label and state were recorded by a prior
  // run; otherwise the callback is stale or out of order. Either way, do nothing.
  if (result?.state !== sourceState) {
    return Object.freeze({
      status: 'ignored',
      reason: sourceState === targetState ? 'already-advanced' : 'stale-callback',
      state: sourceState,
    });
  }

  // Validate schema, attempt, ref, outcome, and that SecurityReview -> the
  // HumanPlanReview transition is allowed.
  validateTransitionRequest(currentTask, result);

  // Confirm SecurityReview committed its artifact within policy and resolve the
  // real post-SecurityReview head the reviewer will reference.
  const headSha = await resolveTargetHeadSha({ github, currentTask, issueNumber });
  const headRef = getIssueBranch(issueNumber);
  const attempt = priorAttemptForState(canonical.history, targetState) + 1;

  // Record canonical HumanPlanReview state first so it is authoritative even if a
  // later step fails. HumanPlanReview has no execution id; a human drives it.
  const task = {
    schemaVersion: SCHEMA_VERSION,
    issue: issueNumber,
    sequence: currentTask.sequence + 1,
    state: targetState,
    executionId: null,
    attempt,
    headRef,
    headSha,
    createdAt: now().toISOString(),
  };
  const taskComment = await github.createIssueComment(
    issueNumber,
    formatTaskComment(
      task,
      `### AutoDev is awaiting human plan review\n\nRecorded HumanPlanReview for \`${headRef}\` `
        + `at \`${headSha}\` (attempt ${attempt}).`,
    ),
  );

  await github.addLabels(issueNumber, [LABELS.READY_FOR_PLAN_REVIEW]);

  const instructionComment = await github.createIssueComment(
    issueNumber,
    buildPlanReviewInstructions({ issueNumber, headRef, headSha, attempt }),
  );

  return Object.freeze({
    status: 'awaiting-human-plan-review',
    task: Object.freeze(task),
    label: LABELS.READY_FOR_PLAN_REVIEW,
    taskComment,
    instructionComment,
  });
}
