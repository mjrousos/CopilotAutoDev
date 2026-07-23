import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentTasksApiError,
  AgentTasksClient,
  validateAgentTask,
} from '../agent-tasks-client.mjs';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClient(fetchImpl) {
  return new AgentTasksClient({
    owner: 'octo-org',
    repo: 'octo-repo',
    token: 'task-token',
    fetchImpl,
  });
}

test('startTask sends the custom agent to the existing issue branch', async () => {
  let request;
  const client = createClient(async (url, options) => {
    request = { url, options };
    return jsonResponse({ id: 'task-123', state: 'queued' }, 201);
  });

  const task = await client.startTask({
    prompt: 'Research issue 42.',
    headRef: 'autodev/issue-42',
    customAgent: 'autodev-research',
  });

  assert.equal(task.id, 'task-123');
  assert.equal(request.options.headers['X-GitHub-Api-Version'], '2026-03-10');
  assert.deepEqual(JSON.parse(request.options.body), {
    prompt: 'Research issue 42.',
    head_ref: 'autodev/issue-42',
    custom_agent: 'autodev-research',
    create_pull_request: false,
  });
});

test('getTask validates the requested task ID and state', async () => {
  const client = createClient(async () => jsonResponse({
    id: 'task-123',
    state: 'completed',
    sessions: [],
  }));

  assert.equal((await client.getTask('task-123')).state, 'completed');
});

test('Agent Tasks API errors preserve status and response body', async () => {
  const client = createClient(async () => jsonResponse({ message: 'Forbidden' }, 403));
  await assert.rejects(
    client.getTask('task-123'),
    (error) => error instanceof AgentTasksApiError
      && error.status === 403
      && error.responseBody.message === 'Forbidden',
  );
});

test('task validation rejects unknown states and mismatched IDs', () => {
  assert.throws(
    () => validateAgentTask({ id: 'task-123', state: 'unknown' }),
    (error) => error instanceof AgentTasksApiError && error.status === 502,
  );
  assert.throws(
    () => validateAgentTask({ id: 'task-other', state: 'queued' }, 'task-123'),
    (error) => error instanceof AgentTasksApiError && error.status === 502,
  );
});
