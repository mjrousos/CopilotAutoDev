import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  SCHEMA_VERSION,
  STATES,
} from '../config.mjs';
import { ContractValidationError, RESULT_OUTCOMES } from '../comments.mjs';
import { formatTaskComment } from '../task.mjs';
import {
  advanceToResearch,
} from '../handlers/research.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';


function initializationComment(headSha = SHA) {
  return {
    id: 1,
    body: formatTaskComment({
      schemaVersion: SCHEMA_VERSION,
      issue: 42,
      sequence: 1,
      state: STATES.INITIALIZATION,
      executionId: null,
      attempt: 1,
      headRef: 'autodev/issue-42',
      headSha,
      createdAt: '2026-07-22T17:00:00Z',
    }),
    user: { login: DEFAULT_ORCHESTRATOR_LOGIN },
  };
}

function handoffResult(headSha = SHA) {
  return {
    schemaVersion: SCHEMA_VERSION,
    issue: 42,
    state: STATES.INITIALIZATION,
    attempt: 1,
    outcome: RESULT_OUTCOMES.SUCCESS,
    nextState: STATES.RESEARCH,
    decisionRationale: 'Branch and pull request are ready.',
    headRef: 'autodev/issue-42',
    headSha,
    artifacts: [],
  };
}

test('advanceToResearch validates the handoff and dispatches the Research workflow', async () => {
  const comments = [initializationComment()];
  const posted = [];
  let dispatch;
  const github = {
    async getIssueComments() {
      return comments;
    },
    async getRef(ref) {
      assert.equal(ref, 'heads/autodev/issue-42');
      return { ref: `refs/${ref}`, object: { sha: SHA } };
    },
    async getRepository() {
      return { default_branch: 'main' };
    },
    async findPullRequest(request) {
      assert.deepEqual(request, { head: 'autodev/issue-42', base: 'main' });
      return { number: 77, html_url: 'https://example.test/pull/77' };
    },
    async dispatchWorkflow(workflowFileName, ref, inputs) {
      dispatch = { workflowFileName, ref, inputs };
    },
    async createIssueComment(_issueNumber, body) {
      posted.push(body);
      return { id: comments.length + posted.length, body };
    },
  };

  const result = await advanceToResearch({
    github,
    issueNumber: 42,
    result: handoffResult(),
    correlationId: 'corr-123',
    now: () => new Date('2026-07-23T12:00:00Z'),
  });

  assert.equal(result.status, 'research-started');
  assert.equal(result.task.sequence, 2);
  assert.equal(result.task.state, STATES.RESEARCH);
  assert.equal(result.task.headSha, SHA);
  assert.equal(result.task.executionId, 'corr-123');
  assert.equal(result.pullRequest.number, 77);

  assert.equal(dispatch.workflowFileName, 'autodev-research.lock.yml');
  assert.equal(dispatch.ref, 'main');
  assert.deepEqual(dispatch.inputs, {
    issue_number: '42',
    head_ref: 'autodev/issue-42',
    head_sha: SHA,
    pull_request_number: '77',
    artifact_path: 'autodev/issues/42/research.md',
    attempt: '1',
    correlation_id: 'corr-123',
  });
  assert.match(posted[0], /autodev-task:v1/);
});

test('advanceToResearch blocks when no tracking pull request exists', async () => {
  const github = {
    async getIssueComments() {
      return [initializationComment()];
    },
    async getRef(ref) {
      return { ref: `refs/${ref}`, object: { sha: SHA } };
    },
    async getRepository() {
      return { default_branch: 'main' };
    },
    async findPullRequest() {
      return null;
    },
    async dispatchWorkflow() {
      throw new Error('must not dispatch without a tracking pull request');
    },
  };

  await assert.rejects(
    advanceToResearch({ github, issueNumber: 42, result: handoffResult() }),
    (error) => error instanceof ContractValidationError
      && error.code === 'missing-tracking-pull-request',
  );
});

test('advanceToResearch rejects a blank dispatchRef override', async () => {
  await assert.rejects(
    advanceToResearch({
      github: {},
      issueNumber: 42,
      result: handoffResult(),
      dispatchRef: '   ',
    }),
    (error) => error instanceof TypeError && /dispatchRef/.test(error.message),
  );
});

test('advanceToResearch rejects a handoff when the branch head drifted', async () => {
  const comments = [initializationComment()];
  const github = {
    async getIssueComments() {
      return comments;
    },
    async getRef() {
      return { object: { sha: '1111111111111111111111111111111111111111' } };
    },
    async getRepository() {
      throw new Error('must reject before reading the repository');
    },
    async dispatchWorkflow() {
      throw new Error('Research must not dispatch from a drifted head');
    },
  };

  await assert.rejects(
    advanceToResearch({
      github,
      issueNumber: 42,
      result: handoffResult(),
    }),
    (error) => error instanceof ContractValidationError && error.code === 'stale-head-sha',
  );
});

test('advanceToResearch ignores handoffs once Research has already started', async () => {
  const comments = [
    initializationComment(),
    {
      id: 2,
      body: formatTaskComment({
        schemaVersion: SCHEMA_VERSION,
        issue: 42,
        sequence: 2,
        state: STATES.RESEARCH,
        executionId: 'corr-existing',
        attempt: 1,
        headRef: 'autodev/issue-42',
        headSha: SHA,
        createdAt: '2026-07-23T12:00:00Z',
      }),
      user: { login: DEFAULT_ORCHESTRATOR_LOGIN },
    },
  ];
  const github = {
    async getIssueComments() {
      return comments;
    },
    async dispatchWorkflow() {
      throw new Error('Research must not dispatch again');
    },
  };

  const result = await advanceToResearch({
    github,
    issueNumber: 42,
    result: handoffResult(),
  });

  assert.equal(result.status, 'ignored');
  assert.equal(result.reason, 'research-already-started');
});

test('the compiled Research workflow and its callback safe output are committed', async () => {
  const source = await readFile(
    new URL('../../../workflows/autodev-research.md', import.meta.url),
    'utf8',
  );
  const lock = await readFile(
    new URL('../../../workflows/autodev-research.lock.yml', import.meta.url),
    'utf8',
  );

  // The dispatched workflow file name must match config.WORKFLOWS[research].
  assert.match(lock, /# This file was automatically generated/i);
  // gh-aw validates the whole PR diff, which always includes the init scaffold,
  // so the worker does not use a per-file allowlist; protected-files: allowed
  // lets the scaffold through and the orchestrator's change policy is the
  // authoritative guard. The worker pushes to the PR and calls back via the
  // callback identity with the autodev-result marker.
  assert.match(source, /push-to-pull-request-branch:/);
  assert.match(source, /protected-files: "allowed"/);
  assert.doesNotMatch(source, /allowed-files:/);
  assert.match(source, /add-comment:/);
  assert.match(source, /AUTODEV_CALLBACK_TOKEN/);
  assert.match(source, /autodev-result:v1/);
});
