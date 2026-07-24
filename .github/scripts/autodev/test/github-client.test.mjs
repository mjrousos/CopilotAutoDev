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

test('existing issue branch is reused when it matches the expected SHA', async () => {
  const matchingClient = createClient(async () => jsonResponse({
    ref: 'refs/heads/autodev/issue-42',
    object: { sha: SHA },
  }));
  assert.equal(
    (await matchingClient.createOrVerifyBranch('autodev/issue-42', SHA)).object.sha,
    SHA,
  );
});

test('stale issue branch is advanced with a non-force update', async () => {
  const requests = [];
  const client = createClient(async (_url, options) => {
    requests.push(options);
    if (options.method === 'GET') {
      return jsonResponse({
        ref: 'refs/heads/autodev/issue-42',
        object: { sha: '89abcdef0123456789abcdef0123456789abcdef' },
      });
    }
    return jsonResponse({
      ref: 'refs/heads/autodev/issue-42',
      object: { sha: SHA },
    });
  });

  assert.equal(
    (await client.createOrVerifyBranch('autodev/issue-42', SHA)).object.sha,
    SHA,
  );
  assert.equal(requests[1].method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[1].body), {
    sha: SHA,
    force: false,
  });
});

test('issue branch with unique work cannot be force-reset', async () => {
  const conflictingClient = createClient(async (_url, options) => {
    if (options.method === 'GET') {
      return jsonResponse({
        ref: 'refs/heads/autodev/issue-42',
        object: { sha: '89abcdef0123456789abcdef0123456789abcdef' },
      });
    }
    return jsonResponse({ message: 'Reference update failed' }, { status: 422 });
  });

  await assert.rejects(
    conflictingClient.createOrVerifyBranch('autodev/issue-42', SHA),
    (error) => error instanceof GitHubApiError && error.status === 422,
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

test('createOrUpdateFile seeds a new file without a blob SHA', async () => {
  const requests = [];
  const client = createClient(async (url, options) => {
    requests.push({ url: url.toString(), options });
    if (options.method === 'GET') {
      return jsonResponse({ message: 'Not Found' }, { status: 404 });
    }
    return jsonResponse(
      { content: { path: 'autodev/issues/42/README.md' }, commit: { sha: SHA } },
      { status: 201 },
    );
  });

  const result = await client.createOrUpdateFile({
    path: 'autodev/issues/42/README.md',
    message: 'seed',
    content: '# hello',
    branch: 'autodev/issue-42',
  });

  assert.equal(result.commit.sha, SHA);
  assert.match(requests[0].url, /contents\/autodev\/issues\/42\/README\.md/);
  assert.equal(requests[1].options.method, 'PUT');
  const putBody = JSON.parse(requests[1].options.body);
  assert.equal(putBody.branch, 'autodev/issue-42');
  assert.equal(putBody.sha, undefined);
  assert.equal(Buffer.from(putBody.content, 'base64').toString('utf8'), '# hello');
});

test('createOrUpdateFile reuses the existing blob SHA when the file is present', async () => {
  const requests = [];
  const client = createClient(async (_url, options) => {
    requests.push(options);
    if (options.method === 'GET') {
      return jsonResponse({ sha: 'existing-blob-sha', path: 'a/b.md' });
    }
    return jsonResponse({ commit: { sha: SHA } });
  });

  await client.createOrUpdateFile({
    path: 'a/b.md', message: 'update', content: 'body', branch: 'autodev/issue-42',
  });

  assert.equal(JSON.parse(requests[1].body).sha, 'existing-blob-sha');
});

test('ensurePullRequest reuses an open pull request when one exists', async () => {
  const requests = [];
  const client = createClient(async (url, options) => {
    requests.push({ url: url.toString(), method: options.method });
    if (options.method === 'GET') {
      return jsonResponse([{ number: 7, html_url: 'https://example.test/pull/7' }]);
    }
    throw new Error('ensurePullRequest should not open a new pull request');
  });

  const pr = await client.ensurePullRequest({
    title: 'AutoDev: Test', head: 'autodev/issue-42', base: 'main',
  });

  assert.equal(pr.number, 7);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /head=octo-org%3Aautodev%2Fissue-42/);
  assert.match(requests[0].url, /base=main/);
  assert.match(requests[0].url, /state=open/);
});

test('ensurePullRequest opens a pull request when none is open', async () => {
  const requests = [];
  const client = createClient(async (_url, options) => {
    requests.push({ method: options.method, body: options.body });
    if (options.method === 'GET') {
      return jsonResponse([]);
    }
    return jsonResponse({ number: 11, html_url: 'https://example.test/pull/11' }, { status: 201 });
  });

  const pr = await client.ensurePullRequest({
    title: 'AutoDev: Test', head: 'autodev/issue-42', base: 'main', body: 'tracking',
  });

  assert.equal(pr.number, 11);
  assert.equal(requests[1].method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].body), {
    title: 'AutoDev: Test', head: 'autodev/issue-42', base: 'main', body: 'tracking',
  });
});

test('dispatchWorkflow posts ref and inputs to the workflow dispatch endpoint', async () => {
  let request;
  const client = createClient(async (url, options) => {
    request = { url: url.toString(), method: options.method, body: options.body };
    return new Response(null, { status: 204 });
  });

  await client.dispatchWorkflow('autodev-research.lock.yml', 'main', {
    issue_number: '42',
    head_ref: 'autodev/issue-42',
  });

  assert.match(request.url, /\/actions\/workflows\/autodev-research\.lock\.yml\/dispatches$/);
  assert.equal(request.method, 'POST');
  assert.deepEqual(JSON.parse(request.body), {
    ref: 'main',
    inputs: { issue_number: '42', head_ref: 'autodev/issue-42' },
  });
});

test('dispatchWorkflow rejects non-object inputs', async () => {
  const client = createClient(async () => new Response(null, { status: 204 }));
  await assert.rejects(
    client.dispatchWorkflow('wf.lock.yml', 'main', ['not', 'an', 'object']),
    /inputs must be an object/,
  );
});

test('dispatchWorkflow trims surrounding whitespace from the ref and workflow name', async () => {
  let request;
  const client = createClient(async (url, options) => {
    request = { url: url.toString(), body: options.body };
    return new Response(null, { status: 204 });
  });

  await client.dispatchWorkflow(' autodev-research.lock.yml ', 'main ', { issue_number: '42' });

  assert.match(request.url, /\/actions\/workflows\/autodev-research\.lock\.yml\/dispatches$/);
  assert.equal(JSON.parse(request.body).ref, 'main');
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
