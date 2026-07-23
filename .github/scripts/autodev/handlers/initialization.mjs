// Idempotent Initialization handler. It creates the issue branch and publishes
// the first canonical task snapshot; Milestone 3 will replace the dry-run task.
import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  SCHEMA_VERSION,
  STATES,
  getIssueBranch,
} from '../config.mjs';
import { ContractValidationError } from '../comments.mjs';
import {
  formatTaskComment,
  selectCanonicalTask,
} from '../task.mjs';

function hasBlockingCanonicalErrors(selection) {
  return selection.errors.some((error) => error.code !== 'unauthorized-task-author');
}

export async function initializeIssue({
  github,
  issueNumber,
  orchestratorLogin = DEFAULT_ORCHESTRATOR_LOGIN,
  now = () => new Date(),
}) {
  const comments = await github.getIssueComments(issueNumber);
  const canonical = selectCanonicalTask(comments, {
    issueNumber,
    isOrchestrator: (comment) => comment.user?.login === orchestratorLogin,
  });

  if (canonical.task !== null) {
    return Object.freeze({
      status: 'already-initialized',
      task: canonical.task,
      errors: canonical.errors,
    });
  }
  if (hasBlockingCanonicalErrors(canonical)) {
    // Do not create a second history when existing orchestrator comments are
    // malformed or ambiguous. A human must resolve the canonical history first.
    throw new ContractValidationError(
      'invalid-canonical-history',
      'AutoDev cannot initialize because existing orchestrator state comments are invalid.',
    );
  }

  const repository = await github.getRepository();
  if (typeof repository.default_branch !== 'string' || repository.default_branch.length === 0) {
    throw new ContractValidationError(
      'missing-default-branch',
      'Repository metadata does not contain a default branch.',
    );
  }
  const baseRef = await github.getRef(`heads/${repository.default_branch}`);
  const baseSha = baseRef?.object?.sha;
  if (typeof baseSha !== 'string' || baseSha.length === 0) {
    throw new ContractValidationError(
      'missing-base-sha',
      `Unable to resolve the default branch ${repository.default_branch}.`,
    );
  }

  const headRef = getIssueBranch(issueNumber);
  const branchRef = await github.createOrVerifyBranch(headRef, baseSha);
  const headSha = branchRef.object?.sha;
  if (typeof headSha !== 'string' || headSha.length === 0) {
    throw new ContractValidationError(
      'missing-head-sha',
      `Unable to resolve the issue branch ${headRef}.`,
    );
  }

  const task = {
    schemaVersion: SCHEMA_VERSION,
    issue: issueNumber,
    sequence: 1,
    state: STATES.RESEARCH,
    executionId: null,
    attempt: 1,
    headRef,
    headSha,
    createdAt: now().toISOString(),
  };
  const commentBody = formatTaskComment(
    task,
    [
      '### AutoDev initialized',
      '',
      `Created working branch \`${headRef}\` from \`${repository.default_branch}\`.`,
      'Research is next. Milestone 2 uses a dry-run Research handler and does not launch an Agent Task.',
    ].join('\n'),
  );
  const comment = await github.createIssueComment(issueNumber, commentBody);

  return Object.freeze({
    status: 'initialized',
    task: Object.freeze(task),
    comment,
    errors: canonical.errors,
  });
}
