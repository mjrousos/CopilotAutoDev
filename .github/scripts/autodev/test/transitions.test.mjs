import assert from 'node:assert/strict';
import test from 'node:test';

import { SCHEMA_VERSION, STATES } from '../config.mjs';
import {
  ContractValidationError,
  RESULT_OUTCOMES,
} from '../comments.mjs';
import {
  assertAllowedTransition,
  isAllowedTransition,
  validateTransitionRequest,
} from '../transitions.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const NEXT_SHA = '89abcdef0123456789abcdef0123456789abcdef';

function createCurrentTask(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    issue: 42,
    sequence: 1,
    state: STATES.RESEARCH,
    executionId: 'task-123',
    attempt: 1,
    headRef: 'autodev/issue-42',
    headSha: SHA,
    createdAt: '2026-07-22T17:00:00Z',
    ...overrides,
  };
}

function createResult(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    issue: 42,
    state: STATES.RESEARCH,
    attempt: 1,
    outcome: RESULT_OUTCOMES.SUCCESS,
    nextState: STATES.DESIGN,
    decisionRationale: 'Work completed.',
    headRef: 'autodev/issue-42',
    headSha: NEXT_SHA,
    artifacts: ['autodev/issues/42/research.md'],
    ...overrides,
  };
}

test('transition graph includes feedback loops and terminal behavior', () => {
  assert.equal(isAllowedTransition(STATES.DESIGN, STATES.RESEARCH), true);
  assert.equal(isAllowedTransition(STATES.DESIGN, STATES.SECURITY_REVIEW), true);
  assert.equal(isAllowedTransition(STATES.SECURITY_REVIEW, STATES.DESIGN), true);
  assert.equal(isAllowedTransition(STATES.HUMAN_CODE_REVIEW, STATES.COMPLETED), true);
  assert.equal(isAllowedTransition(STATES.COMPLETED, STATES.RESEARCH), false);
  assert.throws(
    () => assertAllowedTransition(STATES.RESEARCH, STATES.IMPLEMENTATION),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-transition',
  );
});

test('automated states can enter blocked and retry only to the blocked source state', () => {
  assert.equal(isAllowedTransition(STATES.DESIGN, STATES.BLOCKED), true);
  assert.equal(
    isAllowedTransition(STATES.BLOCKED, STATES.DESIGN, { blockedFromState: STATES.DESIGN }),
    true,
  );
  assert.equal(
    isAllowedTransition(STATES.BLOCKED, STATES.RESEARCH, { blockedFromState: STATES.DESIGN }),
    false,
  );
  assert.equal(isAllowedTransition(STATES.HUMAN_PLAN_REVIEW, STATES.BLOCKED), false);
});

test('automated transition requests must match current state and attempt', () => {
  assert.equal(
    validateTransitionRequest(createCurrentTask(), createResult()).nextState,
    STATES.DESIGN,
  );
  assert.throws(
    () => validateTransitionRequest(createCurrentTask(), createResult({ attempt: 2 })),
    (error) => error instanceof ContractValidationError && error.code === 'attempt-mismatch',
  );
  assert.throws(
    () => validateTransitionRequest(
      createCurrentTask(),
      createResult({ state: STATES.DESIGN }),
    ),
    (error) => error instanceof ContractValidationError && error.code === 'state-mismatch',
  );
});

test('initialization hands off to research as an automated success', () => {
  const current = createCurrentTask({
    state: STATES.INITIALIZATION,
    executionId: null,
    headSha: SHA,
  });
  const handoff = createResult({
    state: STATES.INITIALIZATION,
    nextState: STATES.RESEARCH,
    headSha: SHA,
    artifacts: [],
  });

  assert.equal(validateTransitionRequest(current, handoff).nextState, STATES.RESEARCH);
  assert.throws(
    () => validateTransitionRequest(current, { ...handoff, headSha: NEXT_SHA }),
    (error) => error instanceof ContractValidationError && error.code === 'sha-mismatch',
  );
});

test('human plan approval and changes requests map to fixed transitions', () => {
  const current = createCurrentTask({
    state: STATES.HUMAN_PLAN_REVIEW,
    executionId: null,
    headSha: NEXT_SHA,
  });

  const approved = createResult({
    state: STATES.HUMAN_PLAN_REVIEW,
    outcome: RESULT_OUTCOMES.APPROVED,
    nextState: STATES.IMPLEMENTATION,
    headSha: NEXT_SHA,
    artifacts: [],
  });
  assert.equal(validateTransitionRequest(current, approved).nextState, STATES.IMPLEMENTATION);

  const changesRequested = {
    ...approved,
    outcome: RESULT_OUTCOMES.CHANGES_REQUESTED,
    nextState: STATES.DESIGN,
  };
  assert.equal(validateTransitionRequest(current, changesRequested).nextState, STATES.DESIGN);
});

test('blocked retry uses the preceding task state', () => {
  const current = createCurrentTask({
    state: STATES.BLOCKED,
    executionId: null,
    headSha: NEXT_SHA,
  });
  const retry = createResult({
    state: STATES.BLOCKED,
    outcome: RESULT_OUTCOMES.RETRY,
    nextState: STATES.DESIGN,
    headSha: NEXT_SHA,
    artifacts: [],
  });

  assert.equal(
    validateTransitionRequest(current, retry, { blockedFromState: STATES.DESIGN }).nextState,
    STATES.DESIGN,
  );
  assert.throws(
    () => validateTransitionRequest(current, retry, { blockedFromState: STATES.RESEARCH }),
    (error) => error instanceof ContractValidationError
      && error.code === 'outcome-transition-mismatch',
  );
});

test('CodeReview is validated as a standard Agentic Workflow state', () => {
  const current = createCurrentTask({
    state: STATES.CODE_REVIEW,
    executionId: 'review-correlation',
  });
  const result = createResult({
    state: STATES.CODE_REVIEW,
    nextState: STATES.HUMAN_CODE_REVIEW,
    artifacts: [],
  });

  // A single AGENTIC_WORKFLOW handler type covers every automated state, so the
  // transition validator no longer enforces head-SHA immutability for reviews.
  // CodeReview expresses its read-only nature through its workflow safe outputs
  // (it declares no push output), not through a distinct handler type. A result
  // is accepted whether or not it changes the head SHA.
  assert.doesNotThrow(() => validateTransitionRequest(current, result));
  assert.doesNotThrow(() => validateTransitionRequest(current, { ...result, headSha: SHA }));

  // It is still an automated state, so a non-success (human) outcome is rejected.
  assert.throws(
    () => validateTransitionRequest(current, { ...result, outcome: RESULT_OUTCOMES.APPROVED }),
    (error) => error instanceof ContractValidationError,
  );
});
