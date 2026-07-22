# Next Steps

Last updated: 2026-07-22

## Operating Mode

The project should now move in autonomous batches, not one tiny step at a time.

Default execution rule:

- Codex continues through implementation, validation, deployment, and commit without pausing for every small decision.
- Ask the user only when an external account action, payment decision, public URL, destructive operation, or content-policy judgment is required.
- Report back with concise summaries: what changed, what was verified, what remains.
- Keep durable state in `tasks/BOARD.md`, `tasks/handoffs/`, and this file so other agents can continue without re-asking context.

## Current State

Working pieces:

- Local Astro blog project.
- Telegram bot webhook on Cloudflare Worker.
- Cloudflare D1 lesson/revision/approval/publication storage.
- 08:30 KST scheduled lesson creation and Telegram notification.
- Manual Claude web workflow: `/prompt`, `/draft`, `/revise`.
- Optional Claude API workflow: `/ask-api`, `/revise-api`.
- Approval button flow.
- GitHub App publishing to `content/daily` branch with PR creation.

Still unproven in real use:

- A full real Telegram run from `/prompt` to approval button to GitHub PR.
- Real 08:30 KST cron delivery observed in production.
- Public Astro site hosting URL and final post URL recording.

## P0: Prove The End-To-End Loop

Goal: confirm the system actually supports daily posting.

Tasks:

- Send `/today` in Telegram and confirm today's lesson exists.
- Send `/prompt`, paste the result into Claude web, and produce a Korean draft.
- Send `/draft <full markdown>` back to Telegram.
- Send `/review` and press the approval button.
- Confirm GitHub branch `content/daily` receives a new post file.
- Confirm GitHub PR is created or reused.
- Confirm D1 `publications` table records the publication.
- Fix any GitHub App permission, branch, file path, or Markdown rendering issue found during the first real run.

Done when:

- One real post reaches a GitHub PR from Telegram approval.

## P1: Public Blog Hosting

Goal: approved posts should become public blog pages, not only GitHub PRs.

Tasks:

- Choose hosting path: Cloudflare Pages, GitHub Pages, or another static host.
- Connect the repository and configure Astro build.
- Decide whether PR merge is manual or automated after approval.
- Set `PUBLIC_SITE_URL` in `.env` and Worker secrets.
- Redeploy Worker so publication records contain final public URLs.
- Add a production smoke test for a published post URL.

Recommended direction:

- Use Cloudflare Pages first because the Worker and D1 are already in Cloudflare.

Done when:

- A post approved in Telegram becomes reachable at the public site URL.

## P2: Curriculum Revision

Goal: make the learning path match the user's actual job needs: DRAM company engineer studying systems that consume memory.

Tasks:

- Rebalance curriculum so LLM fundamentals and memory systems both appear early.
- Add explicit tracks:
  - LLM fundamentals and current trends.
  - GPU/accelerator architecture for AI.
  - DRAM, HBM, DDR, LPDDR, GDDR.
  - Memory controller, cache, NUMA, interconnect.
  - CXL and memory expansion/pooling.
  - PIM, near-memory computing, persistent/emerging memory.
  - Performance modeling: bandwidth, latency, capacity, energy.
- Define daily post templates by topic type.
- Add "what I should understand after today" for each lesson.
- Add review weeks and synthesis posts.

Done when:

- `src/data/curriculum.ts` reflects a practical 36-week path and the first 2 weeks feel coherent.

## P3: Better Daily Telegram UX

Goal: reduce copy-paste friction while keeping API cost under control.

Tasks:

- Add `/status` for current lesson, revision, approval, and publication state.
- Add `/commands` with shorter Korean instructions.
- Add `/publish-retry` for failed GitHub publishing.
- Add `/skip` or `/tomorrow` only if daily operation needs it.
- Improve messages that are currently too technical or broken-looking.
- Add a "today's checklist" message after `/prompt`.

Done when:

- The user can operate the daily flow without remembering hidden details.

## P4: Content Quality And Safety

Goal: make public posts credible and safe for an engineer at a DRAM company.

Tasks:

- Enforce source/claim ledger before publication for non-trivial factual claims.
- Add a pre-publication content-policy checklist:
  - no employer confidential information
  - no customer confidential information
  - no unreleased roadmap/process/yield/design details
  - public sources only
  - fact vs interpretation vs prediction separated
- Add a technical review prompt for Claude web.
- Add a "claim gaps" section in draft prompts.

Done when:

- Drafts consistently cite public sources and avoid confidential material.

## P5: Automation Hardening

Goal: make the system resilient enough for daily use.

Tasks:

- Add production health check command or endpoint.
- Add scheduled-job idempotency reporting.
- Add publishing retry from Telegram.
- Add Worker log inspection guide.
- Add D1 backup/export guide.
- Add GitHub App permission verification script.
- Add deployment rollback notes.

Done when:

- A failed daily post can be diagnosed and retried without digging through code.

## P6: Site Polish

Goal: make the blog usable as a study archive.

Tasks:

- Add generated post index from `src/pages/posts`.
- Add tag/category pages for LLM, DRAM, HBM, CXL, architecture, performance.
- Add curriculum progress page showing completed/pending lessons.
- Add search or compact archive view.
- Fix any existing Korean text encoding artifacts in UI files.
- Improve mobile readability for long technical posts.

Done when:

- The public site feels like a real study archive, not just isolated pages.

## P7: Agent Workflow Cleanup

Goal: let multiple code agents continue without confusion.

Tasks:

- Keep every new task claimed in `tasks/BOARD.md`.
- Store durable handoffs in `tasks/handoffs/`.
- Keep secrets only in `.env` and Cloudflare/GitHub secrets.
- Add a short "start here" operator guide.
- Make `docs/NEXT_STEPS.md` the roadmap source for future planning.

Done when:

- A fresh agent can understand current status and next actions in under five minutes.

## Suggested Next Batch

The next autonomous batch should be:

1. Run the real Telegram end-to-end flow and fix any issue.
2. Add `/status` and `/publish-retry`.
3. Create Cloudflare Pages hosting and set `PUBLIC_SITE_URL`.
4. Clean up the first two weeks of curriculum.
5. Fix visible Korean encoding artifacts in the UI/messages.

This batch should be done with one final summary to the user, unless external account approval or a public hosting choice is required.
