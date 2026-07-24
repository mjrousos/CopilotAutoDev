import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  LABELS,
  SCHEMA_VERSION,
  STATES,
} from '../config.mjs';
import {
  RESULT_MARKER,
  RESULT_OUTCOMES,
  formatVersionedMarker,
} from '../comments.mjs';
import {
  determineState,
  dispatchAutoDevEvent,
} from '../dispatcher.mjs';
import { formatTaskComment } from '../task.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

class FakeGitHub {
  constructor() {
    this.comments = [];
  }

  async createIssueComment(_issueNumber, body) {
    const comment = {
      id: this.comments.length + 1,
      body,
      user: { login: DEFAULT_ORCHESTRATOR_LOGIN },
    };
    this.comments.push(comment);
    return comment;
  }
}

function createTask() {
  return {
    schemaVersion: SCHEMA_VERSION,
    issue: 42,
    sequence: 1,
    state: STATES.RESEARCH,
    executionId: null,
    attempt: 1,
    headRef: 'autodev/issue-42',
    headSha: SHA,
    createdAt: '2026-07-22T17:00:00Z',
  };
}

function createResultComment(outcome = RESULT_OUTCOMES.SUCCESS) {
  return formatVersionedMarker(RESULT_MARKER, {
    schemaVersion: SCHEMA_VERSION,
    issue: 42,
    state: outcome === RESULT_OUTCOMES.SUCCESS ? STATES.RESEARCH : STATES.HUMAN_PLAN_REVIEW,
    attempt: 1,
    outcome,
    nextState: outcome === RESULT_OUTCOMES.SUCCESS ? STATES.DESIGN : STATES.IMPLEMENTATION,
    decisionRationale: 'Ready.',
    headRef: 'autodev/issue-42',
    headSha: SHA,
    artifacts: [],
  });
}

test('only the trigger label initializes an issue', () => {
  assert.equal(determineState({
    eventName: 'issues',
    eventPayload: { action: 'labeled', label: { name: LABELS.TRIGGER } },
    issueNumber: 42,
  }).state, STATES.INITIALIZATION);

  assert.equal(determineState({
    eventName: 'issues',
    eventPayload: { action: 'labeled', label: { name: LABELS.BLOCKED } },
    issueNumber: 42,
  }).reason, 'non-trigger-label');
});

test('orchestrator and canonical comments are ignored defensively', () => {
  assert.equal(determineState({
    eventName: 'issue_comment',
    eventPayload: {
      issue: { number: 42 },
      comment: {
        body: 'anything',
        user: { login: DEFAULT_ORCHESTRATOR_LOGIN },
      },
    },
    issueNumber: 42,
  }).reason, 'orchestrator-comment');

  assert.equal(determineState({
    eventName: 'issue_comment',
    eventPayload: {
      issue: { number: 42 },
      comment: {
        body: formatTaskComment(createTask()),
        user: { login: 'other-bot' },
      },
    },
    issueNumber: 42,
  }).reason, 'canonical-task-comment');
});

test('trusted human results are recognized and untrusted ones are ignored', () => {
  const trusted = determineState({
    eventName: 'issue_comment',
    eventPayload: {
      issue: { number: 42 },
      comment: {
        body: createResultComment(RESULT_OUTCOMES.APPROVED),
        user: { login: 'maintainer' },
        author_association: 'MEMBER',
      },
    },
    issueNumber: 42,
  });
  assert.equal(trusted.state, STATES.IMPLEMENTATION);

  const untrusted = determineState({
    eventName: 'issue_comment',
    eventPayload: {
      issue: { number: 42 },
      comment: {
        body: createResultComment(RESULT_OUTCOMES.APPROVED),
        user: { login: 'contributor' },
        author_association: 'CONTRIBUTOR',
      },
    },
    issueNumber: 42,
  });
  assert.equal(untrusted.reason, 'untrusted-human-result');
});

test('automated results require the configured callback identity', () => {
  const eventPayload = {
    issue: { number: 42 },
    comment: {
      body: createResultComment(),
      user: { login: 'callback-user' },
      author_association: 'COLLABORATOR',
    },
  };

  assert.equal(determineState({
    eventName: 'issue_comment',
    eventPayload,
    issueNumber: 42,
    callbackLogin: 'CALLBACK-USER',
  }).state, STATES.DESIGN);

  assert.equal(determineState({
    eventName: 'issue_comment',
    eventPayload,
    issueNumber: 42,
    callbackLogin: 'different-user',
  }).reason, 'untrusted-automated-result');
});

test('invalid result comments receive a visible error without a transition', async () => {
  const github = new FakeGitHub();
  const result = await dispatchAutoDevEvent({
    github,
    eventName: 'issue_comment',
    eventPayload: {
      issue: { number: 42 },
      comment: {
        body: '```autodev-result:v1\n{broken}\n```',
        user: { login: 'callback-bot' },
        author_association: 'NONE',
      },
    },
    issueNumber: 42,
  });

  assert.equal(result.status, 'ignored');
  assert.equal(result.reason, 'invalid-event');
  assert.equal(github.comments.length, 1);
  assert.match(github.comments[0].body, /rejected this event/);
});

test('valid results for later milestones determine the state but defer its handler', async () => {
  const github = new FakeGitHub();
  const result = await dispatchAutoDevEvent({
    github,
    eventName: 'issue_comment',
    eventPayload: {
      issue: { number: 42 },
      comment: {
        body: createResultComment(RESULT_OUTCOMES.APPROVED),
        user: { login: 'maintainer' },
        author_association: 'MEMBER',
      },
    },
    issueNumber: 42,
  });

  assert.equal(result.status, 'deferred-state');
  assert.equal(result.state, STATES.IMPLEMENTATION);
  assert.equal(github.comments.length, 0);
});

function createHandoffComment() {
  return formatVersionedMarker(RESULT_MARKER, {
    schemaVersion: SCHEMA_VERSION,
    issue: 42,
    state: STATES.INITIALIZATION,
    attempt: 1,
    outcome: RESULT_OUTCOMES.SUCCESS,
    nextState: STATES.RESEARCH,
    decisionRationale: 'Branch and pull request are ready.',
    headRef: 'autodev/issue-42',
    headSha: SHA,
    artifacts: [],
  });
}

test('the initialization handoff result requests the research state', () => {
  assert.equal(determineState({
    eventName: 'issue_comment',
    eventPayload: {
      issue: { number: 42 },
      comment: {
        body: createHandoffComment(),
        user: { login: 'autodev-callback' },
        author_association: 'NONE',
      },
    },
    issueNumber: 42,
    callbackLogin: 'autodev-callback',
  }).state, STATES.RESEARCH);
});

test('an initialization handoff result launches Research in the follow-up run', async () => {
  const comments = [{
    id: 1,
    body: formatTaskComment({
      schemaVersion: SCHEMA_VERSION,
      issue: 42,
      sequence: 1,
      state: STATES.INITIALIZATION,
      executionId: null,
      attempt: 1,
      headRef: 'autodev/issue-42',
      headSha: SHA,
      createdAt: '2026-07-22T17:00:00Z',
    }),
    user: { login: DEFAULT_ORCHESTRATOR_LOGIN },
  }];
  const dispatched = [];
  const github = {
    async getIssueComments() {
      return comments;
    },
    async getRef() {
      return { object: { sha: SHA } };
    },
    async getRepository() {
      return { default_branch: 'main' };
    },
    async findPullRequest() {
      return { number: 55, html_url: 'https://example.test/pull/55' };
    },
    async dispatchWorkflow(workflowFileName, ref, inputs) {
      dispatched.push({ workflowFileName, ref, inputs });
    },
    async createIssueComment(_issueNumber, body) {
      comments.push({ id: comments.length + 1, body, user: { login: DEFAULT_ORCHESTRATOR_LOGIN } });
      return { id: comments.length, body };
    },
  };

  const result = await dispatchAutoDevEvent({
    github,
    eventName: 'issue_comment',
    eventPayload: {
      issue: { number: 42 },
      comment: {
        body: createHandoffComment(),
        user: { login: 'autodev-callback' },
        author_association: 'NONE',
      },
    },
    issueNumber: 42,
    callbackLogin: 'autodev-callback',
  });

  assert.equal(result.status, 'research-started');
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].workflowFileName, 'autodev-research.lock.yml');
  assert.equal(dispatched[0].ref, 'main');
  assert.equal(dispatched[0].inputs.head_ref, 'autodev/issue-42');
  assert.equal(dispatched[0].inputs.pull_request_number, '55');
});
