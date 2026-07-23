// Idempotent, resumable Initialization handler. It creates (or reuses) the
// issue branch, seeds a scaffold file, opens the tracking pull request, records
// canonical Initialization state, and posts a callback-identity result handoff
// so a follow-up orchestrator run launches Research. Every step tolerates a
// prior partial attempt so a re-triggered run can recover rather than stall.
import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  SCHEMA_VERSION,
  STATES,
  getIssueBranch,
  getIssueScaffoldPath,
} from '../config.mjs';
import {
  ContractValidationError,
  RESULT_OUTCOMES,
  formatResultComment,
} from '../comments.mjs';
import { formatTaskComment } from '../task.mjs';
import { loadCanonicalTask } from './shared.mjs';

export function buildScaffoldContent(issue, issueNumber) {
  const title = issue?.title ?? `Issue #${issueNumber}`;
  return [
    `# AutoDev workspace for issue #${issueNumber}`,
    '',
    `This branch tracks AutoDev's automated work for **${title}**.`,
    '',
    'AutoDev adds research, design, and other artifacts under this directory as '
      + 'it progresses. This placeholder is committed during initialization so the '
      + 'tracking pull request can be opened for the issue branch.',
    '',
  ].join('\n');
}

export async function initializeIssue({
  github,
  callbackGithub,
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

  // Once Research (or a later state) is recorded, initialization is complete.
  // A canonical record that is still Initialization means a prior run recorded
  // state but its Research handoff may have been lost, so it is resumed below.
  if (canonical.task !== null && canonical.task.state !== STATES.INITIALIZATION) {
    return Object.freeze({
      status: 'already-initialized',
      task: canonical.task,
      errors: canonical.errors,
    });
  }

  const repository = await github.getRepository();
  const defaultBranch = repository.default_branch;
  if (typeof defaultBranch !== 'string' || defaultBranch.length === 0) {
    throw new ContractValidationError(
      'missing-default-branch',
      'Repository metadata does not contain a default branch.',
    );
  }

  const headRef = getIssueBranch(issueNumber);
  const issue = await github.getIssue(issueNumber);

  let task = canonical.task;
  let headSha;

  if (task === null) {
    // Fresh initialization, or the resumption of an attempt that created the
    // branch/scaffold but never recorded canonical state. Reuse the branch when
    // present and seed the scaffold only when absent so a retry neither rewinds
    // unique work nor recommits identical content.
    const baseRef = await github.getRef(`heads/${defaultBranch}`);
    const baseSha = baseRef?.object?.sha;
    if (typeof baseSha !== 'string' || baseSha.length === 0) {
      throw new ContractValidationError(
        'missing-base-sha',
        `Unable to resolve the default branch ${defaultBranch}.`,
      );
    }

    const existingBranch = await github.getRef(`heads/${headRef}`);
    if (existingBranch === null) {
      await github.createRef(`heads/${headRef}`, baseSha);
    }

    const scaffoldPath = getIssueScaffoldPath(issueNumber);
    const existingScaffold = await github.getContent(scaffoldPath, headRef);
    if (existingScaffold === null) {
      await github.createOrUpdateFile({
        path: scaffoldPath,
        message: `AutoDev: initialize issue #${issueNumber}`,
        content: buildScaffoldContent(issue, issueNumber),
        branch: headRef,
      });
    }

    const seededBranch = await github.getRef(`heads/${headRef}`);
    headSha = seededBranch?.object?.sha;
    if (typeof headSha !== 'string' || headSha.length === 0) {
      throw new ContractValidationError(
        'missing-head-sha',
        `Unable to resolve the seeded head of ${headRef}.`,
      );
    }
  } else {
    // Resume: reuse the head SHA recorded on the canonical Initialization task
    // so the re-posted handoff references the SHA the transition validator
    // expects.
    headSha = task.headSha;
  }

  const pullRequest = await github.ensurePullRequest({
    title: `AutoDev: ${issue?.title ?? `issue #${issueNumber}`}`,
    head: headRef,
    base: defaultBranch,
    body: `Automated AutoDev working pull request for issue #${issueNumber}. `
      + 'Downstream AutoDev states commit to this branch; do not merge until AutoDev completes.',
  });

  if (task === null) {
    task = {
      schemaVersion: SCHEMA_VERSION,
      issue: issueNumber,
      sequence: 1,
      state: STATES.INITIALIZATION,
      executionId: null,
      attempt: 1,
      headRef,
      headSha,
      createdAt: now().toISOString(),
    };
    const pullRequestLink = pullRequest.html_url
      ? `[pull request #${pullRequest.number}](${pullRequest.html_url})`
      : `pull request #${pullRequest.number}`;
    await github.createIssueComment(
      issueNumber,
      formatTaskComment(
        task,
        `### AutoDev initialized\n\nCreated \`${headRef}\` and ${pullRequestLink}. Research will start next.`,
      ),
    );
  }

  // Post (or, on resume, re-post) the Research handoff with the callback
  // identity so its issue_comment event retriggers the orchestrator, which then
  // validates the Initialization -> Research transition and launches Research.
  const result = {
    schemaVersion: SCHEMA_VERSION,
    issue: issueNumber,
    state: STATES.INITIALIZATION,
    attempt: 1,
    outcome: RESULT_OUTCOMES.SUCCESS,
    nextState: STATES.RESEARCH,
    decisionRationale: 'Issue branch and tracking pull request are ready; hand off to Research.',
    headRef,
    headSha,
    artifacts: [],
  };
  const resultComment = await callbackGithub.createIssueComment(
    issueNumber,
    formatResultComment(result, '### AutoDev initialization complete\n\nRequesting the Research state.'),
  );

  return Object.freeze({
    status: 'initialization-recorded',
    task: Object.freeze(task),
    pullRequest,
    resultComment,
    errors: canonical.errors,
  });
}
