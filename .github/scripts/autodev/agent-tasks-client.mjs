// Isolates the public-preview Agent Tasks API and its user-scoped credential.
// Callers receive validated task data but never access the token.
export const AGENT_TASK_STATES = Object.freeze([
  'queued',
  'in_progress',
  'completed',
  'failed',
  'idle',
  'waiting_for_user',
  'timed_out',
  'cancelled',
]);

export class AgentTasksApiError extends Error {
  constructor({ method, path, status, responseBody }) {
    super(`Agent Tasks API request failed: ${method} ${path} returned ${status}.`);
    this.name = 'AgentTasksApiError';
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

async function readResponseBody(response) {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AgentTasksApiError({
        method: 'PARSE',
        path: response.url,
        status: response.status,
        responseBody: text,
      });
    }
    throw error;
  }
}

export function validateAgentTask(task, expectedId) {
  if (task === null || typeof task !== 'object' || Array.isArray(task)) {
    throw new AgentTasksApiError({
      method: 'VALIDATE',
      path: '',
      status: 502,
      responseBody: { message: 'Agent Tasks API returned a non-object response.' },
    });
  }
  assertNonEmptyString(task.id, 'task.id');
  if (expectedId !== undefined && task.id !== expectedId) {
    throw new AgentTasksApiError({
      method: 'VALIDATE',
      path: '',
      status: 502,
      responseBody: { message: `Expected task ${expectedId}, received ${task.id}.` },
    });
  }
  if (!AGENT_TASK_STATES.includes(task.state)) {
    throw new AgentTasksApiError({
      method: 'VALIDATE',
      path: '',
      status: 502,
      responseBody: { message: `Unknown Agent Task state: ${String(task.state)}.` },
    });
  }

  return Object.freeze({ ...task });
}

export class AgentTasksClient {
  #fetchImpl;
  #token;

  constructor({
    owner,
    repo,
    token,
    fetchImpl = globalThis.fetch,
    apiUrl = 'https://api.github.com',
  }) {
    assertNonEmptyString(owner, 'owner');
    assertNonEmptyString(repo, 'repo');
    assertNonEmptyString(token, 'token');
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('fetchImpl must be a function.');
    }

    this.owner = owner;
    this.repo = repo;
    this.#token = token;
    this.#fetchImpl = fetchImpl;
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  taskPath(suffix = '') {
    return `/agents/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/tasks${suffix}`;
  }

  async request(method, path, { body } = {}) {
    const response = await this.#fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.#token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'copilot-autodev-poc',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      throw new AgentTasksApiError({
        method,
        path,
        status: response.status,
        responseBody,
      });
    }
    return responseBody;
  }

  async startTask({
    prompt,
    headRef,
    customAgent,
    model,
  }) {
    for (const [fieldName, value] of Object.entries({
      prompt,
      headRef,
      customAgent,
    })) {
      assertNonEmptyString(value, fieldName);
    }

    const body = {
      prompt,
      head_ref: headRef,
      custom_agent: customAgent,
      create_pull_request: false,
    };
    if (model !== undefined) {
      assertNonEmptyString(model, 'model');
      body.model = model;
    }

    return validateAgentTask(await this.request('POST', this.taskPath(), { body }));
  }

  async getTask(taskId) {
    assertNonEmptyString(taskId, 'taskId');
    const path = this.taskPath(`/${encodeURIComponent(taskId)}`);
    return validateAgentTask(await this.request('GET', path), taskId);
  }
}
