// Minimal dependency-free GitHub REST client for operations used by completed
// milestones. Add endpoints only when the milestone that consumes them begins.
import { LABELS } from './config.mjs';

export class GitHubApiError extends Error {
  constructor({ method, path, status, responseBody }) {
    super(`GitHub API request failed: ${method} ${path} returned ${status}.`);
    this.name = 'GitHubApiError';
    this.method = method;
    this.path = path;
    this.status = status;
    this.responseBody = responseBody;
  }
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
}

function assertIssueNumber(issueNumber) {
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new TypeError('issueNumber must be a positive safe integer.');
  }
}

function hasNextPage(linkHeader) {
  return typeof linkHeader === 'string' && /<[^>]+>;\s*rel="next"/.test(linkHeader);
}

async function readResponseBody(response) {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new GitHubApiError({
          method: 'PARSE',
          path: response.url,
          status: response.status,
          responseBody: text,
        });
      }
      throw error;
    }
  }

  return text;
}

export class GitHubClient {
  #allowedLabels;
  #fetchImpl;
  #token;

  constructor({
    owner,
    repo,
    token,
    fetchImpl = globalThis.fetch,
    apiUrl = 'https://api.github.com',
    allowedLabels = Object.values(LABELS),
  }) {
    assertNonEmptyString(owner, 'owner');
    assertNonEmptyString(repo, 'repo');
    assertNonEmptyString(token, 'token');
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('fetchImpl must be a function.');
    }
    if (
      !Array.isArray(allowedLabels)
      || allowedLabels.some((label) => typeof label !== 'string' || label.length === 0)
    ) {
      throw new TypeError('allowedLabels must be an array of non-empty strings.');
    }

    this.owner = owner;
    this.repo = repo;
    this.#token = token;
    this.#fetchImpl = fetchImpl;
    this.#allowedLabels = new Set(allowedLabels);
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  async request(method, path, { body, query, allowNotFound = false } = {}) {
    // Authentication is centralized here so callers never receive the token.
    const url = new URL(`${this.apiUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.#fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.#token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'copilot-autodev-poc',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseBody = await readResponseBody(response);

    if (!response.ok) {
      if (allowNotFound && response.status === 404) {
        return null;
      }
      throw new GitHubApiError({
        method,
        path: `${url.pathname}${url.search}`,
        status: response.status,
        responseBody,
      });
    }

    return {
      data: responseBody,
      headers: response.headers,
      status: response.status,
    };
  }

  repositoryPath(path) {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${path}`;
  }

  async getRepository() {
    const response = await this.request('GET', this.repositoryPath(''));
    return response.data;
  }

  async getAuthenticatedUser() {
    const response = await this.request('GET', '/user');
    if (typeof response.data?.login !== 'string' || response.data.login.length === 0) {
      throw new GitHubApiError({
        method: 'GET',
        path: '/user',
        status: 502,
        responseBody: { message: 'Expected the authenticated GitHub user login.' },
      });
    }
    return response.data;
  }

  async getRef(ref) {
    assertNonEmptyString(ref, 'ref');
    const response = await this.request(
      'GET',
      this.repositoryPath(`/git/ref/${encodeURIComponent(ref)}`),
      { allowNotFound: true },
    );
    return response?.data ?? null;
  }

  async createRef(ref, sha) {
    assertNonEmptyString(ref, 'ref');
    assertNonEmptyString(sha, 'sha');
    const response = await this.request(
      'POST',
      this.repositoryPath('/git/refs'),
      { body: { ref: `refs/${ref}`, sha } },
    );
    return response.data;
  }

  async updateRef(ref, sha, { force = false } = {}) {
    assertNonEmptyString(ref, 'ref');
    assertNonEmptyString(sha, 'sha');
    const response = await this.request(
      'PATCH',
      this.repositoryPath(`/git/refs/${encodeURIComponent(ref)}`),
      { body: { sha, force } },
    );
    return response.data;
  }

  async createOrVerifyBranch(branchName, expectedSha) {
    assertNonEmptyString(branchName, 'branchName');
    assertNonEmptyString(expectedSha, 'expectedSha');
    const refName = `heads/${branchName}`;
    const existing = await this.getRef(refName);
    if (existing === null) {
      return this.createRef(refName, expectedSha);
    }

    const actualSha = existing.object?.sha;
    if (actualSha === expectedSha) {
      return existing;
    }

    // A previous Initialization attempt may have created the branch before
    // failing to record canonical task metadata. Move such a stale branch to
    // the current base only through a non-force update, which GitHub rejects if
    // the branch contains unique work or otherwise cannot be fast-forwarded.
    return this.updateRef(refName, expectedSha);
  }

  async getIssueComments(issueNumber) {
    assertIssueNumber(issueNumber);
    const comments = [];

    // Canonical task history may span many comments. Follow GitHub's Link header
    // and retain a hard upper bound to avoid an accidental infinite traversal.
    for (let page = 1; page <= 1000; page += 1) {
      const response = await this.request(
        'GET',
        this.repositoryPath(`/issues/${issueNumber}/comments`),
        { query: { per_page: 100, page } },
      );
      if (!Array.isArray(response.data)) {
        throw new GitHubApiError({
          method: 'GET',
          path: this.repositoryPath(`/issues/${issueNumber}/comments`),
          status: 502,
          responseBody: { message: 'Expected an array of issue comments.' },
        });
      }

      comments.push(...response.data);
      if (!hasNextPage(response.headers.get('link'))) {
        return comments;
      }
    }

    throw new GitHubApiError({
      method: 'GET',
      path: this.repositoryPath(`/issues/${issueNumber}/comments`),
      status: 508,
      responseBody: { message: 'Issue comment pagination exceeded 1000 pages.' },
    });
  }

  async getIssue(issueNumber) {
    assertIssueNumber(issueNumber);
    const response = await this.request(
      'GET',
      this.repositoryPath(`/issues/${issueNumber}`),
    );
    return response.data;
  }

  async createIssueComment(issueNumber, body) {
    assertIssueNumber(issueNumber);
    assertNonEmptyString(body, 'body');
    const response = await this.request(
      'POST',
      this.repositoryPath(`/issues/${issueNumber}/comments`),
      { body: { body } },
    );
    return response.data;
  }

  async addLabels(issueNumber, labels) {
    assertIssueNumber(issueNumber);
    if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string')) {
      throw new TypeError('labels must be an array of strings.');
    }
    const unsupportedLabels = labels.filter((label) => !this.#allowedLabels.has(label));
    // The token can mutate arbitrary labels; this allowlist narrows the client
    // to the four labels defined by the AutoDev POC contract.
    if (unsupportedLabels.length > 0) {
      throw new TypeError(`Unsupported AutoDev labels: ${unsupportedLabels.join(', ')}.`);
    }
    const response = await this.request(
      'POST',
      this.repositoryPath(`/issues/${issueNumber}/labels`),
      { body: { labels } },
    );
    return response.data;
  }

  async removeLabel(issueNumber, label) {
    assertIssueNumber(issueNumber);
    assertNonEmptyString(label, 'label');
    if (!this.#allowedLabels.has(label)) {
      throw new TypeError(`Unsupported AutoDev label: ${label}.`);
    }
    await this.request(
      'DELETE',
      this.repositoryPath(`/issues/${issueNumber}/labels/${encodeURIComponent(label)}`),
      { allowNotFound: true },
    );
  }

}
