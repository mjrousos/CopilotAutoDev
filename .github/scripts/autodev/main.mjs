// GitHub Actions entry point. It normalizes event context, creates infrastructure
// clients, and delegates all state routing to the dispatcher.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { DEFAULT_ORCHESTRATOR_LOGIN } from './config.mjs';
import { GitHubClient } from './github-client.mjs';
import { dispatchAutoDevEvent } from './dispatcher.mjs';

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
}

export function parseRepository(repository) {
  assertNonEmptyString(repository, 'GITHUB_REPOSITORY');
  const parts = repository.split('/');
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new TypeError('GITHUB_REPOSITORY must use the owner/repository format.');
  }
  return Object.freeze({ owner: parts[0], repo: parts[1] });
}

export function resolveIssueNumber({ eventName, eventPayload, inputIssueNumber }) {
  const eventIssueNumber = eventPayload.issue?.number;
  const candidate = eventIssueNumber ?? eventPayload.inputs?.issue_number ?? inputIssueNumber;
  const issueNumber = typeof candidate === 'string' ? Number.parseInt(candidate, 10) : candidate;

  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new TypeError(`Unable to resolve a valid issue number for ${eventName}.`);
  }

  return issueNumber;
}

export async function run({
  env = process.env,
  fetchImpl = globalThis.fetch,
  readFileImpl = readFile,
  log = console,
} = {}) {
  assertNonEmptyString(env.GITHUB_EVENT_NAME, 'GITHUB_EVENT_NAME');
  assertNonEmptyString(env.GITHUB_EVENT_PATH, 'GITHUB_EVENT_PATH');
  assertNonEmptyString(env.AUTODEV_GITHUB_TOKEN, 'AUTODEV_GITHUB_TOKEN');
  assertNonEmptyString(env.AUTODEV_CALLBACK_TOKEN, 'AUTODEV_CALLBACK_TOKEN');

  const eventPayload = JSON.parse(await readFileImpl(env.GITHUB_EVENT_PATH, 'utf8'));
  const issueNumber = resolveIssueNumber({
    eventName: env.GITHUB_EVENT_NAME,
    eventPayload,
    inputIssueNumber: env.INPUT_ISSUE_NUMBER,
  });
  const { owner, repo } = parseRepository(env.GITHUB_REPOSITORY);
  const github = new GitHubClient({
    owner,
    repo,
    token: env.AUTODEV_GITHUB_TOKEN,
    fetchImpl,
    apiUrl: env.GITHUB_API_URL,
  });
  const callbackGithub = new GitHubClient({
    owner,
    repo,
    token: env.AUTODEV_CALLBACK_TOKEN,
    fetchImpl,
    apiUrl: env.GITHUB_API_URL,
  });
  const callbackUser = await callbackGithub.getAuthenticatedUser();

  const result = await dispatchAutoDevEvent({
    github,
    callbackGithub,
    eventName: env.GITHUB_EVENT_NAME,
    eventPayload,
    issueNumber,
    orchestratorLogin: env.AUTODEV_ORCHESTRATOR_LOGIN ?? DEFAULT_ORCHESTRATOR_LOGIN,
    callbackLogin: callbackUser.login,
  });
  log.log(JSON.stringify({ issueNumber, ...result }));
  return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
// Keep the module importable by tests while still behaving as an executable.
if (invokedPath === import.meta.url) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
