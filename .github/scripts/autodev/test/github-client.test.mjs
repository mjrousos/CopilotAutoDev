import assert from 'node:assert/strict';
import test from 'node:test';

import { GitHubApiError, GitHubClient } from '../github-client.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

function createHeaders(values = {}) {
  return new Headers({
    'content-type': 'application/json',
    ...values,
  });
}

function jsonResponse(data, { status = 200, headers } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: createHeaders(headers),
  });
}

function createClient(fetchImpl) {
  return new GitHubClient({
    owner: 'octo-org',
    repo: 'octo-repo',
    token: 'test-token',
    fetchImpl,
  });
}

test('issue comments are read across Link-header pagination', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url.toString());
    const page = url.searchParams.get('page');
    if (page === '1') {
      return jsonResponse([{ id: 1 }], {
        headers: {
          link: '<https://api.github.com/example?page=2>; rel="next"',
        },
      });
    }
    return jsonResponse([{ id: 2 }]);
  };

  const comments = await createClient(fetchImpl).getIssueComments(42);
  assert.deepEqual(comments, [{ id: 1 }, { id: 2 }]);
  assert.equal(requests.length, 2);
  assert.match(requests[0], /per_page=100/);
});

test('missing issue branch is created from the expected SHA', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: url.toString(), options });
    if (options.method === 'GET') {
      return jsonResponse({ message: 'Not Found' }, { status: 404 });
    }
    return jsonResponse({
      ref: 'refs/heads/autodev/issue-42',
      object: { sha: SHA },
    }, { status: 201 });
  };

  const result = await createClient(fetchImpl).createOrVerifyBranch('autodev/issue-42', SHA);
  assert.equal(result.object.sha, SHA);
  assert.equal(requests[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    ref: 'refs/heads/autodev/issue-42',
    sha: SHA,
  });
});

test('existing issue branch is reused only when it matches the expected SHA', async () => {
  const matchingClient = createClient(async () => jsonResponse({
    ref: 'refs/heads/autodev/issue-42',
    object: { sha: SHA },
  }));
  assert.equal(
    (await matchingClient.createOrVerifyBranch('autodev/issue-42', SHA)).object.sha,
    SHA,
  );

  const conflictingClient = createClient(async () => jsonResponse({
    ref: 'refs/heads/autodev/issue-42',
    object: { sha: '89abcdef0123456789abcdef0123456789abcdef' },
  }));
  await assert.rejects(
    conflictingClient.createOrVerifyBranch('autodev/issue-42', SHA),
    (error) => error instanceof GitHubApiError && error.status === 409,
  );
});

test('GitHub API failures preserve status and response body', async () => {
  const client = createClient(async () => jsonResponse(
    { message: 'Forbidden' },
    { status: 403 },
  ));

  await assert.rejects(
    client.getRepository(),
    (error) => error instanceof GitHubApiError
      && error.status === 403
      && error.responseBody.message === 'Forbidden',
  );
});

test('issue comments use the configured authorization token', async () => {
  let authorization;
  const client = createClient(async (_url, options) => {
    authorization = options.headers.Authorization;
    return jsonResponse({ id: 1 }, { status: 201 });
  });

  await client.createIssueComment(42, 'hello');
  assert.equal(authorization, 'Bearer test-token');
});

test('authenticated user login is resolved from the configured token', async () => {
  const client = createClient(async (url) => {
    assert.equal(url.pathname, '/user');
    return jsonResponse({ login: 'callback-user' });
  });

  assert.equal((await client.getAuthenticatedUser()).login, 'callback-user');
});

test('compareCommits and getContent expose validation data', async () => {
  const client = createClient(async (url) => {
    if (url.pathname.includes('/compare/')) {
      return jsonResponse({ files: [{ filename: 'research.md' }] });
    }
    return jsonResponse({ type: 'file', path: '.github/autodev/issues/42/research.md' });
  });

  assert.deepEqual(
    (await client.compareCommits('abc1234', 'def5678')).files,
    [{ filename: 'research.md' }],
  );
  assert.equal(
    (await client.getContent('.github/autodev/issues/42/research.md', 'def5678')).type,
    'file',
  );
});

test('getContent returns null when the artifact does not exist', async () => {
  const client = createClient(async () => jsonResponse(
    { message: 'Not Found' },
    { status: 404 },
  ));
  assert.equal(await client.getContent('missing.md', SHA), null);
});

test('compareCommits rejects GitHub responses at the 300-file limit', async () => {
  const client = createClient(async () => jsonResponse({
    files: Array.from({ length: 300 }, (_, index) => ({ filename: `file-${index}.txt` })),
  }));

  await assert.rejects(
    client.compareCommits('abc1234', 'def5678'),
    (error) => error instanceof GitHubApiError && error.status === 422,
  );
});

test('label operations reject labels outside the configured POC set', async () => {
  const client = createClient(async () => jsonResponse([]));
  await assert.rejects(
    client.addLabels(42, ['unapproved-label']),
    /Unsupported AutoDev labels/,
  );
  await assert.rejects(
    client.removeLabel(42, 'unapproved-label'),
    /Unsupported AutoDev label/,
  );
});
