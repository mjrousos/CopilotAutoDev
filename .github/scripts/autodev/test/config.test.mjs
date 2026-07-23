import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HANDLERS,
  LABELS,
  STATES,
  getArtifactPath,
  getIssueBranch,
  getStateChangePolicy,
  getStateHandler,
} from '../config.mjs';
import {
  findDisallowedPaths,
  isPathAllowedForState,
  isTrustedHumanAssociation,
  normalizeRepositoryPath,
} from '../validation.mjs';

test('state handlers and labels match the POC contract', () => {
  assert.equal(getStateHandler(STATES.RESEARCH), HANDLERS.AGENT_TASK);
  assert.equal(getStateHandler(STATES.CODE_REVIEW), HANDLERS.AGENTIC_WORKFLOW);
  assert.equal(getStateHandler(STATES.HUMAN_PLAN_REVIEW), HANDLERS.HUMAN);
  assert.deepEqual(Object.values(LABELS), [
    'autodev',
    'autodev/ready-for-plan-review',
    'autodev/ready-for-code-review',
    'autodev/blocked',
  ]);
});

test('branch and artifact paths are issue-specific', () => {
  assert.equal(getIssueBranch(42), 'autodev/issue-42');
  assert.equal(
    getArtifactPath(STATES.SECURITY_REVIEW, 42),
    '.github/autodev/issues/42/security-review.md',
  );
  assert.throws(() => getIssueBranch(0), /positive safe integer/);
});

test('documentation states can modify only their own artifact', () => {
  assert.equal(
    isPathAllowedForState(
      STATES.RESEARCH,
      42,
      '.github/autodev/issues/42/research.md',
    ),
    true,
  );
  assert.equal(
    isPathAllowedForState(
      STATES.RESEARCH,
      42,
      '.github/autodev/issues/42/design.md',
    ),
    false,
  );
});

test('implementation policy protects AutoDev control files and approved artifacts', () => {
  const policy = getStateChangePolicy(STATES.IMPLEMENTATION, 42);
  assert.deepEqual(policy.allowed, ['**']);
  assert.equal(isPathAllowedForState(STATES.IMPLEMENTATION, 42, 'src/app.js'), true);
  assert.equal(
    isPathAllowedForState(
      STATES.IMPLEMENTATION,
      42,
      '.github/autodev/issues/42/design.md',
    ),
    false,
  );
  assert.equal(
    isPathAllowedForState(
      STATES.IMPLEMENTATION,
      42,
      '.github/autodev/issues/99/research.md',
    ),
    false,
  );
  assert.equal(
    isPathAllowedForState(
      STATES.IMPLEMENTATION,
      42,
      '.github/scripts/autodev/task.mjs',
    ),
    false,
  );
  assert.deepEqual(
    findDisallowedPaths(STATES.IMPLEMENTATION, 42, [
      'src/app.js',
      '.github/workflows/autodev-orchestrator.yml',
    ]),
    ['.github/workflows/autodev-orchestrator.yml'],
  );
});

test('repository paths reject traversal and normalize separators', () => {
  assert.equal(normalizeRepositoryPath('.\\src\\app.js'), 'src/app.js');
  assert.throws(() => normalizeRepositoryPath('../secret.txt'), /cannot traverse/);
  assert.throws(() => normalizeRepositoryPath('C:\\secret.txt'), /must be relative/);
});

test('trusted human associations are explicit', () => {
  assert.equal(isTrustedHumanAssociation('OWNER'), true);
  assert.equal(isTrustedHumanAssociation('MEMBER'), true);
  assert.equal(isTrustedHumanAssociation('COLLABORATOR'), true);
  assert.equal(isTrustedHumanAssociation('CONTRIBUTOR'), false);
  assert.equal(isTrustedHumanAssociation('NONE'), false);
});
