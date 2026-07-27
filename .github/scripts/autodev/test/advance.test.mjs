import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  SCHEMA_VERSION,
  STATES,
  getArtifactPath,
} from '../config.mjs';
import { ContractValidationError, RESULT_OUTCOMES } from '../comments.mjs';
import { formatTaskComment } from '../task.mjs';
import { advanceState } from '../handlers/advance.mjs';

const ISSUE = 42;
const HEAD_REF = 'autodev/issue-42';
const SHA_INIT = '0000000000000000000000000000000000000001';
const SHA_RESEARCH = '0000000000000000000000000000000000000002';
const SHA_DESIGN = '0000000000000000000000000000000000000003';
const SHA_SECURITY = '0000000000000000000000000000000000000004';

const RESEARCH_ARTIFACT = getArtifactPath(STATES.RESEARCH, ISSUE);
const DESIGN_ARTIFACT = getArtifactPath(STATES.DESIGN, ISSUE);
const SECURITY_ARTIFACT = getArtifactPath(STATES.SECURITY_REVIEW, ISSUE);

function taskComment({ sequence, state, headSha, attempt = 1, executionId = null }) {
  return {
    id: sequence,
    body: formatTaskComment({
      schemaVersion: SCHEMA_VERSION,
      issue: ISSUE,
      sequence,
      state,
      executionId,
      attempt,
      headRef: HEAD_REF,
      headSha,
      createdAt: '2026-07-27T12:00:00Z',
    }),
    user: { login: DEFAULT_ORCHESTRATOR_LOGIN },
  };
}

function result({
  state,
  nextState,
  headSha,
  attempt = 1,
  outcome = RESULT_OUTCOMES.SUCCESS,
  decisionRationale = 'Ready.',
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    issue: ISSUE,
    state,
    attempt,
    outcome,
    nextState,
    decisionRationale,
    headRef: HEAD_REF,
    headSha,
    artifacts: [],
  };
}

function makeGitHub({
  comments,
  liveHeadSha,
  compareFiles = [],
  pullRequest = { number: 77, html_url: 'https://example.test/pull/77' },
} = {}) {
  const dispatched = [];
  const posted = [];
  const compareCalls = [];
  const github = {
    async getIssueComments() {
      return comments;
    },
    async getRepository() {
      return { default_branch: 'main' };
    },
    async getRef(ref) {
      assert.equal(ref, `heads/${HEAD_REF}`);
      return { object: { sha: liveHeadSha } };
    },
    async compareCommits(base, head) {
      compareCalls.push({ base, head });
      return { files: compareFiles.map((filename) => ({ filename, status: 'modified' })) };
    },
    async findPullRequest(request) {
      assert.deepEqual(request, { head: HEAD_REF, base: 'main' });
      return pullRequest;
    },
    async dispatchWorkflow(workflowFileName, ref, inputs) {
      dispatched.push({ workflowFileName, ref, inputs });
    },
    async createIssueComment(_issueNumber, body) {
      posted.push(body);
      return { id: 900 + posted.length, body };
    },
  };
  return { github, dispatched, posted, compareCalls };
}

test('advanceState launches Research from the Initialization handoff', async () => {
  const { github, dispatched, posted } = makeGitHub({
    comments: [taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT })],
    liveHeadSha: SHA_INIT,
  });

  const outcome = await advanceState({
    github,
    issueNumber: ISSUE,
    result: result({
      state: STATES.INITIALIZATION,
      nextState: STATES.RESEARCH,
      headSha: SHA_INIT,
      decisionRationale: 'Branch and pull request are ready.',
    }),
    correlationId: 'corr-init',
    now: () => new Date('2026-07-27T12:00:00Z'),
  });

  assert.equal(outcome.status, 'state-advanced');
  assert.equal(outcome.fromState, STATES.INITIALIZATION);
  assert.equal(outcome.state, STATES.RESEARCH);
  assert.equal(outcome.task.sequence, 2);
  assert.equal(outcome.task.headSha, SHA_INIT);
  assert.equal(outcome.task.attempt, 1);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].workflowFileName, 'autodev-research.lock.yml');
  assert.deepEqual(dispatched[0].inputs, {
    issue_number: '42',
    head_ref: HEAD_REF,
    head_sha: SHA_INIT,
    pull_request_number: '77',
    artifact_path: RESEARCH_ARTIFACT,
    attempt: '1',
    correlation_id: 'corr-init',
    feedback: 'Branch and pull request are ready.',
  });
  assert.match(posted[0], /autodev-task:v1/);
});

test('advanceState honors a dispatchRef override', async () => {
  const { github, dispatched } = makeGitHub({
    comments: [taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT })],
    liveHeadSha: SHA_INIT,
  });

  await advanceState({
    github,
    issueNumber: ISSUE,
    dispatchRef: 'release/candidate',
    result: result({ state: STATES.INITIALIZATION, nextState: STATES.RESEARCH, headSha: SHA_INIT }),
  });

  assert.equal(dispatched[0].ref, 'release/candidate');
});

test('advanceState rejects a blank dispatchRef override', async () => {
  await assert.rejects(
    advanceState({
      github: {},
      issueNumber: ISSUE,
      dispatchRef: '   ',
      result: result({ state: STATES.INITIALIZATION, nextState: STATES.RESEARCH, headSha: SHA_INIT }),
    }),
    (error) => error instanceof TypeError && /dispatchRef/.test(error.message),
  );
});

test('advanceState rejects an Initialization handoff when the branch head drifted', async () => {
  const { github } = makeGitHub({
    comments: [taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT })],
    liveHeadSha: SHA_RESEARCH,
  });

  await assert.rejects(
    advanceState({
      github,
      issueNumber: ISSUE,
      result: result({ state: STATES.INITIALIZATION, nextState: STATES.RESEARCH, headSha: SHA_INIT }),
    }),
    (error) => error instanceof ContractValidationError && error.code === 'stale-head-sha',
  );
});

test('advanceState ignores a duplicate handoff once the target already exists', async () => {
  const { github, dispatched } = makeGitHub({
    comments: [
      taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
      taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT, executionId: 'corr-existing' }),
    ],
    liveHeadSha: SHA_INIT,
  });

  const outcome = await advanceState({
    github,
    issueNumber: ISSUE,
    result: result({ state: STATES.INITIALIZATION, nextState: STATES.RESEARCH, headSha: SHA_INIT }),
  });

  assert.equal(outcome.status, 'ignored');
  assert.equal(outcome.reason, 'already-advanced');
  assert.equal(dispatched.length, 0);
});

test('advanceState launches Design after validating the Research artifact diff', async () => {
  const { github, dispatched, compareCalls } = makeGitHub({
    comments: [
      taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
      taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT, executionId: 'corr-research' }),
    ],
    liveHeadSha: SHA_RESEARCH,
    compareFiles: [RESEARCH_ARTIFACT],
  });

  const outcome = await advanceState({
    github,
    issueNumber: ISSUE,
    result: result({ state: STATES.RESEARCH, nextState: STATES.DESIGN, headSha: SHA_INIT, decisionRationale: 'Research complete.' }),
    correlationId: 'corr-design',
    now: () => new Date('2026-07-27T13:00:00Z'),
  });

  assert.equal(outcome.status, 'state-advanced');
  assert.equal(outcome.fromState, STATES.RESEARCH);
  assert.equal(outcome.state, STATES.DESIGN);
  assert.equal(outcome.task.sequence, 3);
  // Design records the re-resolved post-Research head, not the stale callback SHA.
  assert.equal(outcome.task.headSha, SHA_RESEARCH);
  assert.deepEqual(compareCalls, [{ base: SHA_INIT, head: SHA_RESEARCH }]);
  assert.equal(dispatched[0].workflowFileName, 'autodev-design.lock.yml');
  assert.equal(dispatched[0].inputs.head_sha, SHA_RESEARCH);
  assert.equal(dispatched[0].inputs.artifact_path, DESIGN_ARTIFACT);
  assert.equal(dispatched[0].inputs.attempt, '1');
  assert.equal(dispatched[0].inputs.feedback, 'Research complete.');
});

test('advanceState rejects a producer that committed nothing', async () => {
  const { github } = makeGitHub({
    comments: [
      taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
      taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT }),
    ],
    liveHeadSha: SHA_INIT,
  });

  await assert.rejects(
    advanceState({
      github,
      issueNumber: ISSUE,
      result: result({ state: STATES.RESEARCH, nextState: STATES.DESIGN, headSha: SHA_INIT }),
    }),
    (error) => error instanceof ContractValidationError && error.code === 'missing-source-commit',
  );
});

test('advanceState rejects a producer that did not write its required artifact', async () => {
  const { github } = makeGitHub({
    comments: [
      taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
      taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT }),
    ],
    liveHeadSha: SHA_RESEARCH,
    compareFiles: ['autodev/issues/42/notes.md'],
  });

  await assert.rejects(
    advanceState({
      github,
      issueNumber: ISSUE,
      result: result({ state: STATES.RESEARCH, nextState: STATES.DESIGN, headSha: SHA_INIT }),
    }),
    (error) => error instanceof ContractValidationError && error.code === 'missing-source-artifact',
  );
});

test('advanceState rejects a producer that changed files outside its policy', async () => {
  const { github } = makeGitHub({
    comments: [
      taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
      taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT }),
    ],
    liveHeadSha: SHA_RESEARCH,
    compareFiles: [RESEARCH_ARTIFACT, 'src/app.js'],
  });

  await assert.rejects(
    advanceState({
      github,
      issueNumber: ISSUE,
      result: result({ state: STATES.RESEARCH, nextState: STATES.DESIGN, headSha: SHA_INIT }),
    }),
    (error) => error instanceof ContractValidationError && error.code === 'disallowed-source-changes',
  );
});

test('advanceState launches SecurityReview after Design', async () => {
  const { github, dispatched } = makeGitHub({
    comments: [
      taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
      taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT }),
      taskComment({ sequence: 3, state: STATES.DESIGN, headSha: SHA_RESEARCH }),
    ],
    liveHeadSha: SHA_DESIGN,
    compareFiles: [DESIGN_ARTIFACT],
  });

  const outcome = await advanceState({
    github,
    issueNumber: ISSUE,
    result: result({ state: STATES.DESIGN, nextState: STATES.SECURITY_REVIEW, headSha: SHA_RESEARCH }),
    correlationId: 'corr-security',
  });

  assert.equal(outcome.state, STATES.SECURITY_REVIEW);
  assert.equal(outcome.task.sequence, 4);
  assert.equal(outcome.task.headSha, SHA_DESIGN);
  assert.equal(dispatched[0].workflowFileName, 'autodev-security-review.lock.yml');
  assert.equal(dispatched[0].inputs.artifact_path, SECURITY_ARTIFACT);
  assert.equal(dispatched[0].inputs.attempt, '1');
});

test('advanceState re-enters Research from a Design feedback loop with an incremented attempt', async () => {
  const { github, dispatched } = makeGitHub({
    comments: [
      taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
      taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT, attempt: 1 }),
      taskComment({ sequence: 3, state: STATES.DESIGN, headSha: SHA_RESEARCH, attempt: 1 }),
    ],
    liveHeadSha: SHA_DESIGN,
    compareFiles: [DESIGN_ARTIFACT],
  });

  const outcome = await advanceState({
    github,
    issueNumber: ISSUE,
    result: result({
      state: STATES.DESIGN,
      nextState: STATES.RESEARCH,
      headSha: SHA_RESEARCH,
      decisionRationale: 'Need more research on the auth flow.',
    }),
    correlationId: 'corr-research-2',
  });

  assert.equal(outcome.state, STATES.RESEARCH);
  assert.equal(outcome.task.sequence, 4);
  assert.equal(outcome.task.attempt, 2);
  assert.equal(dispatched[0].workflowFileName, 'autodev-research.lock.yml');
  assert.equal(dispatched[0].inputs.attempt, '2');
  assert.equal(dispatched[0].inputs.head_sha, SHA_DESIGN);
  assert.equal(dispatched[0].inputs.feedback, 'Need more research on the auth flow.');
});

test('advanceState re-enters Design from a SecurityReview feedback loop', async () => {
  const { github, dispatched } = makeGitHub({
    comments: [
      taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
      taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT, attempt: 1 }),
      taskComment({ sequence: 3, state: STATES.DESIGN, headSha: SHA_RESEARCH, attempt: 1 }),
      taskComment({ sequence: 4, state: STATES.SECURITY_REVIEW, headSha: SHA_DESIGN, attempt: 1 }),
    ],
    liveHeadSha: SHA_SECURITY,
    compareFiles: [SECURITY_ARTIFACT],
  });

  const outcome = await advanceState({
    github,
    issueNumber: ISSUE,
    result: result({ state: STATES.SECURITY_REVIEW, nextState: STATES.DESIGN, headSha: SHA_DESIGN }),
    correlationId: 'corr-design-2',
  });

  assert.equal(outcome.state, STATES.DESIGN);
  assert.equal(outcome.task.sequence, 5);
  assert.equal(outcome.task.attempt, 2);
  assert.equal(dispatched[0].workflowFileName, 'autodev-design.lock.yml');
  assert.equal(dispatched[0].inputs.attempt, '2');
  assert.equal(dispatched[0].inputs.head_sha, SHA_SECURITY);
});

test('advanceState ignores a stale callback whose source is not the current state', async () => {
  const { github, dispatched } = makeGitHub({
    comments: [
      taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
      taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT }),
      taskComment({ sequence: 3, state: STATES.DESIGN, headSha: SHA_RESEARCH }),
      taskComment({ sequence: 4, state: STATES.SECURITY_REVIEW, headSha: SHA_DESIGN }),
    ],
    liveHeadSha: SHA_SECURITY,
  });

  const outcome = await advanceState({
    github,
    issueNumber: ISSUE,
    result: result({ state: STATES.DESIGN, nextState: STATES.RESEARCH, headSha: SHA_RESEARCH }),
  });

  assert.equal(outcome.status, 'ignored');
  assert.equal(outcome.reason, 'stale-callback');
  assert.equal(dispatched.length, 0);
});

test('advanceState rejects a disallowed requested transition', async () => {
  const { github } = makeGitHub({
    comments: [
      taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
      taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT }),
    ],
    liveHeadSha: SHA_RESEARCH,
  });

  await assert.rejects(
    advanceState({
      github,
      issueNumber: ISSUE,
      result: result({ state: STATES.RESEARCH, nextState: STATES.SECURITY_REVIEW, headSha: SHA_INIT }),
    }),
    (error) => error instanceof ContractValidationError && error.code === 'invalid-transition',
  );
});

test('advanceState blocks when no tracking pull request exists', async () => {
  const { github } = makeGitHub({
    comments: [
      taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
      taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT }),
    ],
    liveHeadSha: SHA_RESEARCH,
    compareFiles: [RESEARCH_ARTIFACT],
    pullRequest: null,
  });

  await assert.rejects(
    advanceState({
      github,
      issueNumber: ISSUE,
      result: result({ state: STATES.RESEARCH, nextState: STATES.DESIGN, headSha: SHA_INIT }),
    }),
    (error) => error instanceof ContractValidationError && error.code === 'missing-tracking-pull-request',
  );
});
