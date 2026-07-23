# Copilot AutoDev repository instructions

## Commands

Use Node.js 20 or later. The JavaScript orchestration code has no npm dependencies.

Run the full JavaScript test suite from the repository root:

```powershell
node --test .github/scripts/autodev/test/*.test.mjs
```

Run one test file:

```powershell
node --test .github/scripts/autodev/test/task.test.mjs
```

When changing a GitHub Agentic Workflow source file under `.github/workflows/*.md`, validate and regenerate its lock workflow:

```powershell
gh aw compile <workflow-name>
gh aw compile --validate
```

Keep the local gh-aw version aligned with the version pinned in `.github/workflows/copilot-setup-steps.yml`.

## Architecture

AutoDev is an issue-driven SDLC state machine. `.github/workflows/autodev-orchestrator.yml` performs event filtering and permission checks, then runs `.github/scripts/autodev/main.mjs`.

`main.mjs` normalizes GitHub event context and constructs the GitHub client. `dispatcher.mjs` determines the requested state from the trigger or `autodev-result:v1` comment and routes to a state-specific module under `handlers/`. Keep state execution logic out of the dispatcher; add one handler file per state.

Canonical state is an append-only chain of orchestrator-authored `autodev-task:v1` issue comments containing task/state metadata. Automated workers and trusted humans request transitions using `autodev-result:v1`; only the orchestrator validates a request and writes canonical task metadata. The highest valid contiguous sequence is authoritative.

The core modules have distinct responsibilities:

- `config.mjs` owns state names, handler mappings, transitions, labels, branch/artifact conventions, and change policies.
- `comments.mjs` parses and validates versioned result and artifact-decision contracts.
- `task.mjs` validates, formats, and selects canonical current-task comments.
- `transitions.mjs` is the central transition-request validator.
- `validation.mjs` owns trusted-author and repository-path/change-policy checks.
- `github-client.mjs` wraps only the GitHub REST operations currently needed by implemented milestones.

Research, Design, SecurityReview, and Implementation are planned as asynchronous Copilot Agent Tasks. CodeReview is planned as a GitHub Agentic Workflow with read-only agent permissions and safe outputs. See `.github/plans/initial-requirements.md` and `.github/plans/initial-implementation.plan.md` before changing behavior or scope.

## Conventions

- Use dependency-free ECMAScript modules (`.mjs`) and Node built-ins. Do not add a package manifest or dependency for functionality that is straightforward with the platform.
- Keep the POC lean: do not add REST methods, workflow permissions, handlers, or abstractions before the milestone that uses them.
- Put each state handler in `.github/scripts/autodev/handlers/<state>.mjs`; the dispatcher only determines state and invokes the matching handler.
- Add focused tests under `.github/scripts/autodev/test/` alongside every contract or handler change. Tests use `node:test` and `node:assert/strict`.
- Treat contract schemas as strict, versioned interfaces. Validators reject unknown fields, unsupported versions, stale attempts, mismatched states, refs, SHAs, and artifact paths.
- Add or change states, transitions, handler types, labels, artifact names, and file policies only in `config.mjs`; other modules consume that configuration.
- Validate files changed by an execution against the preceding canonical `headSha`, not against the default branch. Documentation agents may modify only their issue-specific artifact; Implementation must not modify AutoDev control files or any issue artifacts.
- Use `ContractValidationError` with stable error codes for invalid external input. Catch only expected validation errors; allow unexpected failures to surface.
- Preserve immutable contracts and return values with `Object.freeze`, matching the existing modules.
- The only labels are `autodev`, `autodev/ready-for-plan-review`, `autodev/ready-for-code-review`, and `autodev/blocked`. State transitions remain authoritative in issue comments.
- Orchestrator comments use the workflow `GITHUB_TOKEN` so they do not retrigger Actions. External callbacks use a separate callback identity. Never expose `AUTODEV_AGENT_TASKS_TOKEN` to agents, prompts, MCP servers, comments, or logs.
- Keep workflow permissions at least privilege. Add `pull-requests: write` only with PR operations and `actions: write` only when workflow dispatch is implemented.
- Workflow-level conditions are an optimization only. Repeat authorization, marker parsing, and transition validation in JavaScript before mutations.
- For gh-aw work, use the repository `agentic-workflows` skill/agent. Edit the `.md` source workflow, compile it, and commit the generated `.lock.yml`; never hand-edit a lock workflow. `.github/workflows/*.lock.yml` is generated content.
- Keep `.github/plans/initial-implementation.plan.md` synchronized with completed milestones and architectural decisions.
