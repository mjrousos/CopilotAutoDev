# Copilot AutoDev

Copilot AutoDev is a proof of concept for automating a software development lifecycle through an issue-driven state machine. A deterministic GitHub Actions orchestrator owns workflow state and launches asynchronous Copilot Agent Tasks for Research, Design, SecurityReview, and Implementation. CodeReview is implemented as a GitHub Agentic Workflow to demonstrate its read-only agent and safe-output model.

See:

- [Initial requirements](.github/plans/initial-requirements.md)
- [Implementation plan](.github/plans/initial-implementation.plan.md)

## POC prerequisites

- GitHub Actions and Copilot cloud agent must be enabled for the repository.
- **Important:** Under **Settings > Actions > General > Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. The orchestrator's Initialization state uses the workflow `GITHUB_TOKEN` to open the issue tracking pull request; without this setting, PR creation fails with `403 Resource not accessible by integration` even though the workflow grants `pull-requests: write`.
- The user represented by the Agent Tasks credential must have write access to the repository and a Copilot plan for which the Agent Tasks API is enabled. The current REST API documentation lists Copilot Business or Enterprise for starting tasks.
- A repository administrator must configure Actions secrets, Copilot Agents secrets, repository MCP access, and labels before running the POC.
- `gh` and `gh-aw` v0.82.14 are needed to author or compile the CodeReview Agentic Workflow. The checked-in `copilot-setup-steps.yml` installs this version in Copilot cloud-agent sessions. A compiled `.lock.yml` workflow does not require the gh-aw CLI at runtime.

## Authentication and secrets

The POC separates three credential authorities. The callback PAT is stored in both Actions and Agents secret stores, producing four secret/context entries:

| Credential | Secret location | Purpose | Minimum access |
| --- | --- | --- | --- |
| Workflow `GITHUB_TOKEN` | Created automatically by Actions | Orchestrator state, error, instruction, label, branch, and PR operations | Granted explicitly by each workflow |
| `AUTODEV_AGENT_TASKS_TOKEN` | Repository Actions secret | Start and inspect Agent Tasks | User-to-server token with repository `Agent tasks: read/write` |
| `AUTODEV_CALLBACK_TOKEN` | Repository Actions secret | Let the CodeReview safe-output callback trigger `issue_comment` | Fine-grained PAT scoped to this repository with `Issues: read/write` |
| `COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN` | Repository or organization Agents secret | Let Agent Task agents call only the allowlisted GitHub MCP callback tool | The same POC PAT as `AUTODEV_CALLBACK_TOKEN`, or an equivalent repository-scoped PAT with `Issues: read/write` |

The Agent Tasks API supports fine-grained PATs and GitHub App user access tokens. GitHub App installation tokens are not supported. The Agent Tasks credential is tied to a specific user and Copilot entitlement; record its owner in the repository's operational records.

The callback PAT has repository-level `Issues: write`, not a comment-only token scope. For this POC, the MCP and Agentic Workflow tool allowlists provide the narrower `add_issue_comment` boundary. Never use the Agent Tasks token as a callback token, and never expose it to an agent.

The orchestrator must use `GITHUB_TOKEN` for its own comments. Events caused by this token do not recursively start another workflow. External execution callbacks use the callback PAT so that their comments do trigger the orchestrator. At startup, the orchestrator calls the authenticated-user endpoint with `AUTODEV_CALLBACK_TOKEN` and accepts automated result comments only from the returned login.

## Configure Copilot MCP access

The committed `.github/mcp.json` configures tools for compatible local or Copilot development environments. It does **not** configure MCP access for Copilot cloud agent on GitHub.com.

Configure cloud access in **Repository Settings > Copilot > MCP servers**. Repository MCP settings apply to Copilot cloud agent and, unless disabled separately, Copilot code review.

Use two narrowly scoped GitHub MCP connections:

1. A read-only connection for repository context and the `web_search` toolset used by Research.
2. A write-enabled connection that exposes only `add_issue_comment`.

The repository MCP configuration should follow this shape:

```json
{
  "mcpServers": {
    "github-mcp-server": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/readonly",
      "tools": ["*"],
      "headers": {
        "X-MCP-Toolsets": "repos,issues,pull_requests,web_search"
      }
    },
    "autodev-github-callback": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "tools": ["add_issue_comment"],
      "headers": {
        "Authorization": "Bearer $COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN",
        "X-MCP-Toolsets": "issues"
      }
    }
  }
}
```

Add the Agents secret `COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN` after saving the MCP configuration. The callback server's `Authorization` header references this secret through repository MCP variable substitution. Tool names and preview behavior may change; validate that only the expected tools are listed in the Copilot session's **Start MCP Servers** logs before running AutoDev.

Do not add `AUTODEV_AGENT_TASKS_TOKEN` to Agents secrets or to MCP configuration.

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

1. Confirm the Actions secrets `AUTODEV_AGENT_TASKS_TOKEN` and `AUTODEV_CALLBACK_TOKEN` exist.
2. Confirm the Agents secret `COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN` exists.
3. Assign a temporary issue to Copilot and inspect **View session > Start MCP Servers**:
   - The read-only connection exposes only expected read/search tools.
   - The callback connection exposes `add_issue_comment` and no other write tool.
4. Use the Agent Tasks token to call the repository task-list endpoint and confirm it returns successfully without printing the token:

   ```powershell
   $env:GH_TOKEN = '<load from a secure secret store>'
   gh api `
     -H 'X-GitHub-Api-Version: 2026-03-10' `
     /agents/repos/OWNER/REPOSITORY/tasks
   Remove-Item Env:\GH_TOKEN
   ```

5. Run `gh aw --version` and confirm it matches the version pinned in `copilot-setup-steps.yml`.
6. Run `gh aw compile --validate` after the CodeReview source workflow is added.

## Rotate credentials

### Agent Tasks token

1. Create a replacement user-to-server token with the required Agent Tasks permissions.
2. Update `AUTODEV_AGENT_TASKS_TOKEN`.
3. Confirm the task-list endpoint succeeds with the replacement.
4. Allow tasks launched with the old identity to finish or reconcile them.
5. Revoke the old token.

If the owning user loses repository access or their Copilot entitlement, rotate this credential immediately.

### Callback token

1. Create a replacement repository-scoped PAT with `Issues: read/write`.
2. Update both `AUTODEV_CALLBACK_TOKEN` and the Agents secret `COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN`.
3. Validate the MCP tool list and post a callback comment from a disposable test execution.
4. Revoke the old PAT only after both secret stores have been updated.

Never include tokens in workflow logs, prompts, comments, committed MCP files, or command history.
