import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRepository, resolveIssueNumber } from '../main.mjs';

test('repository coordinates are parsed from GITHUB_REPOSITORY', () => {
  assert.deepEqual(parseRepository('octo-org/octo-repo'), {
    owner: 'octo-org',
    repo: 'octo-repo',
  });
  assert.throws(() => parseRepository('invalid'), /owner\/repository/);
});

test('issue number is normalized consistently across event types', () => {
  assert.equal(resolveIssueNumber({
    eventName: 'issues',
    eventPayload: { issue: { number: 42 } },
  }), 42);
  assert.equal(resolveIssueNumber({
    eventName: 'issue_comment',
    eventPayload: { issue: { number: 43 } },
  }), 43);
  assert.equal(resolveIssueNumber({
    eventName: 'workflow_dispatch',
    eventPayload: { inputs: { issue_number: '44' } },
  }), 44);
  assert.equal(resolveIssueNumber({
    eventName: 'workflow_dispatch',
    eventPayload: {},
    inputIssueNumber: '45',
  }), 45);
});

test('invalid issue numbers fail explicitly', () => {
  assert.throws(() => resolveIssueNumber({
    eventName: 'workflow_dispatch',
    eventPayload: {},
    inputIssueNumber: 'not-a-number',
  }), /valid issue number/);
});
