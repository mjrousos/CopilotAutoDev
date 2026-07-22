# Copilot AutoDev AI-Driven SDLC Automation

In this repo, I want to create a [GitHub actions](https://docs.github.com/en/actions) and [custom agent](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents)-based solution that will enable developers to automate the software development lifecycle (SDLC) using GitHub Copilot.

## Expected User Experience

Users will begin by creating a GitHub issue in this repository and applying a label that indicates the AutoDev workflow should handle the issue. This will trigger a GitHub action that will begin the AutoDev workflow. The workflow will be a series of actions executions that move through a state machine to automate the SDLC. State will be tracked in GitHub issue comments.

The AutoDev workflow will move through the following states (each of which will be handled by a custom GitHub Copilot agent):

- Initialization: In this state, the AutoDev workflow's GitHub action will create and push a working branch to the repository. The branch will be named after the issue number. The workflow will then indicate that the Research state is next.
- Research: In this state, the AutoDev workflow's Research agent will analyze the issue description and any relevant code in the repository to determine what needs to be done. The agent will then search the internet to research relevant technologies, libraries, frameworks, best practices, and other information that will help it determine how to implement the solution. The agent will then create an issue-specific file in the working branch (or update a file if a research document already exists for this issue) with a detailed research summary and will add an issue comment summarizing its work, identifying the research file that was created, and indicating that the Design state is next.
- Design: In this state, the AutoDev workflow's Design agent will use the research summary to create a detailed plan for the solution. If the design agent believes that not enough research has been done, it will indicate that (with as much detail as possible about what is missing) in a comment on the issue and indicate that the Research state is next. If the design agent believes that enough research has been done, it will create a detailed design plan for the issue in the working branch (or update the plan if one already exists for the issue) and add a comment to the issue  identifying the plan document and indicating that the SecurityReview state is next.
- SecurityReview: In this state, the AutoDev workflow's SecurityReview agent will analyze the design plan and any relevant code in the repository to determine if there are any security concerns with the proposed solution. The agent will create a comprehensive threat model. The agent will then create an issue-specific file in the working branch (or update a file if a security review document already exists for this issue) with a detailed security review summary and will add an issue comment summarizing its work and identifying the security review file that was created. If there are security concerns, the agent will indicate that the Design state is next (along with a summary of what needs fixed in the design). If there are no security concerns, the agent will apply a label indicating that the plan is ready for human review.
- HumanPlanReview: The HumanPlanReview state is indicated by a label on the issue (unlike most other state transitions) and *is not* handled by the AutoDev workflow action. Instead, a separate manual process is followed by a human reviewer. The human reviewer will review the design plan and security review and either approve the plan or request changes. If the plan is approved, the human reviewer will add an issue comment indicating that the plan is ready for implementation. If changes are requested, the human reviewer will add an issue comment indicating that the plan needs changes and provide a summary of what needs to be changed in an issue comment. The AutoDev workflow will then transition back to the Design state.
- Implementation: In this state, the AutoDev workflow's Implementation agent will use the design plan to implement the solution. The agent will create a pull request from the working branch to the main branch and add an issue comment indicating that the pull request has been created and that the next state is CodeReview.
- CodeReview: In this state, the AutoDev workflow's CodeReview agent will review the pull request for code quality, adherence to the design plan, and any potential issues. The agent will add comments to the pull request with its findings and either approve the pull request or request changes. If changes are requested, the agent will indicate that the Implementation state is next. If the pull request is approved, the agent will add a label to both the issue and the PR indicating that the pull request is ready for human review.

## Important Implementation Details

- Canonical workflow state will be tracked as an append-only sequence of orchestrator-authored GitHub issue comments. Each canonical comment will contain a visible summary and a versioned HTML comment with a full transition record using the following schema:

  ```text
  <!-- autodev-state:v1
  {
    "schemaVersion": 1,
    "issue": 42,
    "sequence": 5,
    "fromState": "research",
    "nextState": "design",
    "sourceExecutionId": "research-task-id",
    "nextExecutionId": "design-task-id",
    "attempt": 1,
    "headRef": "autodev/issue-42",
    "headSha": "abc123",
    "createdAt": "2026-07-22T17:00:00Z"
  }
  -->
  ```

  - For the initial proof of concept, a separate status field will not be used. The `nextState` in the valid record with the highest sequence number is the effective current state of the AutoDev workflow.
  - `sourceExecutionId` identifies the execution whose result caused the transition. `nextExecutionId` identifies the execution launched for `nextState`. Either value may be null when the transition is not caused by an automated execution or the next state does not require one, such as a human-review or terminal state.
  - The execution mechanism is fixed for each state and will not be stored separately in the state record. The orchestrator will use `fromState` and `nextState` to determine whether an execution ID refers to an Agent Task, an Agentic Workflow run or correlation ID, or another configured handler.
  - Agent callbacks and human comments may request a transition, but they are not canonical state records. The orchestrator must verify the actor, validate that `fromState` to `nextState` is an allowed transition, launch the next task when required, and then append the canonical transition record.
  - Duplicate sequence numbers, invalid schemas, issue-number mismatches, invalid transitions, and records not authored by the orchestrator will be ignored or reported as errors.
  - GitHub labels may mirror the current state for visibility and discovery, but they will not be treated as authoritative state because they can be modified independently.
- There will be a primary GitHub Actions workflow backed by an orchestrator script that will be responsible for managing the state machine and invoking the configured handler for each state. Most automated states will be implemented as custom *.agent.md files under .github/agents and invoked using the [GitHub Task REST API](https://docs.github.com/en/rest/agent-tasks/agent-tasks?apiVersion=2026-03-10#start-a-task). To demonstrate both approaches in the proof of concept, CodeReview will instead be implemented as a GitHub Agentic Workflow. The state handlers will be:

  | State | Handler |
  | --- | --- |
  | Initialization | Deterministic orchestrator logic |
  | Research | Copilot Agent Task using a custom agent |
  | Design | Copilot Agent Task using a custom agent |
  | SecurityReview | Copilot Agent Task using a custom agent |
  | HumanPlanReview | Human reviewer |
  | Implementation | Copilot Agent Task using a custom agent |
  | CodeReview | GitHub Agentic Workflow |
  | HumanCodeReview | Human reviewer |

  - The orchestrator will dispatch the CodeReview Agentic Workflow with the issue number, pull request number, expected head commit, and a unique correlation ID. The Agentic Workflow will use safe outputs for pull request review comments, labels, and its structured completion callback. The callback must use an authentication mechanism that causes the orchestrator's `issue_comment` workflow to run; a comment created with the default `GITHUB_TOKEN` will not trigger that workflow.
- Agent credentials and capabilities will remain separated. The credential used by the orchestrator to create and inspect Agent Tasks will not be provided to the agents. Copilot cloud agent provides each task with a platform-managed capability to commit and push changes only to its designated working branch; this does not give the agent a reusable, general-purpose GitHub API token. The orchestrator will validate the files changed by each task and reject results that modify files outside the paths permitted for that state.
- Issue comments used to report Agent Task results will be treated as a separate capability from branch writes. The intended long-term design is to provide agents with a dedicated, narrowly scoped issue-write tool that accepts a structured task result and can only post a completion comment to the issue associated with the current task. For the initial proof of concept, Agent Task agents will instead use a write-enabled GitHub MCP tool with only the `add_issue_comment` operation enabled. The credential used by this MCP tool must be scoped to this repository and must not be the credential used by the orchestrator to invoke the Agent Tasks API. This is a temporary simplification and should not be expanded into general GitHub write access for the agents.
- The orchestrator action should be simple and keep most of its logic in a JS script file (which will do the actual routing and agent invocation). The action itself should just be a simple trigger (i.e. `on: issues` and `on: issue_comment`) that invokes the JS script file.

## Future Additions

These features do not need implemented initially, but will be added in the future:

- Human plan review agent (for local use): An agent that will be used locally (with the GitHub Copilot CLI or GitHub Copilot App) rather than in the cloud. The agent will guide a human developer through reviewing the plan. It will show the plan or where the plan is located and give the human an opportunity to ask questions, provide feedback, modify the plan, and generally have a conversation about the plan. The agent will then take the human's input and will add an issue comment summarizing the conversation, the human's feedback, and any modifications to the plan. The agent will also include an HTML comment in the issue comment instructing the orchestrator action to proceed to either the design or implementation state based on the human's feedback.
- GitHub Copilot App Canvas for Visualizing Issue Progress: This will be a canvas extension for the GitHub Copilot App that will visualize the progress of an issue through the AutoDev workflow. It will show state history, the current state, and any relevant information about the issue's progress. It will also provide a way for developers to interact with the issue and provide feedback or ask questions.
