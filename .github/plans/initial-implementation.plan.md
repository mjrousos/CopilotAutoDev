# Copilot AutoDev POC Implementation Plan

## Problem and approach

Implement the proof-of-concept described in `.github/plans/initial-requirements.md` as an issue-driven SDLC state machine. A deterministic JavaScript orchestrator will own canonical state, transition validation, branch management, Agent Task dispatch, pull request creation, and recovery. Research, Design, SecurityReview, and Implementation will run as asynchronous Copilot Agent Tasks using repository custom agents. CodeReview will run as a GitHub Agentic Workflow to demonstrate gh-aw safe outputs. Human plan and code-review decisions will be accepted through structured HTML markers from trusted repository collaborators.

The implementation will be delivered in independently usable milestones. Each milestone must leave the repository in a testable state and include its own focused validation before later states are added.

## Confirmed decisions

- Use plain JavaScript and Node's built-in `node:test` runner; avoid a build or bundling step.
- Include scheduled stale-execution reconciliation as the final functional POC milestone, after the happy path works.
- Use structured HTML comments for all decisions.
- Use the same `autodev-result:v1` schema for automated and human transition requests; authorization and field requirements vary by author rather than by marker type.
- Trust human decisions only from comments whose `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR`.
- The orchestrator, not the Implementation agent, creates or reuses the implementation pull request.
- Store only the current `state` and its orchestrator-recorded `executionId` in each `autodev-task:v1` record; append-only comments provide history.
- CodeReview is an advisory Agentic Workflow. It may post findings and request implementation changes, but a human performs the final code-review decision.
- POC research, design, and security artifacts remain on the issue branch and are included in the implementation pull request.
- Use GitHub.com and the Agent Tasks API version documented in the requirements. Isolate preview API behavior behind a small client module.
- Use `GITHUB_TOKEN` for orchestrator-authored state, error, and instruction comments so those comments do not recursively trigger the orchestrator. Only external execution callbacks use the non-`GITHUB_TOKEN` callback identity.
- Represent retry exhaustion or executions requiring intervention as canonical `Blocked` state, not only as a label.

## Planned repository structure

```text
.github/
  agents/
    autodev-research.agent.md
    autodev-design.agent.md
    autodev-security-review.agent.md
    autodev-implementation.agent.md
  autodev/
    issue-artifact-template.md
  plans/
    initial-implementation.plan.md
  scripts/
    autodev/
      main.mjs
      config.mjs
      task.mjs
      transitions.mjs
      comments.mjs
      github-client.mjs
      agent-tasks-client.mjs
      dispatcher.mjs
      handlers/
        initialization.mjs
      validation.mjs
      reconcile.mjs
      test/
        config.test.mjs
        github-client.test.mjs
        main.test.mjs
        task.test.mjs
        transitions.test.mjs
        comments.test.mjs
        validation.test.mjs
        dispatcher.test.mjs
        initialization.test.mjs
        reconcile.test.mjs
  workflows/
    autodev-orchestrator.yml
    autodev-code-review.md
    autodev-code-review.lock.yml
    autodev-reconcile.yml
README.md
```

The exact module split may be collapsed if implementation reveals that a module has no independent responsibility. Keep the event entry point thin and place parsing, validation, and transition logic in pure testable functions.

## Milestone 0: Publish the approved plan and document prerequisites - Complete

**Status:** Complete as of 2026-07-22.

1. [x] Copy this approved session plan to `.github/plans/initial-implementation.plan.md`.
2. [x] Update the requirements where implementation needs an explicit contract:
   - Add `HumanCodeReview` and terminal `Completed` behavior.
   - Define one transition-result marker schema for Agent Tasks, Agentic Workflows, human reviewers, and future local Copilot tools.
   - Clarify that edited or deleted comments are ignored for the POC; only newly created comments are processed.
3. [x] Document required repository configuration:
   - `AUTODEV_AGENT_TASKS_TOKEN`: user-to-server token with Agent Tasks read/write permission, stored as an Actions secret and never exposed to agents.
   - `AUTODEV_CALLBACK_TOKEN`: repository-scoped token used only for agent or Agentic Workflow issue callbacks; it must be distinct from the Agent Tasks token. A fine-grained PAT requires `issues: write`, so the POC's comment-only boundary is enforced primarily by the MCP/safe-output tool allowlist rather than by a comment-specific token permission.
   - An Agents secret or repository MCP configuration exposing only the GitHub `add_issue_comment` write operation to Agent Task agents.
   - Read-only GitHub MCP access plus the `web_search` toolset for the Research agent.
   - gh-aw v0.82.14 or the repository-pinned version for authoring and compiling the CodeReview source workflow. `copilot-setup-steps.yml` installs it in the Copilot cloud-agent environment; the compiled CodeReview lock workflow is self-contained and does not require the CLI at runtime.
4. [x] Define the POC label contract in the requirements and setup documentation; Milestone 1 will encode these values in `config.mjs`:
   - `autodev` as the trigger and reconciliation-discovery label.
   - `autodev/ready-for-plan-review`, `autodev/ready-for-code-review`, and `autodev/blocked` as the only state labels because they identify states requiring human attention.
5. [x] Record manual setup and secret-rotation steps in `README.md`; never commit token values.

**Completion criteria**

- [x] The approved plan exists at the requested repository path.
- [x] Required secrets, MCP capabilities, labels, and GitHub/Copilot plan prerequisites are documented with least-privilege permissions.
- [x] The requirements contain complete callback, human-review, recovery, and terminal-state contracts.

## Milestone 1: Build and test the state-machine core - Complete

**Status:** Complete as of 2026-07-22.

1. [x] Create `config.mjs` containing:
   - State constants and the fixed handler mapping.
   - Allowed transition graph:
     - Initialization -> Research
     - Research -> Design
     - Design -> Research or SecurityReview
     - SecurityReview -> Design or HumanPlanReview
     - HumanPlanReview -> Design or Implementation
     - Implementation -> CodeReview
     - CodeReview -> Implementation or HumanCodeReview
     - HumanCodeReview -> Implementation or Completed
     - Any automated state -> Blocked when bounded recovery is exhausted or human intervention is required
     - Blocked -> the most recent task state preceding Blocked, after a trusted human retry decision
   - Branch naming convention `autodev/issue-<number>`.
   - Artifact paths under `.github/autodev/issues/<number>/`.
   - Allowed changed-file patterns per Agent Task state.
2. [x] Implement current-task parsing and serialization for `<!-- autodev-task:v1 ... -->` comments:
   - Validate schema version, issue number, sequence, current state, execution ID, attempt, ref, SHA, and timestamp.
   - Select the highest valid orchestrator-authored sequence.
   - Reject malformed, duplicate-sequence, sequence-gap, wrong-issue, unknown-version, and non-orchestrator task comments.
3. [x] Define and implement the unified transition-result marker:

   ```text
   <!-- autodev-result:v1
   {
     "schemaVersion": 1,
     "issue": 42,
     "state": "research",
     "attempt": 1,
     "outcome": "success",
     "nextState": "design",
     "decisionRationale": "Research is complete and the requirements are actionable.",
     "headRef": "autodev/issue-42",
     "headSha": "...",
     "artifacts": [".github/autodev/issues/42/research.md"]
   }
   -->
   ```

   - Automated executions use `outcome: "success"` for a normal transition and report their artifacts.
   - Human-authored results use the same marker with `outcome: "approved"`, `"changes-requested"`, or `"retry"` and may use an empty `artifacts` array.
   - Both forms require the current state, requested `nextState`, current branch and SHA, attempt, and decision rationale.
4. [x] Implement transition validation independently from GitHub API operations.
5. [x] Require every decision-state artifact to contain a machine-readable decision block with `nextState` and rationale. The callback repeats this decision, but the committed artifact is the recovery source if the callback is lost.
6. [x] Add `node:test` coverage for valid and invalid task comments, automated and human-authored result comments, sequence selection, transition loops, Blocked/retry behavior, terminal transitions, and trusted author associations.

**Completion criteria**

- [x] `node --test .github/scripts/autodev/test/*.test.mjs` passes.
- [x] All state transitions and comment contracts can be exercised without GitHub access.
- [x] No handler can bypass the central transition validator.

## Milestone 2: Wire the orchestrator workflow and Initialization - Complete

**Status:** Complete as of 2026-07-22.

1. [x] Create `.github/workflows/autodev-orchestrator.yml` with:
   - `issues: [labeled]` for the trigger label.
   - `issue_comment: [created]` for automated and human-authored result comments.
   - `workflow_dispatch` inputs for issue number and reconciliation/manual reruns.
   - One normalized issue-number expression shared by all triggers, including a coalesce over `github.event.issue.number` and `workflow_dispatch` input, and one per-issue concurrency group derived from that normalized value.
   - Explicit least-privilege `issues` and `contents` permissions required by Initialization.
2. [x] Pin a Node LTS version that supports built-in `fetch` and `node:test`, check out the default branch, and run `main.mjs` with normalized event data supplied through environment variables or the GitHub event JSON path.
3. [x] Implement a small GitHub REST client using Node's built-in `fetch`:
   - Read issue comments with pagination.
   - Read repository/default-branch metadata and refs.
   - Create the issue branch if absent and verify it points at the expected base commit.
   - Create comments and add/remove only configured labels.
   - Use the workflow `GITHUB_TOKEN` for all orchestrator-authored canonical, error, and instruction comments so those writes do not trigger another workflow run.
4. [x] Implement Initialization idempotently:
   - Ignore labels other than the configured trigger label.
   - Do nothing if valid canonical state already exists.
   - Create or verify `autodev/issue-<number>`.
   - Produce the initial canonical transition toward Research.
5. [x] Add defense-in-depth event filtering:
   - Ignore canonical `autodev-task` comments as trigger inputs.
   - Ignore comments authored by the orchestrator identity.
   - Process external execution results and trusted human-authored results only.
6. [x] Initially support a dry-run handler for Research so Initialization can be validated before real Agent Tasks are enabled.
7. [x] Add mocked-fetch tests covering pagination, existing branches, duplicate trigger events, canonical comment creation, self-authored comment suppression, consistent concurrency inputs, and API failures.

**Completion criteria**

- [x] Repeated trigger-label events create one branch and one logical initialization.
- [x] The issue contains a valid sequence-1 canonical state record.
- [x] Duplicate events do not create duplicate branches or state transitions.

## Milestone 3: Integrate Agent Tasks and complete Research

1. Implement `agent-tasks-client.mjs` around:
   - `POST /agents/repos/{owner}/{repo}/tasks`
   - `GET /agents/repos/{owner}/{repo}/tasks/{task_id}`
   - Required preview headers and explicit error reporting.
   - `base_ref`, existing `head_ref`, `custom_agent`, and `create_pull_request: false`.
2. Keep the Agent Tasks token isolated to the client and workflow environment. Never include it in prompts, branches, artifacts, or agent MCP configuration.
3. Create `autodev-research.agent.md`:
   - Restrict it to Research responsibilities and the Research artifact path.
   - Give it read/search/edit/execute capabilities, read-only repository access, configured web search, and only the callback issue-comment write tool.
   - Require citations or source links in the research artifact.
   - Require a final structured callback whose branch, SHA, artifact path, and requested next state match the task prompt.
   - Merge the agent definition to the default branch before attempting a live Agent Task, because cloud custom-agent resolution uses repository-visible/default-branch agent definitions.
4. Launch Research with a deterministic prompt containing issue context, branch/ref expectations, artifact path, allowed paths, and callback contract. Record the returned Agent Task ID in the new Research `autodev-task` comment.
5. Process Research callbacks:
   - Verify callback actor identity.
   - Match state, attempt, branch, and current canonical task.
   - Query and validate the Agent Task identified by the current task record's `executionId`.
   - Verify the reported SHA is the branch head.
   - Diff the previous canonical `headSha` against the newly reported `headSha` and reject files added by this execution outside the Research allowlist. Do not validate against the repository base branch, because the shared branch already contains prior-state artifacts.
   - Verify the Research artifact exists at the reported SHA.
   - Transition to Design only after all checks pass.
6. Add integration-style tests using mocked Agent Tasks and GitHub API responses.

**Completion criteria**

- A labeled test issue progresses from Initialization through a real Research Agent Task.
- Research commits its artifact to the shared issue branch.
- A valid callback causes exactly one canonical Research -> Design transition.
- Invalid callbacks or out-of-scope changes are rejected with a visible error comment and no transition.

## Milestone 4: Add Design and SecurityReview, including feedback loops

1. Create `autodev-design.agent.md`:
   - Consume the issue, Research artifact, and any prior security or human feedback.
   - Write only the issue Design artifact.
   - Request Research when specific missing research is identified; otherwise request SecurityReview.
   - Persist the selected `nextState` and rationale in a machine-readable block in the committed Design artifact so reconciliation does not depend solely on the callback.
2. Create `autodev-security-review.agent.md`:
   - Consume the Design artifact and relevant code.
   - Produce a threat model and security-review artifact.
   - Request Design when blocking findings require changes; otherwise request HumanPlanReview.
   - Persist the selected `nextState` and rationale in a machine-readable block in the committed SecurityReview artifact.
3. Reuse the shared Agent Task launcher and callback validator with state-specific policies rather than duplicating orchestration logic.
4. Validate allowed file paths and required artifacts independently for each state by diffing the preceding canonical `headSha` against the callback `headSha`.
5. Increment attempts on each re-entry and include prior feedback in prompts.
6. Protect against stale callbacks from previous Design or SecurityReview attempts.
7. Add tests for Research <-> Design and Design <-> SecurityReview loops, stale attempts, missing artifacts, and invalid requested transitions.

**Completion criteria**

- The POC can traverse the complete Research -> Design -> SecurityReview path.
- Design can return to Research and SecurityReview can return to Design without accepting stale callbacks.
- Every loop produces a new append-only canonical sequence and preserves prior artifacts/history.

## Milestone 5: Implement HumanPlanReview, Implementation, and deterministic PR creation

1. When SecurityReview requests HumanPlanReview:
   - Add the ready-for-plan-review label.
   - Post visible instructions and an example human-authored `autodev-result:v1` marker.
   - Store the exact reviewed `headSha` in canonical state.
2. Accept human-authored result comments only when:
   - The current state is HumanPlanReview.
   - `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR`.
   - The result requests an allowed `nextState` and references the current branch head SHA.
   - The comment was created, not edited.
3. Route `request-changes` to Design with the review summary and `approve` to Implementation.
4. Create `autodev-implementation.agent.md`:
   - Consume the approved Design and SecurityReview artifacts plus human feedback.
   - Modify implementation and test files while preserving the approved artifacts.
   - Run the repository's existing tests/builds when available.
   - Never create the pull request itself.
   - Report a structured callback with the final head SHA and Implementation outcome.
5. After callback validation, have the orchestrator:
   - Add `pull-requests: write` to the orchestrator workflow when PR operations are introduced.
   - Verify changed files between the preceding canonical SHA and the reported Implementation SHA, plus the final branch head.
   - Create or reuse one pull request from the issue branch to the default branch.
   - Link the issue and include artifact links and the approved SHA in the PR body.
   - Transition to CodeReview.
6. Add tests for authorization, SHA-bound approvals, duplicate human comments, stale approval rejection, PR idempotency, and implementation callback validation.

**Completion criteria**

- A trusted reviewer can approve or return a plan using the same result marker as automated executions.
- An approved plan launches Implementation on the existing branch.
- Exactly one orchestrator-owned pull request is created or reused.

## Milestone 6: Implement CodeReview as a GitHub Agentic Workflow

1. Create `.github/workflows/autodev-code-review.md` with `workflow_dispatch` inputs:
   - Issue number
   - Pull request number
   - Expected head SHA
   - Correlation/execution ID
2. Keep the agent job read-only:
   - `contents: read`, `issues: read`, and `pull-requests: read`.
   - Use `tools.github.mode: gh-proxy` with only required repositories, pull-request, and issue toolsets.
   - Pre-fetch compact PR metadata, changed files, checks, and diff data into `/tmp/gh-aw/data/`.
3. Configure narrow safe outputs:
   - `create-pull-request-review-comment` with a conservative maximum.
   - A summary PR comment.
   - Allowed review-result labels only.
   - An issue callback comment containing the structured AutoDev result marker.
   - `noop` when no visible finding is necessary.
   - Configure every review, label, summary, and callback output with an explicit target derived from the dispatched issue or PR input; a `workflow_dispatch` run has no implicit triggering issue/PR target. If a built-in handler cannot accept the expression directly, use `target: "*"` and require the output target to exactly match the sanitized dispatch input.
4. Treat the automated review as advisory:
   - Findings requiring changes request transition to Implementation.
   - A clean review requests transition to HumanCodeReview.
   - It does not satisfy or replace human approval requirements.
5. Configure only the issue callback comment to use `AUTODEV_CALLBACK_TOKEN` or an equivalent GitHub App identity so that it triggers the orchestrator; leave PR review comments and labels on the safe output's normal workflow identity unless a separate identity is required.
6. Compile with `gh aw compile autodev-code-review`, commit both source `.md` and generated `.lock.yml`, and keep the pinned gh-aw version consistent with setup steps.
7. Add orchestrator dispatch logic using the unique correlation ID and expected SHA.
   - Add `actions: write` to the orchestrator workflow when Agentic Workflow dispatch is introduced.
8. Validate Agentic Workflow callbacks using the same canonical transition validator, with state-specific correlation and SHA checks.
9. Implement HumanCodeReview result comments using the unified marker:
   - `request-changes` returns to Implementation.
   - `approve` requires the current PR head SHA and transitions to Completed after the PR is merged, or records readiness and waits for merge according to the final requirements wording.

**Completion criteria**

- CodeReview runs through gh-aw, posts safe review output, and calls back to the issue.
- Review findings can return the state machine to Implementation.
- A clean automated review reaches HumanCodeReview without being treated as formal human approval.
- The gh-aw source compiles successfully and the lock file is current.

## Milestone 7: Add scheduled reconciliation and bounded recovery

1. Create `.github/workflows/autodev-reconcile.yml` on a conservative schedule plus manual dispatch.
2. Find AutoDev issues using the persistent `autodev` trigger label and parse each latest canonical state.
3. For stale Agent Task states:
   - Query the recorded task ID.
   - Leave queued or in-progress tasks alone until a hard deadline.
   - Reconcile completed tasks whose callback was missed by validating branch artifacts. For decision states, read the persisted machine-readable decision from the artifact before synthesizing the transition; never guess a route.
   - Retry failed, timed-out, cancelled, or missing tasks up to a configured maximum.
   - Transition `idle` or `waiting_for_user` tasks to canonical Blocked state for human attention.
4. Detect launches that failed before their task ID was recorded:
   - List recent repository Agent Tasks.
   - Correlate candidates using branch artifact, head ref, creation window, and the deterministic execution correlation included in the task prompt/session details.
   - Adopt a single unambiguous matching task; transition to Blocked rather than guessing when multiple candidates match.
5. For stale CodeReview workflow execution:
   - Locate the run by workflow and correlation information where possible.
   - Redispatch only when no matching active or completed run exists.
6. Dispatch per-issue reconciliation through the primary orchestrator workflow so normal per-issue concurrency and transition validation remain authoritative.
7. Add configuration for stage-specific stale thresholds, hard deadlines, and maximum attempts.
8. Add tests for every Agent Task state, missed callbacks, persisted decision recovery, orphan launch adoption, ambiguous orphan blocking, retry exhaustion, and duplicate reconciliation runs.

**Completion criteria**

- The reconciler never launches a second worker while a matching execution is active.
- Missed callbacks can be recovered without bypassing artifact and transition validation.
- Exhausted or interactive tasks enter canonical Blocked state rather than relying on a non-authoritative label or retrying indefinitely.

## Milestone 8: End-to-end validation, hardening, and demonstration

1. Run all unit and mocked integration tests in one command documented in `README.md`.
2. Compile and validate the Agentic Workflow.
3. Exercise live scenarios with dedicated test issues:
   - Straight-through happy path.
   - Design requests more Research.
   - SecurityReview requests Design changes.
   - Human plan changes then approval.
   - CodeReview requests Implementation changes.
   - Missed callback recovered by reconciliation.
   - Invalid actor, stale SHA, duplicate callback, and disallowed-file rejection.
4. Confirm canonical comments remain append-only and the three human-attention labels accurately reflect the latest canonical state.
5. Confirm secrets are absent from logs, comments, prompts, commits, and generated workflow artifacts.
6. Document the demonstration procedure, architecture diagram, known POC limitations, and production decisions still open:
   - Replace the generic write-enabled MCP comment tool with a dedicated callback tool.
   - Decide between Agent Tasks and gh-aw as the single production execution model.
   - Replace PATs with a managed user-to-server credential strategy when supported.
   - Consider tamper-resistant state storage, richer status, stronger reviewer policy, cost budgets, and preview API compatibility.

**Completion criteria**

- The full workflow can be demonstrated from label application through human code review and completion.
- Negative-path tests show that invalid transitions, actors, SHAs, and file modifications do not advance state.
- Setup, operation, recovery, and limitations are understandable without reading the implementation.

## Cross-cutting implementation rules

- The orchestrator is the only writer of canonical `autodev-task` records.
- The orchestrator uses `GITHUB_TOKEN` for its comments; only external callback comments use `AUTODEV_CALLBACK_TOKEN`.
- Agents and Agentic Workflows submit requests; they never directly choose an authoritative transition.
- Re-read canonical state immediately before every mutation and use per-issue concurrency.
- Keep GitHub API, Agent Tasks API, parsing, transition, and handler logic separately testable.
- Surface errors as visible issue comments consistent with the workflow; do not silently ignore invalid callbacks.
- Never expose the Agent Tasks credential to an agent or MCP server.
- Validate every reported branch, SHA, artifact, execution ID, attempt, and changed-file set.
- Validate each execution's changed files against the preceding canonical `headSha`, not against the default branch.
- Use exact workflow/action versions and retain the generated gh-aw lock file.
- Do not expand the POC callback token into general repository write access.

## Out of scope for this POC

- The future local HumanPlanReview conversational agent.
- The Copilot App canvas visualization.
- Cross-repository orchestration.
- Automatic merge.
- Production-grade external state storage.
- A dedicated callback MCP service; the restricted GitHub MCP comment operation is the temporary POC mechanism.
- Comprehensive cost accounting beyond logging execution IDs, attempts, and workflow/task links.

## Notes and risks

- The Agent Tasks API is public preview and requires a user-to-server credential. The client must fail explicitly when permissions, subscription, or API behavior are incompatible.
- The Agent Tasks credential is tied to a specific user identity and Copilot entitlement. Setup documentation must identify its owner, rotation procedure, and demo reproducibility implications.
- A workflow-created comment using `GITHUB_TOKEN` will not trigger the issue-comment orchestrator. Agentic Workflow callback authentication is therefore part of the functional design, not optional hardening.
- Conversely, orchestrator comments must use `GITHUB_TOKEN`; using the callback PAT/App identity for canonical comments would retrigger the workflow and could create a comment loop.
- `workflow_dispatch` does not necessarily return a workflow run ID. Use the caller-generated correlation ID as the canonical CodeReview execution ID and include it in the run name and callback.
- Starting an external execution and recording its ID cannot be fully atomic. The reconciliation milestone must detect incomplete launch records and avoid duplicate work; until then, the happy-path milestones should document this POC limitation.
- The implementation must not assume `.github/mcp.json` alone configures cloud-agent repository MCP access. Repository Copilot settings and Agents secrets require explicit setup.
- The callback PAT's real token-level blast radius is repository `issues: write`; the POC depends on MCP and safe-output tool allowlists to narrow that capability to comments. This residual prompt-injection risk must be demonstrated and documented.
