# AutoDev gh-aw Migration Plan

## Status

Proposed. This plan covers a single reversible spike: re-implement the **Research** state as a GitHub Agentic Workflow (gh-aw) instead of a Copilot Agent Task. It does not change any other state. If the spike succeeds, a follow-on plan will migrate Design, SecurityReview, and Implementation and retire the Agent Tasks client.

## Problem and approach

AutoDev launches its autonomous states as Copilot Agent Tasks through the public-preview Agent Tasks REST API. Research repeatedly completed with no commit and no callback, ending with messages such as *"nothing actionable in the prompt"* and *"No actionable new @copilot comments were provided, so I didn't make any changes or post any replies."*

The Agent Tasks API is the wrong execution primitive for AutoDev's model, and the recommended replacement is gh-aw, which AutoDev already uses for CodeReview. This plan documents that rationale and lays out the spike to prove it on the Research state before committing to a broader migration.

## Rationale: why Agentic Workflows fit AutoDev better than the Agent Tasks API

### What the Agent Tasks API actually does

The Agent Tasks API owns the branch and pull-request lifecycle. Its `head_ref`/`base_ref` contract is designed around "operate on a pull request":

- `head_ref` supplied alone is ignored; the agent creates its own `copilot/*` branch and pull request. This produced the unwanted PRs on issues #4, #6, and #8, and is why those runs still committed research — they were working on the agent's own PR.
- `head_ref` + `base_ref` that resolve to an already-open pull request bind the task to that PR and switch the agent into "service this pull request" mode. It looks for actionable diffs or new `@copilot` comments, finds none for a "create a new file" prompt, and no-ops.

### Evidence from this repository

| Run | Branch used | Pre-existing PR bound? | Result |
| --- | --- | --- | --- |
| Issue #6 / #8 (`eced9cc2`, `326d5463`) | Agent's own `copilot/*` | No (agent created its own PR) | Research produced |
| Issue #11 (`ba9f5fba`, `95c64656`) | `autodev/issue-11` via tracking PR #13 | Yes (`PR_kwDOTgQ8LM71jiHv`) | Silent no-op |

Both no-op runs carried a `pull` artifact pointing at the pre-opened tracking PR. The only variable that changed the outcome was whether the task was bound to a pull request it did not itself create. AutoDev's whole design depends on a shared, orchestrator-owned issue branch (`autodev/issue-<n>`), so we cannot let each state invent its own branch; that requirement collides directly with how the Agent Tasks API wants to work.

### Why gh-aw is a better fit

1. **Already adopted.** CodeReview is specified as a gh-aw workflow (Milestone 6), `gh-aw` is pinned in `copilot-setup-steps.yml`, and the repository ships the `agentic-workflows` skill. Moving the autonomous states to gh-aw consolidates AutoDev on one agent-execution mechanism instead of two.
2. **The agent runs in the runner, so the workflow owns git.** There is no hidden branch/PR management. File changes are committed through explicit, scoped **safe outputs** rather than by an opaque platform workflow.
3. **Safe outputs match AutoDev's contract.** `push-to-pull-request-branch` (or an equivalent branch push) commits the artifact to the issue branch, and `add-comment` posts the `autodev-result:v1` marker. Milestone 6 already specifies "an issue callback comment containing the structured AutoDev result marker" using `AUTODEV_CALLBACK_TOKEN`.
4. **The canonical state machine is unchanged.** The orchestrator remains the only writer of `autodev-task` records and the sole validator of transitions. gh-aw only changes how a worker is launched and how it reports back; `comments.mjs`, `task.mjs`, `transitions.mjs`, and the canonical-history model are untouched.
5. **Security model aligns with the POC.** gh-aw provides sanitized untrusted input, egress/network control, and locked least-privilege permissions. Research explicitly treats issue, repository, and web content as untrusted, which is exactly the threat gh-aw's safe-input handling addresses.
6. **The tracking pull request becomes an asset.** With gh-aw, keeping `autodev/issue-<n>`'s pull request open is useful: it is the explicit target for `push-to-pull-request-branch`. The same PR that broke the Agent Tasks run is a natural, well-defined output target for a gh-aw run.

### Why not the Copilot CLI (for now)

Running the Copilot CLI headless as an orchestrator step is the most controllable option and could collapse the async callback handshake into a synchronous step, removing a class of callback/reconciliation complexity. It is kept as a fallback rather than the primary choice because it is a newer headless-in-CI path that requires hand-rolled auth, tool permissioning, commit, and result plumbing, and it does not reuse the gh-aw investment already made for CodeReview. Revisit it only if gh-aw's in-runner agent proves too constrained for Research's web-research and multi-file needs.

## Scope and reversibility

- **In scope:** a single new gh-aw workflow that performs Research, plus the minimum orchestrator wiring to dispatch it and accept its callback. Research is the only state changed.
- **Out of scope:** Design, SecurityReview, Implementation, CodeReview, and reconciliation. No change to the canonical contract schemas or the transition validator.
- **Reversibility:** all work lands on a dedicated branch. The Agent Tasks client (`agent-tasks-client.mjs`) and the `autodev-research.agent.md` custom agent are left in place and functional during the spike so the change is a small, revertible wiring swap. If the spike fails, abandon the branch; `main` is unaffected. If it succeeds, a follow-on plan removes the now-unused Agent Tasks path.

## Prerequisites

1. Confirm the local `gh-aw` version matches the version pinned in `.github/workflows/copilot-setup-steps.yml`; align them if they differ.
2. Use the repository `agentic-workflows` skill for all gh-aw authoring, compilation, and debugging. Edit the `.md` source, compile it, and commit the generated `.lock.yml`; never hand-edit a lock workflow.
3. Confirm the callback identity: the safe-output callback comment must use `AUTODEV_CALLBACK_TOKEN` (or an equivalent GitHub App identity) so its `issue_comment` event retriggers the orchestrator. The workflow `GITHUB_TOKEN` must not author the callback comment.
4. Confirm the repository setting **Allow GitHub Actions to create and approve pull requests** remains enabled (already required for the tracking pull request).

## Step-by-step spike plan

### Phase 1: Author the Research Agentic Workflow

1. Create `.github/workflows/autodev-research.md` with a `workflow_dispatch` trigger whose inputs mirror the current Research task prompt and the CodeReview dispatch pattern:
   - `issue_number`
   - `head_ref` (the issue branch, `autodev/issue-<n>`)
   - `head_sha` (the canonical Initialization/most-recent head SHA)
   - `artifact_path` (`.github/autodev/issues/<n>/research.md`)
   - `attempt`
   - `correlation_id` (caller-generated; becomes the canonical `executionId`)
2. Configure the agent job for least privilege:
   - Read-only GitHub context (repos and issues toolsets) plus web search for external research.
   - Local file `edit` so the agent can write the research artifact into the checked-out workspace.
   - No direct GitHub write tools; all writes go through safe outputs.
3. Author the workflow prompt body from the existing `buildResearchPrompt` content: issue title/body/URL as untrusted data, working branch, required artifact path, attempt, and the exact `autodev-result:v1` callback contract (state `research`, nextState `design`, matching `headRef`/`headSha`/`artifacts`).
4. Configure narrow safe outputs, confirming exact names and syntax via the `agentic-workflows` skill:
   - Commit the artifact to the issue branch through `push-to-pull-request-branch` (or the equivalent branch-push safe output), targeting the pull request/branch derived from the dispatch inputs. Because a `workflow_dispatch` run has no implicit PR target, set an explicit target and require it to exactly match the sanitized `head_ref`/PR input.
   - Post the `autodev-result:v1` callback via `add-comment` to `issue_number`, using the callback identity, and include the `correlation_id` so a missed callback can later be reconciled.
   - Use a `noop`/blocker path that posts a visible explanation without a result marker when research cannot be completed.
5. Constrain the workflow so it can only modify the single research artifact path, mirroring the existing per-state change policy in `config.mjs`.

### Phase 2: Compile and validate the workflow

1. Compile the source with `gh aw compile autodev-research`.
2. Run `gh aw compile --validate` and resolve any errors.
3. Commit both the source `.md` and the generated `.lock.yml`; do not hand-edit the lock file.
4. Confirm the generated permissions are least-privilege and that no secret is embedded in the compiled workflow.

### Phase 3: Wire the orchestrator to dispatch the workflow

1. In `config.mjs`, change the Research handler mapping from `AGENT_TASK` to `AGENTIC_WORKFLOW`, and add any Research-specific workflow file name/dispatch constants. Keep all state, transition, label, and change-policy definitions in `config.mjs`.
2. Add a minimal `dispatchWorkflow` operation to `github-client.mjs` (`POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches`) only now that a state uses it. Add `actions: write` to the orchestrator workflow permissions at the same time.
3. Replace the Agent Task launch inside `advanceToResearch` (`handlers/research.mjs`) with a workflow dispatch:
   - Preserve the existing canonical guards: load canonical state, require `Initialization`, validate the transition, and re-fetch the live branch head and reject on `stale-head-sha`.
   - Generate the `correlation_id`, dispatch the workflow with the inputs above, and record a canonical Research `autodev-task` comment whose `executionId` is the `correlation_id` (workflow_dispatch does not return a run ID).
4. Keep the callback path unchanged: the orchestrator continues to accept a callback-identity `autodev-result:v1` comment and validate it with the existing transition validator, including the changed-files check against the preceding canonical `headSha`.

### Phase 4: Tests

1. Update and add focused `node:test` coverage under `.github/scripts/autodev/test/`:
   - `dispatchWorkflow` request shape, path encoding, and error handling in `github-client.test.mjs`.
   - `advanceToResearch` dispatches the workflow with correctly derived inputs, records the `correlation_id` as `executionId`, and still enforces the stale-head and transition guards.
   - `config.test.mjs` reflects the Research handler now mapping to `AGENTIC_WORKFLOW`.
   - Add a guard asserting the compiled `autodev-research.lock.yml` exists and that the source declares the callback safe output.
2. Run the full suite: `node --test .github/scripts/autodev/test/*.test.mjs`.

### Phase 5: Live validation

1. Merge the spike branch's workflow and wiring to the default branch (custom-agent/workflow resolution and dispatched-workflow permissions are read from the default branch).
2. Label a fresh test issue `autodev` and confirm the full path:
   - Initialization creates the branch, seeds the scaffold, opens the tracking pull request, and posts the callback handoff.
   - The follow-up orchestrator run dispatches `autodev-research` instead of an Agent Task.
   - The Research workflow commits `research.md` to `autodev/issue-<n>` and posts a valid `autodev-result:v1` callback with matching `headRef`/`headSha`/`artifacts`.
   - The orchestrator validates the callback and records canonical Research state; it stops cleanly at the deferred Design boundary.
3. Confirm no `copilot/*` branch or extra pull request is created, and that no secret appears in logs, comments, prompts, commits, or the compiled workflow.

## Acceptance criteria

- A labeled test issue advances from Initialization to Research entirely through gh-aw, with the research artifact committed to the shared issue branch and a valid callback recorded as canonical Research state.
- The research task no longer no-ops; no unwanted `copilot/*` branch or pull request is produced.
- The orchestrator remains the only writer of canonical task records and the sole transition validator; contract schemas are unchanged.
- The full JavaScript test suite passes, and the gh-aw source compiles with a current committed lock file.

## Rollback

- Before merge: abandon the spike branch; `main` is unchanged.
- After merge, if needed: revert the Research handler mapping to `AGENT_TASK` and restore the Agent Task launch in `advanceToResearch`. The Agent Tasks client and `autodev-research.agent.md` remain in place throughout the spike, so reverting is a small wiring change.

## Risks and open questions

- **Safe-output specifics.** Exact safe-output names, targeting syntax, and identity configuration must be confirmed through the `agentic-workflows` skill and current gh-aw docs; the preview surface may differ from this plan's naming.
- **workflow_dispatch correlation.** `workflow_dispatch` may not return a run ID, so the caller-generated `correlation_id` is authoritative. Reconciliation (Milestone 7) must correlate on it and on branch artifacts.
- **Non-atomic launch.** Recording the canonical Research comment and dispatching the workflow cannot be fully atomic; document this as a POC limitation until reconciliation lands.
- **Callback identity blast radius.** The callback identity retains repository `issues: write`; the safe-output allowlist is what narrows it to a comment. This residual prompt-injection risk must be demonstrated and documented, consistent with the existing plan.
- **Branch-push target validation.** The workflow must reject any push target that does not exactly match the sanitized dispatched `head_ref`/PR input, so a compromised prompt cannot redirect the commit.

## Follow-on (only if the spike succeeds)

1. Migrate Design, SecurityReview, and Implementation to gh-aw using the same dispatch-and-callback shape and their existing per-state change policies and decision blocks.
2. Remove the now-unused `agent-tasks-client.mjs`, its tests, the `AUTODEV_AGENT_TASKS_TOKEN` secret, and `autodev-research.agent.md`; update `README.md` and `initial-implementation.plan.md` to describe gh-aw as the single execution model.
3. Reassess whether the async callback handshake is still needed per state or whether some states can run synchronously.
