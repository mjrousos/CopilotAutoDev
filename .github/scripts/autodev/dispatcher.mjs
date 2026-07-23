// Converts a GitHub trigger into the requested AutoDev state and invokes the
// matching state handler. State-specific execution belongs under handlers/.
import {
  DEFAULT_ORCHESTRATOR_LOGIN,
  LABELS,
  STATES,
} from './config.mjs';
import {
  ContractValidationError,
  RESULT_OUTCOMES,
  parseResultComment,
} from './comments.mjs';
import {
  TASK_MARKER,
} from './task.mjs';
import { isTrustedHumanComment } from './validation.mjs';
import { initializeIssue } from './handlers/initialization.mjs';

export const INVALID_STATE = 'invalid';

function isHumanOutcome(outcome) {
  return outcome !== RESULT_OUTCOMES.SUCCESS;
}

export function determineState({
  eventName,
  eventPayload,
  issueNumber,
  orchestratorLogin = DEFAULT_ORCHESTRATOR_LOGIN,
}) {
  if (eventName === 'issues') {
    if (
      eventPayload.action === 'labeled'
      && eventPayload.label?.name === LABELS.TRIGGER
    ) {
      return Object.freeze({ state: STATES.INITIALIZATION });
    }
    return Object.freeze({ state: INVALID_STATE, reason: 'non-trigger-label' });
  }

  if (eventName === 'workflow_dispatch') {
    return Object.freeze({ state: STATES.INITIALIZATION });
  }

  if (eventName !== 'issue_comment') {
    return Object.freeze({ state: INVALID_STATE, reason: 'unsupported-event' });
  }
  if (eventPayload.issue?.pull_request) {
    return Object.freeze({ state: INVALID_STATE, reason: 'pull-request-comment' });
  }

  const comment = eventPayload.comment;
  if (!comment || typeof comment.body !== 'string') {
    return Object.freeze({ state: INVALID_STATE, reason: 'missing-comment' });
  }
  if (comment.user?.login === orchestratorLogin) {
    return Object.freeze({ state: INVALID_STATE, reason: 'orchestrator-comment' });
  }
  if (comment.body.includes(`<!-- ${TASK_MARKER}:`)) {
    return Object.freeze({ state: INVALID_STATE, reason: 'canonical-task-comment' });
  }

  const result = parseResultComment(comment.body, issueNumber);
  if (result === null) {
    return Object.freeze({ state: INVALID_STATE, reason: 'unstructured-comment' });
  }
  if (isHumanOutcome(result.outcome) && !isTrustedHumanComment(comment)) {
    return Object.freeze({ state: INVALID_STATE, reason: 'untrusted-human-result' });
  }

  // The result describes the requested next state. Its transition is validated
  // against the current canonical task before a future handler may execute it.
  return Object.freeze({ state: result.nextState, result, comment });
}

export async function dispatchAutoDevEvent({
  github,
  eventName,
  eventPayload,
  issueNumber,
  orchestratorLogin = DEFAULT_ORCHESTRATOR_LOGIN,
  now,
}) {
  let determination;
  try {
    determination = determineState({
      eventName,
      eventPayload,
      issueNumber,
      orchestratorLogin,
    });
  } catch (error) {
    if (error instanceof ContractValidationError) {
      await github.createIssueComment(
        issueNumber,
        `AutoDev ignored an invalid result comment: ${error.message}`,
      );
      return Object.freeze({
        status: 'ignored',
        reason: 'invalid-result',
        errorCode: error.code,
      });
    }
    throw error;
  }

  switch (determination.state) {
    case INVALID_STATE:
      return Object.freeze({
        status: 'ignored',
        reason: determination.reason,
      });
    case STATES.INITIALIZATION:
      return initializeIssue({
        github,
        issueNumber,
        orchestratorLogin,
        now,
      });
    default:
      // Milestone 2 implements only Initialization. Returning an explicit
      // deferred state keeps later requests visible without executing them.
      return Object.freeze({
        status: 'deferred-state',
        reason: 'state-handler-is-not-implemented',
        state: determination.state,
        result: determination.result,
      });
  }
}
