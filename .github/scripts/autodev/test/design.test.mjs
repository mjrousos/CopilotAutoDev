import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  SCHEMA_VERSION,
  STATES,
} from '../config.mjs';
import { ContractValidationError, RESULT_OUTCOMES } from '../comments.mjs';
import { enterDesign } from '../handlers/design.mjs';
import { formatTaskComment } from '../task.mjs';

const START_SHA = '0123456789abcdef0123456789abcdef01234567';
const RESULT_SHA = '89abcdef0123456789abcdef0123456789abcdef';
const ARTIFACT = '.github/autodev/issues/42/research.md';

function createCurrentTask() {
  return {
    schemaVersion: SCHEMA_VERSION,
    issue: 42,
    sequence: 1,
    state: STATES.RESEARCH,
    executionId: 'research-task',
    attempt: 1,
    headRef: 'autodev/issue-42',
    headSha: START_SHA,
    createdAt: '2026-07-23T12:00:00Z',
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
    decisionRationale: 'Research is complete.',
    headRef: 'autodev/issue-42',
    headSha: RESULT_SHA,
    artifacts: [ARTIFACT],
    ...overrides,
  };
}

function createGitHub({
  changedFiles = [{ filename: ARTIFACT }],
  artifact = { type: 'file' },
} = {}) {
  const comments = [{
    id: 1,
    body: formatTaskComment(createCurrentTask()),
    user: { login: DEFAULT_ORCHESTRATOR_LOGIN },
  }];
  return {
    comments,
    async getIssueComments() {
      return [...comments];
    },
    async getRef() {
      return { object: { sha: RESULT_SHA } };
    },
    async compareCommits() {
      return { files: changedFiles };
    },
    async getContent() {
      return artifact;
    },
    async createIssueComment(_issueNumber, body) {
      const comment = {
        id: comments.length + 1,
        body,
        user: { login: DEFAULT_ORCHESTRATOR_LOGIN },
      };
      comments.push(comment);
      return comment;
    },
  };
}

function createAgentTasks(overrides = {}) {
  return {
    async getTask() {
      return {
        id: 'research-task',
        state: 'completed',
        artifacts: [{
          type: 'branch',
          data: { head_ref: 'autodev/issue-42', base_ref: 'main' },
        }],
        ...overrides,
      };
    },
  };
}

test('valid Research result advances the canonical task to Design', async () => {
  const github = createGitHub();
  const result = await enterDesign({
    github,
    agentTasks: createAgentTasks(),
    issueNumber: 42,
    result: createResult(),
    now: () => new Date('2026-07-23T13:00:00Z'),
  });

  assert.equal(result.status, 'design-ready');
  assert.equal(result.task.sequence, 2);
  assert.equal(result.task.state, STATES.DESIGN);
  assert.equal(result.task.executionId, null);
  assert.match(github.comments[1].body, /autodev-task:v1/);
});

test('Research result rejects files outside the Research artifact', async () => {
  await assert.rejects(
    enterDesign({
      github: createGitHub({
        changedFiles: [{ filename: ARTIFACT }, { filename: 'src/app.js' }],
      }),
      agentTasks: createAgentTasks(),
      issueNumber: 42,
      result: createResult(),
    }),
    (error) => error instanceof ContractValidationError
      && error.code === 'disallowed-research-change',
  );
});

test('Research result validates both sides of renamed files', async () => {
  await assert.rejects(
    enterDesign({
      github: createGitHub({
        changedFiles: [{
          filename: ARTIFACT,
          previous_filename: 'src/app.js',
        }],
      }),
      agentTasks: createAgentTasks(),
      issueNumber: 42,
      result: createResult(),
    }),
    (error) => error instanceof ContractValidationError
      && error.code === 'disallowed-research-change',
  );
});

test('Research result requires the artifact at the reported SHA', async () => {
  await assert.rejects(
    enterDesign({
      github: createGitHub({ artifact: null }),
      agentTasks: createAgentTasks(),
      issueNumber: 42,
      result: createResult(),
    }),
    (error) => error instanceof ContractValidationError
      && error.code === 'missing-research-artifact',
  );
});

test('Research result must correspond to the recorded Agent Task branch', async () => {
  await assert.rejects(
    enterDesign({
      github: createGitHub(),
      agentTasks: createAgentTasks({
        artifacts: [{
          type: 'branch',
          data: { head_ref: 'different-branch', base_ref: 'main' },
        }],
      }),
      issueNumber: 42,
      result: createResult(),
    }),
    (error) => error instanceof ContractValidationError
      && error.code === 'agent-task-branch-mismatch',
  );
});

test('Research result waits for the Agent Task to be completed', async () => {
  await assert.rejects(
    enterDesign({
      github: createGitHub(),
      agentTasks: createAgentTasks({ state: 'in_progress' }),
      issueNumber: 42,
      result: createResult(),
    }),
    (error) => error instanceof ContractValidationError
      && error.code === 'invalid-agent-task-state',
  );
});
