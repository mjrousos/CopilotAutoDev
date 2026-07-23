// Idempotent Initialization handler. It creates the issue branch and publishes
// the first canonical task snapshot; Milestone 3 will replace the dry-run task.
import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  getIssueBranch,
} from '../config.mjs';
import { ContractValidationError } from '../comments.mjs';
import { loadCanonicalTask } from './shared.mjs';
import { startResearch } from './research.mjs';

export async function initializeIssue({
  github,
  agentTasks,
  issueNumber,
  orchestratorLogin = DEFAULT_ORCHESTRATOR_LOGIN,
  now = () => new Date(),
}) {
  const canonical = await loadCanonicalTask({
    github,
    issueNumber,
    orchestratorLogin,
    required: false,
  });

  if (canonical.task !== null) {
    return Object.freeze({
      status: 'already-initialized',
      task: canonical.task,
      errors: canonical.errors,
    });
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

  const research = await startResearch({
    github,
    agentTasks,
    issueNumber,
    baseRef: repository.default_branch,
    headRef,
    headSha,
    sequence: 1,
    attempt: 1,
    now,
  });
  return Object.freeze({
    ...research,
    errors: canonical.errors,
  });
}
