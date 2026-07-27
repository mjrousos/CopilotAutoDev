# Copilot AutoDev POC Implementation Plan

## Problem and approach

Implement the proof-of-concept described in `.github/plans/initial-requirements.md` as an issue-driven SDLC state machine. A deterministic JavaScript orchestrator will own canonical state, transition validation, branch management, Agentic Workflow dispatch, pull request creation, and recovery. Every AI-assisted state — Research, Design, SecurityReview, Implementation, and CodeReview — runs as a GitHub Agentic Workflow (gh-aw) dispatched by the orchestrator, so the POC has a single AI execution model built on gh-aw safe outputs. Human plan and code-review decisions will be accepted through structured `autodev-result:v1` markers from trusted repository collaborators.

The implementation will be delivered in independently usable milestones. Each milestone must leave the repository in a testable state and include its own focused validation before later states are added.

## Confirmed decisions

- Use plain JavaScript and Node's built-in `node:test` runner; avoid a build or bundling step.
- Include scheduled stale-execution reconciliation as the final functional POC milestone, after the happy path works.
- Use structured `autodev-result:v1` fenced code-block markers for all decisions. gh-aw strips HTML comments from safe-output bodies, so the marker is a fenced code block whose info string is the marker name.
- Use the same `autodev-result:v1` schema for automated and human transition requests; authorization and field requirements vary by author rather than by marker type.
- Trust human decisions only from comments whose `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR`.
- The orchestrator, not the Implementation agent, creates or reuses the implementation pull request.
- Store only the current `state` and its orchestrator-recorded `executionId` in each `autodev-task:v1` record; append-only comments provide history.
- CodeReview is an advisory Agentic Workflow. It may post findings and request implementation changes, but a human performs the final code-review decision.
- POC research, design, and security artifacts remain on the issue branch and are included in the implementation pull request.
- Run every AI-assisted state as a gh-aw Agentic Workflow dispatched by the orchestrator with `workflow_dispatch`. Author each workflow as an `.md` source, compile it to a self-contained `.lock.yml`, and commit both. The launch mechanism (workflow dispatch) is decoupled from a state's transition semantics.
- Use `GITHUB_TOKEN` for orchestrator-authored state, error, and instruction comments so those comments do not recursively trigger the orchestrator. Only Agentic Workflow callbacks use the non-`GITHUB_TOKEN` callback identity.
- Model `Initialization` as canonical sequence-1 state. Because Initialization runs synchronously in the orchestrator (no external worker posts its result), the Initialization handler itself posts the `Initialization -> Research` `autodev-result:v1` handoff using the callback identity, so a follow-up orchestrator run validates the transition and launches Research. It is the only orchestrator state that emits an automated-success result.
- Agentic Workflows commit through the `push-to-pull-request-branch` safe output, which requires an open pull request for the issue branch. Initialization therefore opens a tracking pull request for `autodev/issue-<number>`, and the orchestrator dispatches each producer workflow with the issue number, branch, recorded head SHA, and tracking pull request number. Because the safe output validates the whole base..head diff (which always includes the initialization scaffold and any prior artifacts), producer workflows do not use a per-file `allowed-files` allowlist; they set `protected-files: allowed` and rely on the orchestrator's change policy — validated against the preceding canonical `headSha` — as the authoritative changed-file guard.
- Represent retry exhaustion or executions requiring intervention as canonical `Blocked` state, not only as a label.

## Planned repository structure

```text
.github/
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
      dispatcher.mjs
      handlers/
        initialization.mjs
        advance.mjs
        shared.mjs
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
        advance.test.mjs
        workflows.test.mjs
        reconcile.test.mjs
  workflows/
    autodev-orchestrator.yml
    autodev-research.md
    autodev-research.lock.yml
    autodev-design.md
    autodev-design.lock.yml
    autodev-security-review.md
    autodev-security-review.lock.yml
    autodev-implementation.md
    autodev-implementation.lock.yml
    autodev-code-review.md
    autodev-code-review.lock.yml
    autodev-reconcile.yml
README.md
```

Each AI-assisted state's behavior lives entirely in its Agentic Workflow `.md` source (prompt, tools, and safe outputs); the orchestrator only dispatches the compiled `.lock.yml` and validates the callback. The exact module split may be collapsed if implementation reveals that a module has no independent responsibility. Keep the event entry point thin and place parsing, validation, and transition logic in pure testable functions.

## Milestone 0: Publish the approved plan and document prerequisites - Complete

**Status:** Complete as of 2026-07-22.

1. [x] Copy this approved session plan to `.github/plans/initial-implementation.plan.md`.
2. [x] Update the requirements where implementation needs an explicit contract:
   - Add `HumanCodeReview` and terminal `Completed` behavior.
   - Define one transition-result marker schema for Agentic Workflows, human reviewers, and future local Copilot tools.
   - Clarify that edited or deleted comments are ignored for the POC; only newly created comments are processed.
3. [x] Document required repository configuration:
   - `AUTODEV_CALLBACK_TOKEN`: repository-scoped token used only by the `add-comment` safe-output job for Agentic Workflow issue callbacks. A fine-grained PAT requires `issues: write`, so the POC's comment-only boundary is enforced by the safe-output allowlist rather than by a comment-specific token permission. The orchestrator reads its login at startup and accepts automated results only from that identity.
   - Each Agentic Workflow reads the repository through the built-in GitHub MCP server in `gh-proxy` mode using the workflow's own `GITHUB_TOKEN`; no separate Copilot MCP or Agents-secret configuration is required.
   - gh-aw v0.82.14 or the repository-pinned version for authoring and compiling the AutoDev Agentic Workflows. `copilot-setup-steps.yml` installs it in the Copilot cloud-agent environment; the compiled lock workflows are self-contained and do not require the CLI at runtime.
4. [x] Define the POC label contract in the requirements and setup documentation; Milestone 1 will encode these values in `config.mjs`:
   - `autodev` as the trigger and reconciliation-discovery label.
   - `autodev/ready-for-plan-review`, `autodev/ready-for-code-review`, and `autodev/blocked` as the only state labels because they identify states requiring human attention.
5. [x] Record manual setup and secret-rotation steps in `README.md`; never commit token values.

**Completion criteria**

- [x] The approved plan exists at the requested repository path.
- [x] Required secrets, labels, and GitHub/Copilot prerequisites are documented with least-privilege permissions.
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
   - Artifact paths under `autodev/issues/<number>/` (outside `.github/` so Agentic Workflow push safe outputs can commit them).
   - Allowed changed-file patterns per Agentic Workflow state.
2. [x] Implement current-task parsing and serialization for `autodev-task:v1` fenced-marker comments:
   - Validate schema version, issue number, sequence, current state, execution ID, attempt, ref, SHA, and timestamp.
   - Select the highest valid orchestrator-authored sequence.
   - Reject malformed, duplicate-sequence, sequence-gap, wrong-issue, unknown-version, and non-orchestrator task comments.
3. [x] Define and implement the unified transition-result marker:

   ````text
   ```autodev-result:v1
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
     "artifacts": ["autodev/issues/42/research.md"]
   }
   ```
   ````

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
   - Explicit least-privilege `issues`, `contents`, and `pull-requests` permissions required by Initialization, which now opens the issue tracking pull request.
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
   - Seed the issue branch with a scaffold artifact and open the tracking pull request for it.
   - Record canonical `Initialization` state (sequence 1) with the orchestrator identity, then post the `Initialization -> Research` `autodev-result:v1` handoff with the callback identity so a follow-up orchestrator run launches Research.
5. [x] Add defense-in-depth event filtering:
   - Ignore canonical `autodev-task` comments as trigger inputs.
   - Ignore comments authored by the orchestrator identity.
   - Process external execution results and trusted human-authored results only.
6. [x] Initially support a dry-run handler for Research so Initialization can be validated before the real Research Agentic Workflow is enabled.
7. [x] Add mocked-fetch tests covering pagination, existing branches, duplicate trigger events, canonical comment creation, self-authored comment suppression, consistent concurrency inputs, and API failures.

**Completion criteria**

- [x] Repeated trigger-label events create one branch and one logical initialization.
- [x] The issue contains a valid sequence-1 canonical `Initialization` record followed by a callback-identity Research handoff.
- [x] Duplicate events do not create duplicate branches or state transitions.

## Milestone 3: Run Research as an Agentic Workflow - Complete

**Status:** Complete as of 2026-07-24. Research runs live end-to-end as a gh-aw Agentic Workflow: Initialization hands off, the orchestrator dispatches `autodev-research.lock.yml`, and the worker commits its artifact to the tracking pull request and posts the `autodev-result:v1` callback.

1. [x] Add the Research workflow constant to `config.mjs` (`WORKFLOWS[research] = 'autodev-research.lock.yml'`) and a `github-client.dispatchWorkflow` REST wrapper. Handler type (transition semantics) stays decoupled from the launch substrate (workflow dispatch): every AI-assisted state shares the single `AGENTIC_WORKFLOW` handler, and a workflow's read-only or producer nature is expressed by the safe outputs it declares rather than by a distinct handler type.
2. [x] Dispatch Research with the issue number, branch, recorded head SHA, tracking pull request number, artifact path, attempt, and an orchestrator-generated correlation id. `workflow_dispatch` does not return a run id, so the correlation id is the canonical `executionId`.
3. [x] Author `autodev-research.md` (compiled to `autodev-research.lock.yml`):
   - Read-only agent permissions; GitHub access via the built-in MCP server in `gh-proxy` mode using `GITHUB_TOKEN`; network defaults for web research.
   - Treat the issue title, body, and any web content as untrusted data.
   - Write a single research artifact at the configured path and commit it with the `push-to-pull-request-branch` safe output. Because gh-aw validates the whole base..head diff (which always includes the initialization scaffold), the worker uses no `allowed-files`; it sets `protected-files: allowed` and `checkout.fetch-depth: 0` so the merge-base is available, and the orchestrator's change policy is the authoritative changed-file guard.
   - Require citations or source links in the research artifact.
   - Post exactly one callback with the `add-comment` safe output under `AUTODEV_CALLBACK_TOKEN`, containing a visible summary and one fenced `autodev-result:v1` marker whose branch, SHA, artifact path, and requested next state match the dispatch inputs.
   - Compile with `gh aw compile autodev-research` and commit both the `.md` source and generated `.lock.yml`.
4. [x] Launch Research from the follow-up orchestrator run triggered by the Initialization handoff, after re-validating the transition and confirming the recorded head SHA still matches the live branch head. Record the correlation id in the new Research `autodev-task` comment.
5. [x] Authenticate and parse Research callback comments, then stop cleanly at the deferred Design boundary. Design-state processing will validate the branch, SHA, changed files, and artifact in Milestone 4.
6. [x] Add integration-style tests using mocked GitHub API responses and assert that the compiled workflow and its callback safe output are committed.

**Known limitation:** the safe-output job commits after the agent finishes, so the callback echoes the pre-dispatch `head_sha`. Research -> Design does not require SHA equality for a producer state, so this passes; the Design handler (Milestone 4) re-resolves the actual branch head on callback rather than trusting the reported SHA.

**Completion criteria**

- [x] A labeled test issue progresses from Initialization through a real Research Agentic Workflow run.
- [x] Research commits its artifact to the shared issue branch's tracking pull request.
- [x] A valid callback is recognized as a Design request without invoking an unimplemented Design handler.
- [x] Design validation rejects invalid callbacks or out-of-scope changes before writing canonical Design state (Milestone 4).

## Milestone 4: Add Design and SecurityReview, including feedback loops - Implemented

**Status:** Implementation complete as of 2026-07-27. The Research -> Design -> SecurityReview path and the Design -> Research / SecurityReview -> Design feedback loops are wired and unit-tested with mocked GitHub responses. Live end-to-end validation of the new workflows on a real issue is pending (tracked in Milestone 8).

1. [x] Implement the producer-advance handler that validates the completed source run, branch head, changes since the source run's starting SHA, and required source artifact before recording or launching the target. Shared across Research/Design/SecurityReview in `handlers/advance.mjs`; the Design handler is this launcher reached with a Research canonical source.
2. [x] Author `autodev-design.md` (compiled to `autodev-design.lock.yml`):
   - Mirror the structure of [autodev-research.md](../workflows/autodev-research.md) for the prompt and safe outputs.
   - Consume the issue, Research artifact, and any prior security or human feedback (passed as the untrusted `feedback` dispatch input).
   - Write only the issue Design artifact.
   - Request Research when specific missing research is identified; otherwise request SecurityReview.
   - Persist the selected `nextState` and rationale in a machine-readable `autodev-decision:v1` block in the committed Design artifact so reconciliation does not depend solely on the callback.
3. [x] Author `autodev-security-review.md` (compiled to `autodev-security-review.lock.yml`):
   - Mirror the structure of [autodev-research.md](../workflows/autodev-research.md) for the prompt and safe outputs.
   - Consume the Design artifact and relevant code.
   - Produce a threat model and security-review artifact.
   - Request Design when blocking findings require changes; otherwise request HumanPlanReview.
   - Persist the selected `nextState` and rationale in a machine-readable `autodev-decision:v1` block in the committed SecurityReview artifact.
4. [x] Reuse the shared workflow-dispatch launcher and callback validator with state-specific policies rather than duplicating orchestration logic. `advanceState` derives the source from canonical state and the target from the callback's `nextState`, so one handler serves the forward path and both feedback loops.
5. [x] Validate allowed file paths and required artifacts independently for each state by diffing the SHA recorded when the source launched against the re-resolved live branch head. Because a producer's safe output commits after it posts the callback, the callback SHA is stale; the orchestrator re-resolves the live head and diffs it via `github-client.compareCommits` rather than trusting the callback SHA.
6. [x] Increment attempts on each re-entry (the target's attempt is the prior attempt for that state plus one) and pass the source's rationale as the `feedback` input included in prompts.
7. [x] Protect against stale callbacks from previous Design or SecurityReview attempts: a callback whose declared source is not the live canonical state is ignored, and the transition validator rejects attempt/ref/state mismatches.
8. [x] Add tests for Research <-> Design and Design <-> SecurityReview loops, stale attempts, missing artifacts, disallowed changes, and invalid requested transitions (`advance.test.mjs`, `workflows.test.mjs`).

**Completion criteria**

- [x] The POC can traverse the complete Research -> Design -> SecurityReview path (unit-verified end to end with mocked GitHub responses).
- [x] Design can return to Research and SecurityReview can return to Design without accepting stale callbacks.
- [x] Every loop produces a new append-only canonical sequence and preserves prior artifacts/history.
- [ ] Live validation of the Design and SecurityReview workflows on a real issue (deferred to Milestone 8).

**Deferred hardening (to Milestone 7, reconciliation):** In the normal flow the orchestrator trusts the callback's `nextState` after confirming the source committed its artifact within policy; it does not yet re-read the committed `autodev-decision:v1` block to confirm the callback matches it. Cross-checking the callback against the persisted decision belongs with reconciliation, which already reads that block to recover a lost callback, and enforcing it during normal flow before the workflows are live-validated would make a healthy run depend on exact agent artifact formatting. When Milestone 7 lands, verify the callback's `state`/`nextState` equal the decision block committed at the resolved head.

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
4. Author `autodev-implementation.md` (compiled to `autodev-implementation.lock.yml`):
   - Consume the approved Design and SecurityReview artifacts plus human feedback.
   - Modify implementation and test files while preserving the approved artifacts. Because Implementation must be able to change most of the repository, its `push-to-pull-request-branch` safe output uses `protected-files: allowed` and no `allowed-files`; the orchestrator's change policy is the authoritative guard and forbids modifying AutoDev control files or any issue artifacts.
   - Run the repository's existing tests/builds when available.
   - Never create the pull request itself.
   - Report a structured callback with the Implementation outcome. Because the safe-output commit lands after the agent finishes, the orchestrator re-resolves the branch head rather than trusting a reported post-commit SHA.
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
3. For stale Agentic Workflow executions:
   - Locate the dispatched workflow run by the correlation id embedded in its run name and the recorded canonical state.
   - Leave queued or in-progress runs alone until a hard deadline.
   - Reconcile completed runs whose callback was missed by validating branch artifacts. For decision states, read the persisted machine-readable decision from the artifact before synthesizing the transition; never guess a route.
   - Redispatch failed, timed-out, cancelled, or missing runs up to a configured maximum.
   - Transition runs that report a missing capability or input (`missing-tool`/`missing-data`) to canonical Blocked state for human attention.
4. Detect launches that failed after the canonical task comment was written but before the workflow run started:
   - List recent runs of the state's workflow.
   - Correlate candidates using the correlation id in the run name, plus branch artifact and creation window.
   - Adopt a single unambiguous matching run; transition to Blocked rather than guessing when multiple candidates match or none is found after the deadline.
5. For stale review (CodeReview) executions, which produce no branch artifact:
   - Locate the run by workflow and correlation id where possible.
   - Redispatch only when no matching active or completed run exists.
6. Dispatch per-issue reconciliation through the primary orchestrator workflow so normal per-issue concurrency and transition validation remain authoritative.
7. Add configuration for stage-specific stale thresholds, hard deadlines, and maximum attempts.
8. Add tests for every workflow-run status, missed callbacks, persisted decision recovery, orphan launch adoption, ambiguous orphan blocking, retry exhaustion, and duplicate reconciliation runs.

**Completion criteria**

- The reconciler never launches a second worker while a matching execution is active.
- Missed callbacks can be recovered without bypassing artifact and transition validation.
- Exhausted runs, or runs reporting a missing capability or input, enter canonical Blocked state rather than relying on a non-authoritative label or retrying indefinitely.

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
   - Replace the callback PAT (`issues: write`) with a dedicated, comment-only callback identity.
   - Replace PATs with a managed GitHub App or user-to-server credential strategy when supported.
   - Consider tamper-resistant state storage, richer status, stronger reviewer policy, and cost budgets.

**Completion criteria**

- The full workflow can be demonstrated from label application through human code review and completion.
- Negative-path tests show that invalid transitions, actors, SHAs, and file modifications do not advance state.
- Setup, operation, recovery, and limitations are understandable without reading the implementation.

## Cross-cutting implementation rules

- The orchestrator is the only writer of canonical `autodev-task` records.
- The orchestrator uses `GITHUB_TOKEN` for its comments; only Agentic Workflow callback comments use `AUTODEV_CALLBACK_TOKEN`.
- Agents and Agentic Workflows submit requests; they never directly choose an authoritative transition.
- Re-read canonical state immediately before every mutation and use per-issue concurrency.
- Keep GitHub API, workflow-dispatch, parsing, transition, and handler logic separately testable.
- Surface errors as visible issue comments consistent with the workflow; do not silently ignore invalid callbacks.
- Never expose the callback credential to an agent, its prompt, or the MCP server; only the callback safe-output job may reference it.
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
- A dedicated callback service or identity; the gh-aw `add-comment` safe output with the callback PAT is the temporary POC mechanism.
- Comprehensive cost accounting beyond logging execution IDs, attempts, and workflow/task links.

## Notes and risks

- gh-aw safe outputs run as separate jobs after the agent finishes, so a worker cannot report its post-commit head SHA in the callback. The orchestrator must re-resolve the branch head on callback for any state that requires SHA validation.
- The callback PAT is tied to a specific user identity. Setup documentation must identify its owner and rotation procedure so demos remain reproducible.
- A workflow-created comment using `GITHUB_TOKEN` will not trigger the issue-comment orchestrator. Agentic Workflow callback authentication is therefore part of the functional design, not optional hardening.
- Conversely, orchestrator comments must use `GITHUB_TOKEN`; using the callback PAT/App identity for canonical comments would retrigger the workflow and could create a comment loop.
- `workflow_dispatch` does not necessarily return a workflow run ID. Use the caller-generated correlation ID as the canonical execution ID and include it in the run name and callback.
- Starting an execution and recording its ID cannot be fully atomic. The reconciliation milestone must detect incomplete launch records and avoid duplicate work; until then, the happy-path milestones should document this POC limitation.
- gh-aw `push-to-pull-request-branch` validates the entire base..head diff and refuses pushes under `.github/**`, so issue artifacts live under `autodev/issues/<number>/` and producer workflows rely on `protected-files: allowed` plus the orchestrator change policy rather than per-file allowlists.
- The callback PAT's real token-level blast radius is repository `issues: write`; the POC depends on the gh-aw safe-output allowlist (a single `add-comment`) to narrow that capability to comments. This residual prompt-injection risk must be demonstrated and documented.
