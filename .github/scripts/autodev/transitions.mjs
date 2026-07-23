// Applies state-machine policy to an untrusted autodev-result request. GitHub
// identity, platform task status, changed files, and artifacts are checked by
// the surrounding handler because they require external API access.
import {
  HANDLERS,
  STATES,
  getStateHandler,
  isStateTransitionAllowed,
} from './config.mjs';
import {
  ContractValidationError,
  RESULT_OUTCOMES,
  validateResultRecord,
} from './comments.mjs';
import { validateTaskRecord } from './task.mjs';

export function isAllowedTransition(fromState, nextState, { blockedFromState } = {}) {
  return isStateTransitionAllowed(fromState, nextState, { blockedFromState });
}

export function assertAllowedTransition(fromState, nextState, options) {
  if (!isAllowedTransition(fromState, nextState, options)) {
    throw new ContractValidationError(
      'invalid-transition',
      `Transition from ${String(fromState)} to ${String(nextState)} is not allowed.`,
    );
  }
}

function expectedHumanNextState(state, outcome, blockedFromState) {
  // Human outcomes have fixed meanings so a comment cannot claim approval
  // while requesting the corresponding changes-required transition.
  if (state === STATES.HUMAN_PLAN_REVIEW) {
    return outcome === RESULT_OUTCOMES.APPROVED ? STATES.IMPLEMENTATION : STATES.DESIGN;
  }
  if (state === STATES.HUMAN_CODE_REVIEW) {
    return outcome === RESULT_OUTCOMES.APPROVED ? STATES.COMPLETED : STATES.IMPLEMENTATION;
  }
  if (state === STATES.BLOCKED && outcome === RESULT_OUTCOMES.RETRY) {
    return blockedFromState;
  }
  return null;
}

export function validateTransitionRequest(currentTaskValue, resultValue, { blockedFromState } = {}) {
  const currentTask = validateTaskRecord(currentTaskValue);
  const result = validateResultRecord(resultValue, currentTask.issue);
  const effectiveState = currentTask.state;

  if (result.state !== effectiveState) {
    throw new ContractValidationError(
      'state-mismatch',
      `Result state ${result.state} does not match current state ${effectiveState}.`,
    );
  }
  if (result.attempt !== currentTask.attempt) {
    throw new ContractValidationError(
      'attempt-mismatch',
      `Result attempt ${result.attempt} does not match current attempt ${currentTask.attempt}.`,
    );
  }
  if (result.headRef !== currentTask.headRef) {
    throw new ContractValidationError(
      'ref-mismatch',
      `Result headRef ${result.headRef} does not match ${currentTask.headRef}.`,
    );
  }

  const handler = getStateHandler(effectiveState);
  if (handler === HANDLERS.AGENT_TASK || handler === HANDLERS.AGENTIC_WORKFLOW) {
    if (result.outcome !== RESULT_OUTCOMES.SUCCESS) {
      throw new ContractValidationError(
        'outcome-mismatch',
        'Automated execution states require outcome success.',
      );
    }
    if (handler === HANDLERS.AGENTIC_WORKFLOW && result.headSha !== currentTask.headSha) {
      throw new ContractValidationError(
        'sha-mismatch',
        'Agentic Workflow review results cannot change the reviewed head SHA.',
      );
    }
  } else {
    if (result.headSha !== currentTask.headSha) {
      throw new ContractValidationError(
        'sha-mismatch',
        'Human and retry results must reference the current head SHA.',
      );
    }
    const expectedNextState = expectedHumanNextState(
      effectiveState,
      result.outcome,
      blockedFromState,
    );
    if (expectedNextState === null || result.nextState !== expectedNextState) {
      throw new ContractValidationError(
        'outcome-transition-mismatch',
        `Outcome ${result.outcome} cannot request ${result.nextState} from ${effectiveState}.`,
      );
    }
  }

  assertAllowedTransition(effectiveState, result.nextState, {
    blockedFromState,
  });

  return Object.freeze({
    fromState: effectiveState,
    nextState: result.nextState,
    result,
  });
}
