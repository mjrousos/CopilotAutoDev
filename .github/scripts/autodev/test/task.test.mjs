import assert from 'node:assert/strict';
import test from 'node:test';

import { SCHEMA_VERSION, STATES } from '../config.mjs';
import { ContractValidationError } from '../comments.mjs';
import {
  formatTaskComment,
  parseTaskComment,
  selectCanonicalTask,
  validateTaskRecord,
} from '../task.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

function createTask(overrides = {}) {
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

function createComment(id, task, login = 'github-actions[bot]') {
  return {
    id,
    body: formatTaskComment(task),
    user: { login },
  };
}

const isOrchestrator = (comment) => comment.user?.login === 'github-actions[bot]';

test('canonical task comments round-trip', () => {
  const task = createTask();
  const comment = formatTaskComment(task, 'Research started');
  assert.deepEqual(parseTaskComment(comment, 42), task);
});

test('task validation rejects schema, issue, state, execution, and timestamp errors', () => {
  assert.throws(
    () => validateTaskRecord(createTask({ schemaVersion: 2 })),
    (error) => error instanceof ContractValidationError
      && error.code === 'unsupported-schema-version',
  );
  assert.throws(
    () => validateTaskRecord(createTask(), 43),
    (error) => error instanceof ContractValidationError && error.code === 'issue-mismatch',
  );
  assert.throws(
    () => validateTaskRecord(createTask({ state: 'unknown' })),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-state',
  );
  assert.throws(
    () => validateTaskRecord(createTask({ executionId: '' })),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-execution-id',
  );
  assert.throws(
    () => validateTaskRecord(createTask({ createdAt: 'yesterday' })),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-timestamp',
  );
});

test('highest valid orchestrator-authored task sequence is selected', () => {
  const comments = [
    createComment(1, createTask({ state: STATES.INITIALIZATION, executionId: null })),
    createComment(2, createTask({
      sequence: 2,
      state: STATES.RESEARCH,
      executionId: 'task-456',
    })),
    createComment(3, createTask({ sequence: 9 }), 'untrusted-user'),
  ];

  const selection = selectCanonicalTask(comments, { issueNumber: 42, isOrchestrator });
  assert.equal(selection.task.sequence, 2);
  assert.equal(selection.comment.id, 2);
  assert.deepEqual(selection.errors.map((error) => error.code), ['unauthorized-task-author']);
});

test('canonical history must begin with Initialization', () => {
  const researchGenesis = selectCanonicalTask(
    [createComment(1, createTask())],
    { issueNumber: 42, isOrchestrator },
  );
  assert.equal(researchGenesis.task, null);
  assert.deepEqual(researchGenesis.errors.map((error) => error.code), ['invalid-task-history']);

  const initializationGenesis = selectCanonicalTask(
    [createComment(1, createTask({ state: STATES.INITIALIZATION, executionId: null }))],
    { issueNumber: 42, isOrchestrator },
  );
  assert.equal(initializationGenesis.task.state, STATES.INITIALIZATION);
});

test('duplicate sequences are excluded and reported', () => {
  const comments = [
    createComment(1, createTask({ state: STATES.INITIALIZATION, executionId: null })),
    createComment(2, createTask({ sequence: 2, state: STATES.DESIGN })),
    createComment(3, createTask({
      sequence: 2,
      state: STATES.DESIGN,
      executionId: 'task-other',
    })),
  ];

  const selection = selectCanonicalTask(comments, { issueNumber: 42, isOrchestrator });
  assert.equal(selection.task.sequence, 1);
  assert.deepEqual(
    selection.errors.map((error) => error.code),
    ['duplicate-sequence', 'duplicate-sequence'],
  );
});

test('malformed and wrong-issue task comments are ignored with errors', () => {
  const comments = [
    { id: 1, body: '<!-- autodev-task:v1\n{broken}\n-->', user: { login: 'github-actions[bot]' } },
    createComment(2, createTask({ issue: 99 })),
  ];

  const selection = selectCanonicalTask(comments, { issueNumber: 42, isOrchestrator });
  assert.equal(selection.task, null);
  assert.deepEqual(selection.errors.map((error) => error.code), ['invalid-json', 'issue-mismatch']);
});

test('canonical selection rejects sequence gaps', () => {
  const comments = [
    createComment(1, createTask({ state: STATES.INITIALIZATION, executionId: null })),
    createComment(2, createTask({
      sequence: 3,
      state: STATES.SECURITY_REVIEW,
    })),
  ];

  const selection = selectCanonicalTask(comments, { issueNumber: 42, isOrchestrator });
  assert.equal(selection.task.sequence, 1);
  assert.deepEqual(selection.errors.map((error) => error.code), ['invalid-task-history']);
});

test('canonical selection retains task history for recovery decisions', () => {
  const comments = [
    createComment(1, createTask({ state: STATES.INITIALIZATION, executionId: null })),
    createComment(2, createTask({
      sequence: 2,
      state: STATES.DESIGN,
      executionId: 'design-task',
    })),
    createComment(3, createTask({
      sequence: 3,
      state: STATES.BLOCKED,
      executionId: null,
    })),
    createComment(4, createTask({
      sequence: 4,
      state: STATES.RESEARCH,
      executionId: 'research-retry',
    })),
  ];

  const selection = selectCanonicalTask(comments, { issueNumber: 42, isOrchestrator });
  assert.equal(selection.task.sequence, 4);
  assert.deepEqual(
    selection.history.map((task) => task.state),
    [STATES.INITIALIZATION, STATES.DESIGN, STATES.BLOCKED, STATES.RESEARCH],
  );
});
