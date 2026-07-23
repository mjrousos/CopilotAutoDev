// Parses and validates the versioned comment contracts supplied by agents and
// humans. These comments are untrusted transition requests, not canonical state.
import {
  ALLOWED_TRANSITIONS,
  DECISION_STATES,
  HANDLERS,
  SCHEMA_VERSION,
  STATES,
  getStateHandler,
  isExternalExecutionState,
  isState,
} from './config.mjs';
import { normalizeRepositoryPath } from './validation.mjs';

export const RESULT_MARKER = 'autodev-result';
export const DECISION_MARKER = 'autodev-decision';

export const RESULT_OUTCOMES = Object.freeze({
  SUCCESS: 'success',
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  RETRY: 'retry',
});

const RESULT_KEYS = Object.freeze([
  'schemaVersion',
  'issue',
  'state',
  'attempt',
  'outcome',
  'nextState',
  'decisionRationale',
  'headRef',
  'headSha',
  'artifacts',
]);

const DECISION_KEYS = Object.freeze([
  'schemaVersion',
  'state',
  'nextState',
  'decisionRationale',
]);

export class ContractValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContractValidationError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, contractName) {
  if (!isPlainObject(value)) {
    throw new ContractValidationError('invalid-object', `${contractName} must be a JSON object.`);
  }
}

function assertExactKeys(value, expectedKeys, contractName) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length
    || actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new ContractValidationError(
      'invalid-fields',
      `${contractName} fields must be exactly: ${sortedExpectedKeys.join(', ')}.`,
    );
  }
}

function assertSchemaVersion(value) {
  if (value !== SCHEMA_VERSION) {
    throw new ContractValidationError(
      'unsupported-schema-version',
      `Unsupported schema version: ${String(value)}.`,
    );
  }
}

function assertPositiveInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ContractValidationError('invalid-integer', `${fieldName} must be a positive integer.`);
  }
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ContractValidationError('invalid-string', `${fieldName} must be a non-empty string.`);
  }
}

function assertSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{7,40}$/i.test(value)) {
    throw new ContractValidationError(
      'invalid-sha',
      'headSha must contain 7 to 40 hexadecimal characters.',
    );
  }
}

function validateArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) {
    throw new ContractValidationError('invalid-artifacts', 'artifacts must be an array.');
  }

  const normalizedArtifacts = artifacts.map((artifact) => {
    try {
      return normalizeRepositoryPath(artifact);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new ContractValidationError('invalid-artifact-path', error.message);
      }
      throw error;
    }
  });

  if (new Set(normalizedArtifacts).size !== normalizedArtifacts.length) {
    throw new ContractValidationError('duplicate-artifact', 'artifacts cannot contain duplicates.');
  }

  return Object.freeze(normalizedArtifacts);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractVersionedMarker(body, markerName) {
  if (typeof body !== 'string') {
    throw new ContractValidationError('invalid-comment-body', 'Comment body must be a string.');
  }

  const markerPattern = new RegExp(
    `<!--\\s*${escapeRegex(markerName)}:v(\\d+)\\s*([\\s\\S]*?)\\s*-->`,
    'g',
  );
  const matches = [...body.matchAll(markerPattern)];
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    // Multiple markers would make it ambiguous which request should be used.
    throw new ContractValidationError(
      'duplicate-marker',
      `Comment contains multiple ${markerName} markers.`,
    );
  }

  const version = Number.parseInt(matches[0][1], 10);
  if (version !== SCHEMA_VERSION) {
    throw new ContractValidationError(
      'unsupported-marker-version',
      `Unsupported ${markerName} marker version: ${version}.`,
    );
  }

  try {
    return JSON.parse(matches[0][2]);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ContractValidationError('invalid-json', `${markerName} marker contains invalid JSON.`);
    }
    throw error;
  }
}

export function formatVersionedMarker(markerName, payload) {
  return `<!-- ${markerName}:v${SCHEMA_VERSION}\n${JSON.stringify(payload, null, 2)}\n-->`;
}

export function validateResultRecord(value, expectedIssueNumber) {
  // Result records are deliberately strict so schema changes require a new
  // version instead of silently accepting misspelled or unexpected fields.
  assertPlainObject(value, 'AutoDev result');
  assertExactKeys(value, RESULT_KEYS, 'AutoDev result');
  assertSchemaVersion(value.schemaVersion);
  assertPositiveInteger(value.issue, 'issue');
  if (expectedIssueNumber !== undefined && value.issue !== expectedIssueNumber) {
    throw new ContractValidationError(
      'issue-mismatch',
      `Result issue ${value.issue} does not match issue ${expectedIssueNumber}.`,
    );
  }
  if (!isState(value.state) || !isState(value.nextState)) {
    throw new ContractValidationError('invalid-state', 'state and nextState must be known AutoDev states.');
  }
  assertPositiveInteger(value.attempt, 'attempt');
  if (!Object.values(RESULT_OUTCOMES).includes(value.outcome)) {
    throw new ContractValidationError('invalid-outcome', `Unknown result outcome: ${String(value.outcome)}.`);
  }
  assertNonEmptyString(value.decisionRationale, 'decisionRationale');
  assertNonEmptyString(value.headRef, 'headRef');
  assertSha(value.headSha);
  const artifacts = validateArtifacts(value.artifacts);

  if (value.outcome === RESULT_OUTCOMES.SUCCESS) {
    if (!isExternalExecutionState(value.state)) {
      throw new ContractValidationError(
        'invalid-automated-state',
        `State ${value.state} does not accept automated success results.`,
      );
    }
  } else {
    const handler = getStateHandler(value.state);
    if (value.outcome === RESULT_OUTCOMES.RETRY) {
      if (value.state !== STATES.BLOCKED) {
        throw new ContractValidationError('invalid-retry-state', 'retry is valid only in blocked.');
      }
    } else if (handler !== HANDLERS.HUMAN) {
      throw new ContractValidationError(
        'invalid-human-state',
        `${value.outcome} is valid only in a human review state.`,
      );
    }
  }

  return Object.freeze({
    ...value,
    artifacts,
  });
}

export function parseResultComment(body, expectedIssueNumber) {
  const value = extractVersionedMarker(body, RESULT_MARKER);
  return value === null ? null : validateResultRecord(value, expectedIssueNumber);
}

export function validateDecisionRecord(value) {
  // Design and SecurityReview persist this smaller block in their committed
  // artifacts so reconciliation can recover a decision if its callback is lost.
  assertPlainObject(value, 'AutoDev artifact decision');
  assertExactKeys(value, DECISION_KEYS, 'AutoDev artifact decision');
  assertSchemaVersion(value.schemaVersion);
  if (!DECISION_STATES.includes(value.state)) {
    throw new ContractValidationError(
      'invalid-decision-state',
      `Artifact decisions are not supported for state ${String(value.state)}.`,
    );
  }
  if (!isState(value.nextState)) {
    throw new ContractValidationError('invalid-state', 'nextState must be a known AutoDev state.');
  }
  if (!ALLOWED_TRANSITIONS[value.state].includes(value.nextState)) {
    throw new ContractValidationError(
      'invalid-decision-transition',
      `State ${value.state} cannot select ${value.nextState}.`,
    );
  }
  assertNonEmptyString(value.decisionRationale, 'decisionRationale');

  return Object.freeze({ ...value });
}

export function parseDecisionBlock(content) {
  const value = extractVersionedMarker(content, DECISION_MARKER);
  return value === null ? null : validateDecisionRecord(value);
}

export function formatDecisionBlock(decision) {
  return formatVersionedMarker(DECISION_MARKER, validateDecisionRecord(decision));
}
