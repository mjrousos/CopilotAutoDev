// Shared validation for trusted human authors and repository-relative file
// policies. GitHub/API-specific checks live in their respective handlers.
import { getStateChangePolicy } from './config.mjs';

export const TRUSTED_HUMAN_ASSOCIATIONS = Object.freeze([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
]);

export function isTrustedHumanAssociation(authorAssociation) {
  return TRUSTED_HUMAN_ASSOCIATIONS.includes(authorAssociation);
}

export function isTrustedHumanComment(comment) {
  return Boolean(comment) && isTrustedHumanAssociation(comment.author_association);
}

export function normalizeRepositoryPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new TypeError('Repository path must be a non-empty string.');
  }

  const slashNormalized = filePath.replaceAll('\\', '/');
  if (
    slashNormalized.startsWith('/')
    || /^[A-Za-z]:\//.test(slashNormalized)
    || slashNormalized.split('/').includes('..')
  ) {
    throw new TypeError(`Repository path must be relative and cannot traverse: ${filePath}`);
  }

  const normalized = slashNormalized
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
    .join('/');
  if (normalized.length === 0) {
    throw new TypeError('Repository path must contain a file or directory name.');
  }

  return normalized;
}

function escapeRegexCharacter(character) {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

export function globToRegExp(pattern) {
  // The POC needs only a small glob dialect: ** across directories and
  // * or ? within a path segment. Keeping it local avoids a package dependency.
  const normalizedPattern = normalizeRepositoryPath(pattern);
  let expression = '^';

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    if (character === '*' && normalizedPattern[index + 1] === '*') {
      expression += '.*';
      index += 1;
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += escapeRegexCharacter(character);
    }
  }

  return new RegExp(`${expression}$`);
}

export function matchesPattern(filePath, pattern) {
  return globToRegExp(pattern).test(normalizeRepositoryPath(filePath));
}

export function isPathAllowedForState(state, issueNumber, filePath) {
  const normalizedPath = normalizeRepositoryPath(filePath);
  const policy = getStateChangePolicy(state, issueNumber);
  const denied = policy.denied.some((pattern) => matchesPattern(normalizedPath, pattern));
  // Denials always override broad allow patterns such as Implementation's **.
  if (denied) {
    return false;
  }

  return policy.allowed.some((pattern) => matchesPattern(normalizedPath, pattern));
}

export function findDisallowedPaths(state, issueNumber, filePaths) {
  if (!Array.isArray(filePaths)) {
    throw new TypeError('Changed file paths must be an array.');
  }

  return filePaths
    .map(normalizeRepositoryPath)
    .filter((filePath) => !isPathAllowedForState(state, issueNumber, filePath));
}
