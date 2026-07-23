import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  SCHEMA_VERSION,
  STATES,
  getIssueScaffoldPath,
} from '../config.mjs';
import { initializeIssue } from '../handlers/initialization.mjs';
import { parseResultComment } from '../comments.mjs';
import { formatTaskComment, parseTaskComment } from '../task.mjs';

const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';
const SEED_SHA = '89abcdef0123456789abcdef0123456789abcdef';
const HEAD_REF = 'autodev/issue-42';
const SCAFFOLD_PATH = getIssueScaffoldPath(42);

class FakeGitHub {
  constructor() {
    this.comments = [];
    this.createdBranches = [];
    this.files = [];
    this.pullRequests = [];
    this.repository = { default_branch: 'main' };
    this.refs = new Map([
      ['heads/main', { ref: 'refs/heads/main', object: { sha: BASE_SHA } }],
    ]);
    this.contents = new Map();
  }

  async getIssueComments() {
    return [...this.comments];
  }

  async getRepository() {
    return this.repository;
  }

  async getIssue() {
    return {
      title: 'Test issue',
      body: 'Research this.',
      html_url: 'https://github.com/octo/repo/issues/42',
    };
  }

  async getRef(ref) {
    return this.refs.get(ref) ?? null;
  }

  async createRef(ref, sha) {
    const created = { ref: `refs/${ref}`, object: { sha } };
    this.refs.set(ref, created);
    this.createdBranches.push(ref.replace(/^heads\//, ''));
    return created;
  }

  async getContent(path, branch) {
    return this.contents.get(`${branch}:${path}`) ?? null;
  }

  async createOrUpdateFile({ path, message, content, branch }) {
    this.files.push({ path, message, content, branch });
    this.contents.set(`${branch}:${path}`, { sha: 'blob-sha', path });
    this.refs.set(`heads/${branch}`, {
      ref: `refs/heads/${branch}`,
      object: { sha: SEED_SHA },
    });
    return { content: { path }, commit: { sha: SEED_SHA } };
  }

  async ensurePullRequest({ title, head, base, body }) {
    const existing = this.pullRequests.find((pr) => pr.head === head);
    if (existing) {
      return existing;
    }
    const number = 100 + this.pullRequests.length;
    const pullRequest = {
      number,
      html_url: `https://github.com/octo/repo/pull/${number}`,
      title,
      head,
      base,
      body,
    };
    this.pullRequests.push(pullRequest);
    return pullRequest;
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

  seedBranch() {
    this.refs.set(`heads/${HEAD_REF}`, {
      ref: `refs/heads/${HEAD_REF}`,
      object: { sha: SEED_SHA },
    });
    this.contents.set(`${HEAD_REF}:${SCAFFOLD_PATH}`, { sha: 'blob-sha', path: SCAFFOLD_PATH });
  }

  pushCanonical(task, login = DEFAULT_ORCHESTRATOR_LOGIN) {
    this.comments.push({
      id: this.comments.length + 1,
      body: formatTaskComment(task),
      user: { login },
    });
  }
}

class FakeCallbackGitHub {
  constructor() {
    this.comments = [];
  }

  async createIssueComment(_issueNumber, body) {
    const comment = {
      id: `callback-${this.comments.length + 1}`,
      body,
      user: { login: 'autodev-callback' },
    };
    this.comments.push(comment);
    return comment;
  }
}

function initializationTask(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    issue: 42,
    sequence: 1,
    state: STATES.INITIALIZATION,
    executionId: null,
    attempt: 1,
    headRef: HEAD_REF,
    headSha: SEED_SHA,
    createdAt: '2026-07-22T17:00:00Z',
    ...overrides,
  };
}

function researchTask() {
  return {
    schemaVersion: SCHEMA_VERSION,
    issue: 42,
    sequence: 2,
    state: STATES.RESEARCH,
    executionId: 'task-existing',
    attempt: 1,
    headRef: HEAD_REF,
    headSha: SEED_SHA,
    createdAt: '2026-07-23T12:00:00Z',
  };
}

test('initialization creates the branch, scaffold, pull request, canonical record, and handoff', async () => {
  const github = new FakeGitHub();
  const callbackGithub = new FakeCallbackGitHub();

  const result = await initializeIssue({
    github,
    callbackGithub,
    issueNumber: 42,
    now: () => new Date('2026-07-22T17:00:00Z'),
  });

  assert.equal(result.status, 'initialization-recorded');
  assert.deepEqual(github.createdBranches, [HEAD_REF]);
  assert.equal(github.files.length, 1);
  assert.equal(github.files[0].path, SCAFFOLD_PATH);
  assert.equal(github.files[0].branch, HEAD_REF);
  assert.equal(github.pullRequests.length, 1);

  // Canonical Initialization record is authored with the orchestrator identity.
  assert.equal(github.comments.length, 1);
  const canonicalTask = parseTaskComment(github.comments[0].body, 42);
  assert.equal(canonicalTask.state, STATES.INITIALIZATION);
  assert.equal(canonicalTask.sequence, 1);
  assert.equal(canonicalTask.executionId, null);
  assert.equal(canonicalTask.headSha, SEED_SHA);

  // The Research handoff is posted with the callback identity so it retriggers.
  assert.equal(callbackGithub.comments.length, 1);
  const handoff = parseResultComment(callbackGithub.comments[0].body, 42);
  assert.equal(handoff.state, STATES.INITIALIZATION);
  assert.equal(handoff.nextState, STATES.RESEARCH);
  assert.equal(handoff.outcome, 'success');
  assert.equal(handoff.headSha, SEED_SHA);
  assert.deepEqual(handoff.artifacts, []);
});

test('re-running before Research reuses the branch and PR and re-posts the handoff', async () => {
  const github = new FakeGitHub();
  const callbackGithub = new FakeCallbackGitHub();

  await initializeIssue({
    github,
    callbackGithub,
    issueNumber: 42,
    now: () => new Date('2026-07-22T17:00:00Z'),
  });
  const second = await initializeIssue({
    github,
    callbackGithub,
    issueNumber: 42,
    now: () => new Date('2026-07-22T17:01:00Z'),
  });

  assert.equal(second.status, 'initialization-recorded');
  assert.deepEqual(github.createdBranches, [HEAD_REF]);
  assert.equal(github.files.length, 1);
  assert.equal(github.pullRequests.length, 1);
  // Canonical record is written once; the handoff is re-posted to recover from
  // a possibly-lost first handoff.
  assert.equal(github.comments.length, 1);
  assert.equal(callbackGithub.comments.length, 2);
});

test('a partially-initialized branch resumes without resetting or re-seeding', async () => {
  const github = new FakeGitHub();
  const callbackGithub = new FakeCallbackGitHub();
  // A prior attempt created and seeded the branch but never recorded canonical
  // state, so the branch head has diverged from the default branch.
  github.seedBranch();

  const result = await initializeIssue({
    github,
    callbackGithub,
    issueNumber: 42,
    now: () => new Date('2026-07-22T17:00:00Z'),
  });

  assert.equal(result.status, 'initialization-recorded');
  assert.deepEqual(github.createdBranches, []);
  assert.equal(github.files.length, 0);
  assert.equal(github.pullRequests.length, 1);
  assert.equal(github.comments.length, 1);
  assert.equal(parseTaskComment(github.comments[0].body, 42).headSha, SEED_SHA);
  assert.equal(callbackGithub.comments.length, 1);
});

test('canonical Initialization with a lost handoff re-posts it on resume', async () => {
  const github = new FakeGitHub();
  const callbackGithub = new FakeCallbackGitHub();
  github.seedBranch();
  github.pushCanonical(initializationTask());
  github.pullRequests.push({ number: 100, html_url: 'https://x/100', head: HEAD_REF, base: 'main' });

  const result = await initializeIssue({ github, callbackGithub, issueNumber: 42 });

  assert.equal(result.status, 'initialization-recorded');
  assert.deepEqual(github.createdBranches, []);
  assert.equal(github.files.length, 0);
  assert.equal(github.pullRequests.length, 1);
  // No new canonical comment; only the handoff is re-posted with the recorded SHA.
  assert.equal(github.comments.length, 1);
  assert.equal(callbackGithub.comments.length, 1);
  assert.equal(parseResultComment(callbackGithub.comments[0].body, 42).headSha, SEED_SHA);
});

test('existing state past Initialization is returned without branch work', async () => {
  const github = new FakeGitHub();
  const callbackGithub = new FakeCallbackGitHub();
  github.pushCanonical(initializationTask());
  github.pushCanonical(researchTask());

  const result = await initializeIssue({ github, callbackGithub, issueNumber: 42 });

  assert.equal(result.status, 'already-initialized');
  assert.equal(result.task.state, STATES.RESEARCH);
  assert.deepEqual(github.createdBranches, []);
  assert.equal(github.files.length, 0);
  assert.equal(callbackGithub.comments.length, 0);
});

test('task markers from non-orchestrator authors do not block initialization', async () => {
  const github = new FakeGitHub();
  const callbackGithub = new FakeCallbackGitHub();
  github.pushCanonical(initializationTask(), 'untrusted-user');

  const result = await initializeIssue({
    github,
    callbackGithub,
    issueNumber: 42,
    now: () => new Date('2026-07-22T17:00:00Z'),
  });

  assert.equal(result.status, 'initialization-recorded');
  assert.deepEqual(github.createdBranches, [HEAD_REF]);
  assert.equal(result.errors[0].code, 'unauthorized-task-author');
});
