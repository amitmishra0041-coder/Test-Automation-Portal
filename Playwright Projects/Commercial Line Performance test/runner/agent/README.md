# Assistant (experimental, dev Runner only)

A plan-and-run assistant on top of the Runner's own tools. **Off by default.**

## Turn on / off
- On: start the dev Runner with `RUNNER_AGENT=1` (e.g. PowerShell `$env:RUNNER_AGENT='1'; npm run runner`).
- Off: start it without the flag. The Assistant tab, its API and its UI files are not loaded at all.
- Never active in the packaged team installer (`RUNNER_PACKAGED=1`), even with the flag.
- Full revert: `git checkout main` (all work is on the `agent-assistant` branch).

## Data policy
No Donegal data is sent to any AI service. Planning is rule-based (`planner.js`). An optional local model
(`AGENT_LOCAL_MODEL_URL=http://localhost:11434`, `AGENT_LOCAL_MODEL=<name>`) is allowed only on localhost;
any other host is refused.

## How it works
| File | Role |
|---|---|
| `tools.js` | Internal tools with a risk level: `read` / `report` run automatically, `send` waits for approval |
| `planner.js` | Objective → steps (intent rules + slots: project, JQL, recipients, days); saved preferences fill gaps |
| `orchestrator.js` | Runs steps, 3-min timeout, 1 retry, pause/resume/cancel, approvals, final validation, audit log, task history, memory |
| `routes.js` | `/api/agent/*` (identity = the Runner email, `X-Runner-User`), rate limit 10 tasks/min/user |
| `ui/` | The Assistant tab (loaded only when enabled) |

Data on disk: `runtime-data/agent/` — `tasks/*.json` (history, survives restarts), `audit.jsonl`, `memory.json`
(only `defaultProject` and `defaultRecipients`; users can clear them). Reports: `reports/assistant/`.

## Tests
`node --test runner/agent/tests/agent.node-test.js` — no Jira or email is touched.

## Not built yet (later phases)
MCP connections, document search (RAG), scheduled/background runs, multiple specialised agents.
Token/cost metrics read 0 because no model is used.
