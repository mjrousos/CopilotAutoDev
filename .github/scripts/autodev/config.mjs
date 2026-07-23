// Central AutoDev contract. Other modules consume these values rather than
// duplicating state names, routing rules, labels, or file-change policies.
export const SCHEMA_VERSION = 1;

export const STATES = Object.freeze({
  INITIALIZATION: 'initialization',
  RESEARCH: 'research',
  DESIGN: 'design',
  SECURITY_REVIEW: 'security-review',
  HUMAN_PLAN_REVIEW: 'human-plan-review',
  IMPLEMENTATION: 'implementation',
  CODE_REVIEW: 'code-review',
  HUMAN_CODE_REVIEW: 'human-code-review',
  BLOCKED: 'blocked',
  COMPLETED: 'completed',
});

export const STATE_VALUES = Object.freeze(Object.values(STATES));

export const HANDLERS = Object.freeze({
  ORCHESTRATOR: 'orchestrator',
  AGENT_TASK: 'agent-task',
  AGENTIC_WORKFLOW: 'agentic-workflow',
  HUMAN: 'human',
});

export const STATE_HANDLERS = Object.freeze({
  [STATES.INITIALIZATION]: HANDLERS.ORCHESTRATOR,
  [STATES.RESEARCH]: HANDLERS.AGENT_TASK,
  [STATES.DESIGN]: HANDLERS.AGENT_TASK,
  [STATES.SECURITY_REVIEW]: HANDLERS.AGENT_TASK,
  [STATES.HUMAN_PLAN_REVIEW]: HANDLERS.HUMAN,
  [STATES.IMPLEMENTATION]: HANDLERS.AGENT_TASK,
  [STATES.CODE_REVIEW]: HANDLERS.AGENTIC_WORKFLOW,
  [STATES.HUMAN_CODE_REVIEW]: HANDLERS.HUMAN,
  [STATES.BLOCKED]: HANDLERS.ORCHESTRATOR,
  [STATES.COMPLETED]: HANDLERS.ORCHESTRATOR,
});

export const ALLOWED_TRANSITIONS = Object.freeze({
  [STATES.INITIALIZATION]: Object.freeze([STATES.RESEARCH]),
  [STATES.RESEARCH]: Object.freeze([STATES.DESIGN]),
  [STATES.DESIGN]: Object.freeze([STATES.RESEARCH, STATES.SECURITY_REVIEW]),
  [STATES.SECURITY_REVIEW]: Object.freeze([STATES.DESIGN, STATES.HUMAN_PLAN_REVIEW]),
  [STATES.HUMAN_PLAN_REVIEW]: Object.freeze([STATES.DESIGN, STATES.IMPLEMENTATION]),
  [STATES.IMPLEMENTATION]: Object.freeze([STATES.CODE_REVIEW]),
  [STATES.CODE_REVIEW]: Object.freeze([STATES.IMPLEMENTATION, STATES.HUMAN_CODE_REVIEW]),
  [STATES.HUMAN_CODE_REVIEW]: Object.freeze([STATES.IMPLEMENTATION, STATES.COMPLETED]),
  [STATES.BLOCKED]: Object.freeze([]),
  [STATES.COMPLETED]: Object.freeze([]),
});

const AUTOMATED_STATE_VALUES = Object.freeze([
  STATES.INITIALIZATION,
  STATES.RESEARCH,
  STATES.DESIGN,
  STATES.SECURITY_REVIEW,
  STATES.IMPLEMENTATION,
  STATES.CODE_REVIEW,
]);

const EXTERNAL_EXECUTION_STATE_VALUES = Object.freeze([
  STATES.RESEARCH,
  STATES.DESIGN,
  STATES.SECURITY_REVIEW,
  STATES.IMPLEMENTATION,
  STATES.CODE_REVIEW,
]);

export const DECISION_STATES = Object.freeze([STATES.DESIGN, STATES.SECURITY_REVIEW]);

export const LABELS = Object.freeze({
  TRIGGER: 'autodev',
  READY_FOR_PLAN_REVIEW: 'autodev/ready-for-plan-review',
  READY_FOR_CODE_REVIEW: 'autodev/ready-for-code-review',
  BLOCKED: 'autodev/blocked',
});

export const DEFAULT_ORCHESTRATOR_LOGIN = 'github-actions[bot]';

const ARTIFACT_FILE_NAMES = Object.freeze({
  [STATES.RESEARCH]: 'research.md',
  [STATES.DESIGN]: 'design.md',
  [STATES.SECURITY_REVIEW]: 'security-review.md',
});

export function isState(value) {
  return typeof value === 'string' && STATE_VALUES.includes(value);
}

export function getStateHandler(state) {
  if (!isState(state)) {
    throw new TypeError(`Unknown AutoDev state: ${String(state)}`);
  }

  return STATE_HANDLERS[state];
}

export function isAutomatedState(state) {
  return AUTOMATED_STATE_VALUES.includes(state);
}

export function isStateTransitionAllowed(fromState, nextState, { blockedFromState } = {}) {
  if (!isState(fromState) || !isState(nextState)) {
    return false;
  }

  if (fromState === STATES.BLOCKED) {
    // Blocked does not store a resume target. The caller derives it from the
    // task immediately preceding Blocked in the append-only task history.
    return isState(blockedFromState)
      && isAutomatedState(blockedFromState)
      && nextState === blockedFromState;
  }

  if (nextState === STATES.BLOCKED) {
    return isAutomatedState(fromState);
  }

  return ALLOWED_TRANSITIONS[fromState].includes(nextState);
}

export function isExternalExecutionState(state) {
  return EXTERNAL_EXECUTION_STATE_VALUES.includes(state);
}

export function assertIssueNumber(issueNumber) {
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new TypeError('Issue number must be a positive safe integer.');
  }

  return issueNumber;
}

export function getIssueBranch(issueNumber) {
  return `autodev/issue-${assertIssueNumber(issueNumber)}`;
}

export function getIssueArtifactDirectory(issueNumber) {
  return `.github/autodev/issues/${assertIssueNumber(issueNumber)}`;
}

export function getArtifactPath(state, issueNumber) {
  const fileName = ARTIFACT_FILE_NAMES[state];
  if (!fileName) {
    throw new TypeError(`State ${String(state)} does not produce a required artifact.`);
  }

  return `${getIssueArtifactDirectory(issueNumber)}/${fileName}`;
}

export function getStateChangePolicy(state, issueNumber) {
  assertIssueNumber(issueNumber);

  if (state === STATES.RESEARCH || state === STATES.DESIGN || state === STATES.SECURITY_REVIEW) {
    return Object.freeze({
      allowed: Object.freeze([getArtifactPath(state, issueNumber)]),
      denied: Object.freeze([]),
    });
  }

  if (state === STATES.IMPLEMENTATION) {
    // Implementation may change application code broadly, but it cannot
    // rewrite approved issue artifacts or the AutoDev control plane itself.
    return Object.freeze({
      allowed: Object.freeze(['**']),
      denied: Object.freeze([
        '.github/autodev/issues/**',
        '.github/scripts/autodev/**',
        '.github/agents/autodev-*.agent.md',
        '.github/workflows/autodev-*',
      ]),
    });
  }

  throw new TypeError(`State ${String(state)} does not have an Agent Task change policy.`);
}
