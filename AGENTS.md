# Repository Instructions

## Mission

Build a daily learning and publishing system for an engineer studying LLMs,
computer architecture, DRAM/HBM, CXL, emerging memory, and performance.
The public output is a Korean-language Astro blog. The final workflow will send
an 08:30 Asia/Seoul Telegram lesson, support Q&A and revision, require explicit
human approval, and only then publish.

## Read First

1. Read `docs/PROJECT_STATUS.md`.
2. Read `tasks/BOARD.md` and claim exactly one task before editing.
3. Read `docs/AGENT_WORKFLOW.md` for role and handoff rules.
4. Read `docs/ARCHITECTURE.md` before changing automation boundaries.

## Sources of Truth

- Curriculum: `src/data/curriculum.ts`
- Product and automation design: `docs/ARCHITECTURE.md`
- Current work and ownership: `tasks/BOARD.md`
- Agent roles: `.codex/agents/*.toml`
- Draft content: `content/drafts/`
- Published Astro pages: `src/pages/posts/`

Do not duplicate the full curriculum in Markdown. Link to the TypeScript source.

## Path Ownership

- Curriculum changes: `src/data/curriculum.ts`, one curriculum owner only.
- Content changes: one assigned file under `content/drafts/` or `src/pages/posts/`.
- UI changes: explicitly assigned files under `src/layouts/`, `src/styles/`, or `src/pages/`.
- Automation changes: explicitly assigned future paths under `automation/` and `.github/workflows/`.
- QA agents are read-only unless the root agent assigns a unique test-file path.
- Do not edit generated or vendored paths: `dist/`, `.astro/`, `artifacts/`, `node_modules/`, `.tools/`.

## Multi-Agent Rules

- The root agent owns planning, integration, user decisions, and final checks.
- Delegate independent read-heavy research, review, and test work in parallel.
- Parallel writers must have disjoint file ownership recorded in `tasks/BOARD.md`.
- Never let two agents edit the same file concurrently.
- Keep `agents.max_depth = 1`; subagents do not spawn more subagents.
- Return distilled findings with file references, not raw logs.
- A handoff must state: task ID, files changed, decisions, validation, risks, and next action.
- Store durable handoffs in `tasks/handoffs/<task-id>.md`.

## Content Rules

- Prefer primary sources: standards, vendor documentation, papers, and official repositories.
- Record every important factual claim in a claim ledger before publishing.
- Separate established fact, interpretation, and prediction.
- Explain concepts from system behavior down to memory traffic and bottlenecks.
- Write public posts in Korean with English technical terms on first use where useful.
- Never include employer-confidential, customer-confidential, unreleased product,
  internal benchmark, roadmap, process, yield, or proprietary design information.
- Treat user-provided corporate material as private unless the user explicitly confirms it is public.

## Approval and Publishing

- AI may research, draft, review, test, and prepare a deployment.
- Publishing requires an explicit human approval event tied to a content revision.
- A new edit invalidates the prior approval.
- Never deploy from a Telegram message alone; verify allowed chat/user and signed callback data.
- Never commit tokens, API keys, chat IDs, or credentials. Use `.env` locally and repository secrets in CI.

## Engineering Rules

- Follow existing Astro and TypeScript patterns.
- Keep the UI dense, readable, responsive, and useful; avoid marketing-only screens.
- Use Lucide icons from the installed package for interface actions.
- Scope changes to the claimed task. Do not reformat unrelated files.
- Do not delete or reinitialize `.git`; see `docs/GIT_RECOVERY.md`.
- Use `apply_patch` for manual edits.

## Validation

Run before handoff:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

For visual changes, also run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\visual-check.ps1
```

Report any validation that could not run and why.
