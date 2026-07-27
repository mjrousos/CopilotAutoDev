import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  LABELS,
  SCHEMA_VERSION,
  STATES,
  getArtifactPath,
} from '../config.mjs';
import { ContractValidationError, RESULT_OUTCOMES } from '../comments.mjs';
import { formatTaskComment } from '../task.mjs';
import { enterHumanPlanReview } from '../handlers/human-plan-review.mjs';
import { dispatchAutoDevEvent } from '../dispatcher.mjs';

const ISSUE = 42;
const HEAD_REF = 'autodev/issue-42';
const SHA_INIT = '0000000000000000000000000000000000000001';
const SHA_RESEARCH = '0000000000000000000000000000000000000002';
const SHA_DESIGN = '0000000000000000000000000000000000000003';
const SHA_SECURITY = '0000000000000000000000000000000000000004';

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

// Canonical history through a completed SecurityReview run.
function historyThroughSecurityReview() {
  return [
    taskComment({ sequence: 1, state: STATES.INITIALIZATION, headSha: SHA_INIT }),
    taskComment({ sequence: 2, state: STATES.RESEARCH, headSha: SHA_INIT }),
    taskComment({ sequence: 3, state: STATES.DESIGN, headSha: SHA_RESEARCH }),
    taskComment({ sequence: 4, state: STATES.SECURITY_REVIEW, headSha: SHA_DESIGN }),
  ];
}

function securityReviewResult() {
  return {
    schemaVersion: SCHEMA_VERSION,
    issue: ISSUE,
    state: STATES.SECURITY_REVIEW,
    attempt: 1,
    outcome: RESULT_OUTCOMES.SUCCESS,
    nextState: STATES.HUMAN_PLAN_REVIEW,
    decisionRationale: 'No blocking findings; ready for human plan review.',
    headRef: HEAD_REF,
    headSha: SHA_DESIGN,
    artifacts: [],
  };
}

function makeGitHub({
  comments,
  liveHeadSha = SHA_SECURITY,
  compareFiles = [SECURITY_ARTIFACT],
  mergeBaseSha,
} = {}) {
  const posted = [];
  const labels = [];
  const github = {
    async getIssueComments() {
      return comments;
    },
    async getRef(ref) {
      assert.equal(ref, `heads/${HEAD_REF}`);
      return { object: { sha: liveHeadSha } };
    },
    async compareCommits(base, head) {
      return {
        merge_base_commit: { sha: mergeBaseSha ?? base },
        files: compareFiles.map((file) => (
          typeof file === 'string' ? { filename: file, status: 'modified' } : file
        )),
        head,
      };
    },
    async createIssueComment(_issueNumber, body) {
      posted.push(body);
      return { id: 900 + posted.length, body, user: { login: DEFAULT_ORCHESTRATOR_LOGIN } };
    },
    async addLabels(_issueNumber, toAdd) {
      labels.push(...toAdd);
      return toAdd.map((name) => ({ name }));
    },
  };
  return { github, posted, labels };
}

test('enterHumanPlanReview records state, labels the issue, and posts instructions', async () => {
  const { github, posted, labels } = makeGitHub({ comments: historyThroughSecurityReview() });

  const outcome = await enterHumanPlanReview({
    github,
    issueNumber: ISSUE,
    result: securityReviewResult(),
    now: () => new Date('2026-07-27T15:00:00Z'),
  });

  assert.equal(outcome.status, 'awaiting-human-plan-review');
  assert.equal(outcome.task.state, STATES.HUMAN_PLAN_REVIEW);
  assert.equal(outcome.task.sequence, 5);
  assert.equal(outcome.task.attempt, 1);
  assert.equal(outcome.task.executionId, null);
  // The reviewer references the re-resolved post-SecurityReview head, not the
  // stale SHA echoed in the callback.
  assert.equal(outcome.task.headSha, SHA_SECURITY);

  assert.deepEqual(labels, [LABELS.READY_FOR_PLAN_REVIEW]);

  // First comment is the canonical task record; second is the human instructions.
  assert.match(posted[0], /autodev-task:v1/);
  assert.match(posted[1], /ready for human plan review/i);
  assert.match(posted[1], /autodev-result:v1/);
  assert.match(posted[1], new RegExp(`"headSha": "${SHA_SECURITY}"`));
  assert.match(posted[1], /"outcome": "approved"/);
  assert.match(posted[1], /"outcome": "changes-requested"/);
  assert.match(posted[1], /"nextState": "implementation"/);
  assert.match(posted[1], /"nextState": "design"/);
});

test('enterHumanPlanReview ignores a duplicate callback once already in review', async () => {
  const comments = [
    ...historyThroughSecurityReview(),
    taskComment({ sequence: 5, state: STATES.HUMAN_PLAN_REVIEW, headSha: SHA_SECURITY }),
  ];
  const { github, posted, labels } = makeGitHub({ comments });

  const outcome = await enterHumanPlanReview({
    github,
    issueNumber: ISSUE,
    result: securityReviewResult(),
  });

  assert.equal(outcome.status, 'ignored');
  assert.equal(outcome.reason, 'already-advanced');
  assert.equal(posted.length, 0);
  assert.equal(labels.length, 0);
});

test('enterHumanPlanReview rejects a SecurityReview that did not commit its artifact', async () => {
  const { github, labels } = makeGitHub({
    comments: historyThroughSecurityReview(),
    compareFiles: ['autodev/issues/42/notes.md'],
  });

  await assert.rejects(
    enterHumanPlanReview({ github, issueNumber: ISSUE, result: securityReviewResult() }),
    (error) => error instanceof ContractValidationError && error.code === 'missing-source-artifact',
  );
  assert.equal(labels.length, 0);
});

test('the SecurityReview -> human-plan-review callback routes through the dispatcher', async () => {
  const comments = historyThroughSecurityReview();
  const posted = [];
  const labels = [];
  const github = {
    async getIssueComments() {
      return comments;
    },
    async getRef() {
      return { object: { sha: SHA_SECURITY } };
    },
    async compareCommits(base, head) {
      return { merge_base_commit: { sha: base }, files: [{ filename: SECURITY_ARTIFACT, status: 'modified' }], head };
    },
    async createIssueComment(_issueNumber, body) {
      const comment = { id: 900 + posted.length, body, user: { login: DEFAULT_ORCHESTRATOR_LOGIN } };
      posted.push(comment);
      return comment;
    },
    async addLabels(_issueNumber, toAdd) {
      labels.push(...toAdd);
      return toAdd.map((name) => ({ name }));
    },
  };

  const result = await dispatchAutoDevEvent({
    github,
    eventName: 'issue_comment',
    eventPayload: {
      issue: { number: ISSUE },
      comment: {
        body: [
          'SecurityReview complete.',
          '',
          '```autodev-result:v1',
          JSON.stringify(securityReviewResult(), null, 2),
          '```',
        ].join('\n'),
        user: { login: 'autodev-callback' },
        author_association: 'NONE',
      },
    },
    issueNumber: ISSUE,
    callbackLogin: 'autodev-callback',
  });

  assert.equal(result.status, 'awaiting-human-plan-review');
  assert.equal(result.task.state, STATES.HUMAN_PLAN_REVIEW);
  assert.deepEqual(labels, [LABELS.READY_FOR_PLAN_REVIEW]);
});
