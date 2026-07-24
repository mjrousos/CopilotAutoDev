import assert from 'node:assert/strict';
import test from 'node:test';

import { SCHEMA_VERSION, STATES } from '../config.mjs';
import {
  ContractValidationError,
  RESULT_MARKER,
  RESULT_OUTCOMES,
  formatDecisionBlock,
  formatResultComment,
  formatVersionedMarker,
  parseDecisionBlock,
  parseResultComment,
  validateResultRecord,
} from '../comments.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

function createResult(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    issue: 42,
    state: STATES.RESEARCH,
    attempt: 1,
    outcome: RESULT_OUTCOMES.SUCCESS,
    nextState: STATES.DESIGN,
    decisionRationale: 'Research is complete.',
    headRef: 'autodev/issue-42',
    headSha: SHA,
    artifacts: ['autodev/issues/42/research.md'],
    ...overrides,
  };
}

function formatResult(result) {
  return formatVersionedMarker(RESULT_MARKER, result);
}

test('automated result comments round-trip', () => {
  const result = createResult();
  const comment = formatResult(result);
  assert.deepEqual(parseResultComment(comment, 42), result);
});

test('markers are fenced code blocks, not HTML comments, so safe-output sanitization keeps them', () => {
  // gh-aw strips HTML/XML comments from agent-authored comment bodies; the
  // marker must be a fenced code block to survive and retrigger the orchestrator.
  const marker = formatVersionedMarker(RESULT_MARKER, createResult());
  assert.match(marker, /^```autodev-result:v1\n/);
  assert.match(marker, /\n```$/);
  assert.doesNotMatch(marker, /<!--/);
  assert.deepEqual(parseResultComment(marker, 42), createResult());
});

test('the marker parser requires the fence immediately before the name, matching the workflow filter', () => {
  // The orchestrator's coarse trigger filter matches the exact
  // '```autodev-result:v1' substring, so a space after the fence must NOT parse;
  // otherwise a JS-valid callback would never trigger the workflow.
  assert.equal(parseResultComment('``` autodev-result:v1\n{}\n```', 42), null);
  assert.match(formatVersionedMarker(RESULT_MARKER, createResult()), /```autodev-result:v1/);
});

test('human results use the same marker with human outcomes', () => {
  const result = createResult({
    state: STATES.HUMAN_PLAN_REVIEW,
    outcome: RESULT_OUTCOMES.APPROVED,
    nextState: STATES.IMPLEMENTATION,
    decisionRationale: 'The plan is approved.',
    artifacts: [],
  });

  assert.deepEqual(parseResultComment(formatResult(result), 42), result);
});

test('initialization posts an automated success handoff to research', () => {
  const result = createResult({
    state: STATES.INITIALIZATION,
    nextState: STATES.RESEARCH,
    decisionRationale: 'Branch and pull request are ready.',
    artifacts: [],
  });

  assert.deepEqual(parseResultComment(formatResult(result), 42), result);
});

test('success results are rejected for states that are not automated-success states', () => {
  assert.throws(
    () => validateResultRecord(createResult({
      state: STATES.HUMAN_PLAN_REVIEW,
      nextState: STATES.IMPLEMENTATION,
      artifacts: [],
    })),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-automated-state',
  );
});

test('formatResultComment renders a visible summary with one parseable marker', () => {
  const result = createResult();
  const comment = formatResultComment(result, '### Research complete');
  assert.match(comment, /### Research complete/);
  assert.deepEqual(parseResultComment(comment, 42), result);
  assert.throws(
    () => formatResultComment(result, '   '),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-summary',
  );
});

test('retry is accepted only for blocked state', () => {
  assert.throws(
    () => validateResultRecord(createResult({
      outcome: RESULT_OUTCOMES.RETRY,
    })),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-retry-state',
  );

  assert.doesNotThrow(() => validateResultRecord(createResult({
    state: STATES.BLOCKED,
    outcome: RESULT_OUTCOMES.RETRY,
    nextState: STATES.DESIGN,
    artifacts: [],
  })));
});

test('result validation rejects malformed contracts', () => {
  assert.throws(
    () => validateResultRecord({ ...createResult(), extra: true }),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-fields',
  );
  assert.throws(
    () => validateResultRecord(createResult({ headSha: 'not-a-sha' })),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-sha',
  );
  assert.throws(
    () => validateResultRecord(createResult({ artifacts: ['../secret.txt'] })),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-artifact-path',
  );
});

test('result parser rejects unknown marker versions and invalid JSON', () => {
  assert.throws(
    () => parseResultComment('```autodev-result:v2\n{}\n```', 42),
    (error) => error instanceof ContractValidationError
      && error.code === 'unsupported-marker-version',
  );
  assert.throws(
    () => parseResultComment('```autodev-result:v1\n{broken}\n```', 42),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-json',
  );
});

test('decision blocks round-trip and are limited to decision states', () => {
  const decision = {
    schemaVersion: SCHEMA_VERSION,
    state: STATES.DESIGN,
    nextState: STATES.SECURITY_REVIEW,
    decisionRationale: 'The plan is ready for security review.',
  };
  assert.deepEqual(parseDecisionBlock(formatDecisionBlock(decision)), decision);

  assert.throws(
    () => formatDecisionBlock({ ...decision, state: STATES.RESEARCH }),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-decision-state',
  );
  assert.throws(
    () => formatDecisionBlock({ ...decision, nextState: STATES.COMPLETED }),
    (error) => error instanceof ContractValidationError
      && error.code === 'invalid-decision-transition',
  );
});
