# Copilot AutoDev

Copilot AutoDev is a proof of concept for automating a software development lifecycle through an issue-driven state machine. A deterministic GitHub Actions orchestrator owns workflow state and dispatches a GitHub Agentic Workflow for each AI-assisted state (Research, Design, SecurityReview, Implementation, and CodeReview). Every AI operation runs as an Agentic Workflow, so there is a single execution and safe-output model to learn and secure: the orchestrator only ever launches workflow runs and validates the structured callback each one posts.

See:

- [Initial requirements](.github/plans/initial-requirements.md)
- [Implementation plan](.github/plans/initial-implementation.plan.md)

## POC prerequisites

- GitHub Actions and Copilot cloud agent must be enabled for the repository.
- **Important:** Under **Settings > Actions > General > Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. The orchestrator's Initialization state uses the workflow `GITHUB_TOKEN` to open the issue tracking pull request; without this setting, PR creation fails with `403 Resource not accessible by integration` even though the workflow grants `pull-requests: write`.
- The user represented by `AUTODEV_CALLBACK_TOKEN` must have write access to the repository.
- A repository administrator must configure the Actions secret `AUTODEV_CALLBACK_TOKEN` and the POC labels before running the POC. No Copilot Agents secrets or repository MCP configuration are required — each Agentic Workflow is self-contained.
- `gh` and `gh-aw` v0.82.14 are needed to author or compile the AutoDev Agentic Workflows. The checked-in `copilot-setup-steps.yml` installs this version in Copilot cloud-agent sessions. A compiled `.lock.yml` workflow does not require the gh-aw CLI at runtime.

## Authentication and secrets

The POC uses two credential authorities:

| Credential | Secret location | Purpose | Minimum access |
| --- | --- | --- | --- |
| Workflow `GITHUB_TOKEN` | Created automatically by Actions | Orchestrator state, error, instruction, label, branch, and PR operations; Agentic Workflow repository reads and default safe-output writes | Granted explicitly by each workflow |
| `AUTODEV_CALLBACK_TOKEN` | Repository Actions secret | Let an Agentic Workflow's `add-comment` safe output post its `autodev-result:v1` callback so the comment triggers the orchestrator's `issue_comment` handler | Fine-grained PAT scoped to this repository with `Issues: read/write` |

The callback PAT has repository-level `Issues: write`, not a comment-only token scope. It is used only by the safe-output job that posts the callback comment; it is never exposed to the agent, its prompt, or the MCP server. For this POC, the Agentic Workflow safe-output allowlist provides the narrower single-comment boundary.

The orchestrator must use `GITHUB_TOKEN` for its own comments. Events caused by this token do not recursively start another workflow. Agentic Workflow callbacks use the callback PAT so that their comments do trigger the orchestrator. At startup, the orchestrator calls the authenticated-user endpoint with `AUTODEV_CALLBACK_TOKEN` and accepts automated result comments only from the returned login.

## How Agentic Workflows access GitHub

Every AI-assisted state is a GitHub Agentic Workflow (gh-aw) compiled to a self-contained `.lock.yml`. Each workflow is dispatched by the orchestrator and needs no separate Copilot MCP or Agents-secret configuration:

- The agent reads the repository through the built-in GitHub MCP server in `gh-proxy` mode, which uses the workflow's own least-privilege `GITHUB_TOKEN`.
- The agent never writes directly. It requests changes through **safe outputs**, which run as separate jobs after the agent finishes. Research pushes its artifact with `push-to-pull-request-branch` and posts its callback with `add-comment`.
- Only the callback `add-comment` job uses `AUTODEV_CALLBACK_TOKEN`; every other operation uses `GITHUB_TOKEN`.

This keeps a single execution and security model for all AI work: the agent proposes, safe outputs enforce, and the orchestrator validates every callback before advancing canonical state.

## Create labels

Create the exact POC labels below. `autodev` is the trigger label. The other three labels identify states requiring human attention. Canonical state remains in orchestrator-authored issue comments.

```powershell
$labels = @(
  'autodev',
  'autodev/ready-for-plan-review',
  'autodev/ready-for-code-review',
  'autodev/blocked'
)

foreach ($label in $labels) {
  gh label create $label --color 1f6feb --force
}
```

## Run JavaScript tests

The AutoDev orchestration modules use Node's built-in test runner and do not require an npm install. From the repository root, use Node.js 20 or later to run the complete suite:

```powershell
node --test .github/scripts/autodev/test/*.test.mjs
```

To run one test file while developing:

```powershell
node --test .github/scripts/autodev/test/task.test.mjs
```

## Validate setup

1. Confirm the Actions secret `AUTODEV_CALLBACK_TOKEN` exists.
2. Confirm the POC labels exist.
3. Run `node --test .github/scripts/autodev/test/*.test.mjs` and confirm the suite passes.
4. Run `gh aw --version` and confirm it matches the version pinned in `copilot-setup-steps.yml`.
5. Run `gh aw compile --validate` and confirm every AutoDev workflow compiles.

## Rotate the callback token

1. Create a replacement repository-scoped PAT with `Issues: read/write`.
2. Update the `AUTODEV_CALLBACK_TOKEN` Actions secret.
3. Post a callback comment from a disposable test execution and confirm the orchestrator processes it.
4. Revoke the old PAT after the secret has been updated.

Never include tokens in workflow logs, prompts, comments, committed files, or command history.
