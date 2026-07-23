import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  SCHEMA_VERSION,
  STATES,
} from '../config.mjs';
import { initializeIssue } from '../handlers/initialization.mjs';
import { formatTaskComment } from '../task.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

class FakeGitHub {
  constructor() {
    this.comments = [];
    this.createdBranches = [];
    this.repository = { default_branch: 'main' };
    this.refs = new Map([
      ['heads/main', { ref: 'refs/heads/main', object: { sha: SHA } }],
    ]);
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

  async createOrVerifyBranch(branch, expectedSha) {
    const ref = `heads/${branch}`;
    const existing = this.refs.get(ref);
    if (existing) {
      if (existing.object.sha !== expectedSha) {
        throw new Error('branch mismatch');
      }
      return existing;
    }

    const created = { ref: `refs/${ref}`, object: { sha: expectedSha } };
    this.refs.set(ref, created);
    this.createdBranches.push(branch);
    return created;
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

class FakeAgentTasks {
  constructor() {
    this.started = [];
  }

  async startTask(request) {
    this.started.push(request);
    return {
      id: 'research-task',
      state: 'queued',
      html_url: 'https://github.com/copilot/tasks/research-task',
    };
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

test('initialization creates one issue branch and one canonical comment', async () => {
  const github = new FakeGitHub();
  const agentTasks = new FakeAgentTasks();
  const result = await initializeIssue({
    github,
    agentTasks,
    issueNumber: 42,
    now: () => new Date('2026-07-22T17:00:00Z'),
  });

  assert.equal(result.status, 'research-started');
  assert.deepEqual(github.createdBranches, ['autodev/issue-42']);
  assert.equal(github.comments.length, 1);
  assert.match(github.comments[0].body, /autodev-task:v1/);
  assert.equal(result.task.state, STATES.RESEARCH);
  assert.equal(result.task.executionId, 'research-task');
  assert.equal(agentTasks.started.length, 1);
});

test('repeated initialization is idempotent', async () => {
  const github = new FakeGitHub();
  const agentTasks = new FakeAgentTasks();
  await initializeIssue({
    github,
    agentTasks,
    issueNumber: 42,
    now: () => new Date('2026-07-22T17:00:00Z'),
  });
  const second = await initializeIssue({
    github,
    agentTasks,
    issueNumber: 42,
    now: () => new Date('2026-07-22T17:01:00Z'),
  });

  assert.equal(second.status, 'already-initialized');
  assert.deepEqual(github.createdBranches, ['autodev/issue-42']);
  assert.equal(github.comments.length, 1);
  assert.equal(agentTasks.started.length, 1);
});

test('existing canonical state is returned without branch work', async () => {
  const github = new FakeGitHub();
  const agentTasks = new FakeAgentTasks();
  github.comments.push({
    id: 1,
    body: formatTaskComment(createTask()),
    user: { login: DEFAULT_ORCHESTRATOR_LOGIN },
  });

  const result = await initializeIssue({ github, agentTasks, issueNumber: 42 });
  assert.equal(result.status, 'already-initialized');
  assert.deepEqual(github.createdBranches, []);
});

test('task markers from non-orchestrator authors do not block initialization', async () => {
  const github = new FakeGitHub();
  const agentTasks = new FakeAgentTasks();
  github.comments.push({
    id: 1,
    body: formatTaskComment(createTask()),
    user: { login: 'untrusted-user' },
  });

  const result = await initializeIssue({
    github,
    agentTasks,
    issueNumber: 42,
    now: () => new Date('2026-07-22T17:00:00Z'),
  });

  assert.equal(result.status, 'research-started');
  assert.deepEqual(github.createdBranches, ['autodev/issue-42']);
  assert.equal(result.errors[0].code, 'unauthorized-task-author');
});
