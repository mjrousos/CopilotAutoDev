// Handles orchestrator-authored autodev-task comments. Each comment is a
// snapshot of the current state/task; the append-only sequence provides history.
import {
  SCHEMA_VERSION,
  STATES,
  isState,
} from './config.mjs';
import {
  ContractValidationError,
  extractVersionedMarker,
  formatVersionedMarker,
} from './comments.mjs';

export const TASK_MARKER = 'autodev-task';

const TASK_KEYS = Object.freeze([
  'schemaVersion',
  'issue',
  'sequence',
  'state',
  'executionId',
  'attempt',
  'headRef',
  'headSha',
  'createdAt',
]);

function assertPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractValidationError('invalid-object', 'AutoDev task must be a JSON object.');
  }
}

function assertExactKeys(value) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...TASK_KEYS].sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new ContractValidationError(
      'invalid-fields',
      `AutoDev task fields must be exactly: ${expectedKeys.join(', ')}.`,
    );
  }
}

function assertPositiveInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ContractValidationError('invalid-integer', `${fieldName} must be a positive integer.`);
  }
}

function assertExecutionId(value) {
  if (value !== null && (typeof value !== 'string' || value.trim().length === 0)) {
    throw new ContractValidationError(
      'invalid-execution-id',
      'executionId must be null or a non-empty string.',
    );
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

function assertTimestamp(value) {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw new ContractValidationError(
      'invalid-timestamp',
      'createdAt must be a valid UTC ISO 8601 timestamp.',
    );
  }
}

export function validateTaskRecord(value, expectedIssueNumber) {
  assertPlainObject(value);
  assertExactKeys(value);
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new ContractValidationError(
      'unsupported-schema-version',
      `Unsupported schema version: ${String(value.schemaVersion)}.`,
    );
  }
  assertPositiveInteger(value.issue, 'issue');
  if (expectedIssueNumber !== undefined && value.issue !== expectedIssueNumber) {
    throw new ContractValidationError(
      'issue-mismatch',
      `Task issue ${value.issue} does not match issue ${expectedIssueNumber}.`,
    );
  }
  assertPositiveInteger(value.sequence, 'sequence');
  if (!isState(value.state)) {
    throw new ContractValidationError('invalid-state', 'state must be a known AutoDev state.');
  }
  assertExecutionId(value.executionId);
  assertPositiveInteger(value.attempt, 'attempt');
  if (typeof value.headRef !== 'string' || value.headRef.trim().length === 0) {
    throw new ContractValidationError('invalid-ref', 'headRef must be a non-empty string.');
  }
  assertSha(value.headSha);
  assertTimestamp(value.createdAt);

  return Object.freeze({ ...value });
}

export function parseTaskComment(body, expectedIssueNumber) {
  const value = extractVersionedMarker(body, TASK_MARKER);
  return value === null ? null : validateTaskRecord(value, expectedIssueNumber);
}

export function formatTaskComment(taskRecord, summary = 'AutoDev task updated') {
  const validatedTask = validateTaskRecord(taskRecord);
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    throw new ContractValidationError('invalid-summary', 'summary must be a non-empty string.');
  }

  return `${summary.trim()}\n\n${formatVersionedMarker(TASK_MARKER, validatedTask)}`;
}

function formatSelectionError(comment, error) {
  return Object.freeze({
    commentId: comment.id ?? null,
    code: error.code,
    message: error.message,
  });
}

function isValidNextTask(history, candidate) {
  if (history.length === 0) {
    return candidate.sequence === 1 && candidate.state === STATES.RESEARCH;
  }

  // State transitions are validated before the orchestrator writes a task
  // comment. Here we only ensure the canonical history remains contiguous.
  return candidate.sequence === history.at(-1).sequence + 1;
}

export function selectCanonicalTask(comments, { issueNumber, isOrchestrator }) {
  if (!Array.isArray(comments)) {
    throw new TypeError('comments must be an array.');
  }
  assertPositiveInteger(issueNumber, 'issueNumber');
  if (typeof isOrchestrator !== 'function') {
    throw new TypeError('isOrchestrator must be a function.');
  }

  const candidates = [];
  const errors = [];

  for (const comment of comments) {
    if (!comment || typeof comment.body !== 'string') {
      continue;
    }

    let parsed;
    try {
      parsed = parseTaskComment(comment.body, issueNumber);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        errors.push(formatSelectionError(comment, error));
        continue;
      }
      throw error;
    }

    if (parsed === null) {
      continue;
    }
    if (!isOrchestrator(comment)) {
      errors.push(formatSelectionError(
        comment,
        new ContractValidationError(
          'unauthorized-task-author',
          'Canonical task marker was not authored by the orchestrator.',
        ),
      ));
      continue;
    }

    candidates.push({ comment, task: parsed });
  }

  const sequenceCounts = new Map();
  for (const candidate of candidates) {
    sequenceCounts.set(
      candidate.task.sequence,
      (sequenceCounts.get(candidate.task.sequence) ?? 0) + 1,
    );
  }

  const uniqueCandidates = candidates.filter((candidate) => {
    if (sequenceCounts.get(candidate.task.sequence) === 1) {
      return true;
    }

    errors.push(formatSelectionError(
      candidate.comment,
      new ContractValidationError(
        'duplicate-sequence',
        `Multiple canonical comments use sequence ${candidate.task.sequence}.`,
      ),
    ));
    return false;
  });

  uniqueCandidates.sort((left, right) => left.task.sequence - right.task.sequence);
  // Build the valid prefix rather than simply choosing the largest sequence.
  // A deleted, duplicated, or missing comment must not let later records win.
  const history = [];
  let selectedComment = null;

  for (const candidate of uniqueCandidates) {
    if (!isValidNextTask(history, candidate.task)) {
      const expectedSequence = history.length === 0 ? 1 : history.at(-1).sequence + 1;
      errors.push(formatSelectionError(
        candidate.comment,
        new ContractValidationError(
          'invalid-task-history',
          `Task sequence ${candidate.task.sequence} does not continue canonical sequence ${expectedSequence}.`,
        ),
      ));
      continue;
    }

    history.push(candidate.task);
    selectedComment = candidate.comment;
  }

  return Object.freeze({
    task: history.at(-1) ?? null,
    comment: selectedComment,
    history: Object.freeze(history),
    errors: Object.freeze(errors),
  });
}
