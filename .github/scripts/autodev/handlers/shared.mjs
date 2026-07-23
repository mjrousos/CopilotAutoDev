import { DEFAULT_ORCHESTRATOR_LOGIN } from '../config.mjs';
import { ContractValidationError } from '../comments.mjs';
import { selectCanonicalTask } from '../task.mjs';

function hasBlockingCanonicalErrors(selection) {
  return selection.errors.some((error) => error.code !== 'unauthorized-task-author');
}

export async function loadCanonicalTask({
  github,
  issueNumber,
  orchestratorLogin = DEFAULT_ORCHESTRATOR_LOGIN,
  required = true,
}) {
  const comments = await github.getIssueComments(issueNumber);
  const selection = selectCanonicalTask(comments, {
    issueNumber,
    isOrchestrator: (comment) => comment.user?.login === orchestratorLogin,
  });

  if (hasBlockingCanonicalErrors(selection)) {
    throw new ContractValidationError(
      'invalid-canonical-history',
      'AutoDev cannot continue because existing orchestrator task comments are invalid.',
    );
  }
  if (required && selection.task === null) {
    throw new ContractValidationError(
      'missing-canonical-task',
      'AutoDev cannot continue because no canonical task exists.',
    );
  }

  return selection;
}
