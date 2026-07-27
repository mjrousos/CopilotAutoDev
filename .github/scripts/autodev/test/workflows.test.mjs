import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { STATES, WORKFLOWS } from '../config.mjs';

async function readWorkflow(name) {
  const source = await readFile(
    new URL(`../../../workflows/${name}.md`, import.meta.url),
    'utf8',
  );
  const lock = await readFile(
    new URL(`../../../workflows/${name}.lock.yml`, import.meta.url),
    'utf8',
  );
  return { source, lock };
}

// Each producer workflow shares the same safe-output shape: it pushes only its
// artifact to the tracking pull request (no per-file allowlist; protected-files
// allowed) and posts exactly one autodev-result callback under the callback
// identity. These assertions guard the traits whose absence silently breaks a
// live run.
function assertProducerContract({ source, lock }) {
  assert.match(lock, /# This file was automatically generated/i);
  assert.match(source, /push-to-pull-request-branch:/);
  assert.match(source, /protected-files: "allowed"/);
  assert.doesNotMatch(source, /allowed-files:/);
  assert.match(source, /add-comment:/);
  assert.match(source, /AUTODEV_CALLBACK_TOKEN/);
  assert.match(source, /autodev-result:v1/);
  assert.match(source, /fetch-depth: 0/);
}

test('the configured workflow file names match the compiled lock files', async () => {
  for (const [state, lockName] of Object.entries(WORKFLOWS)) {
    const name = lockName.replace(/\.lock\.yml$/, '');
    const { lock } = await readWorkflow(name);
    assert.match(lock, /# This file was automatically generated/i, `${state} lock missing`);
  }
});

test('the Research workflow is committed and accepts feedback', async () => {
  const workflow = await readWorkflow('autodev-research');
  assertProducerContract(workflow);
  assert.equal(WORKFLOWS[STATES.RESEARCH], 'autodev-research.lock.yml');
  assert.match(workflow.source, /inputs\.feedback/);
  assert.match(workflow.source, /"nextState": "design"/);
});

test('the Design workflow consumes research and carries a decision block', async () => {
  const workflow = await readWorkflow('autodev-design');
  assertProducerContract(workflow);
  assert.equal(WORKFLOWS[STATES.DESIGN], 'autodev-design.lock.yml');
  // Design reads the research artifact and records its own decision block, and
  // may route forward to security-review or back to research.
  assert.match(workflow.source, /research\.md/);
  assert.match(workflow.source, /autodev-decision:v1/);
  assert.match(workflow.source, /"state": "design"/);
  assert.match(workflow.source, /security-review or research/);
});

test('the SecurityReview workflow reviews the design and carries a decision block', async () => {
  const workflow = await readWorkflow('autodev-security-review');
  assertProducerContract(workflow);
  assert.equal(WORKFLOWS[STATES.SECURITY_REVIEW], 'autodev-security-review.lock.yml');
  assert.match(workflow.source, /design\.md/);
  assert.match(workflow.source, /autodev-decision:v1/);
  assert.match(workflow.source, /"state": "security-review"/);
  assert.match(workflow.source, /human-plan-review or design/);
});
