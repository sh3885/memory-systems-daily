# Daily Blog Operations

## Core Terms

- `lesson`: one daily study/posting unit. It tracks the date, curriculum ref, current draft revision, approval, and web publishing state.
- `revision`: an immutable saved draft. Every `/draft` or accepted API revision creates a new revision.
- `approval`: the explicit Telegram button approval for one exact revision and content hash.
- `publication`: the record that the approved revision was actually reflected on the public blog.
- `D1`: Cloudflare's SQLite-style database. The Worker stores lesson, revision, approval, Telegram update, and publication state there.

## State Flow

```text
scheduled
  -> researching
  -> draft_ready
  -> discussing
  -> review_ready
  -> approved
  -> publishing
  -> published
```

Failure states:

- `research_failed`: topic or draft generation failed.
- `publish_failed`: GitHub write, Pages deploy, or production URL verification failed.

`published` must mean the production Pages URL was verified by content markers. A GitHub commit or PR alone is not enough.

## Daily Telegram Flow

1. At 08:30 KST the Worker scheduler creates today's lesson and sends a Telegram message.
2. Send `/prompt` to receive a Claude web prompt.
3. Paste the prompt into Claude Pro.
4. Send the Markdown result back with `/draft`, or upload a `.md` file with caption `/draft`.
5. Ask questions or request changes with ordinary messages or `/revise`.
6. Send `/review`.
7. Press the approval button.
8. The Worker attempts publishing.
9. Confirm with `/status`.

## Commands

- `/today`: show today's lesson and current draft preview.
- `/status`: show lesson, revision, approval, publication, next action, and URL when available.
- `/prompt`: generate the Claude web draft prompt.
- `/draft <Markdown>`: save a Claude Markdown draft after quality checks.
- `/revise <request>`: generate a Claude web revision prompt.
- `/review`: create a revision-bound approval button.
- `/publish-retry`: retry GitHub write, Pages deploy verification, and final publication record.
- `/deploy-retry`: alias for `/publish-retry`.
- `/verify-url`: alias for `/publish-retry`; useful after a Pages deploy has finished.
- `/ask-api <question>`: use Claude API for one question when configured.
- `/revise-api <request>`: use Claude API for one revision when configured.

## Draft Quality Gate

`/draft` is rejected before saving when:

- the content has no H1 heading,
- the content is likely mojibake or encoding-corrupted,
- `Claim ledger` is missing,
- frontmatter category is present but not one of `LLM`, `Memory`, or `System`.

## Cloudflare Pieces

- Worker: receives Telegram webhooks, runs command routing, stores state in D1, and writes approved posts to GitHub.
- D1: stores workflow state and prevents stale approvals or duplicate Telegram processing.
- Pages: hosts the public Astro blog from a built `dist/` directory.

Important: this Pages project is direct-upload based, not Git-provider based. A GitHub PR does not automatically update the public site unless GitHub Actions or `wrangler pages deploy` runs.

## Deployment Paths

Recommended automated path:

1. Worker writes the approved Markdown post to GitHub.
2. GitHub Actions builds Astro.
3. GitHub Actions runs `wrangler pages deploy dist --project-name memory-systems-daily --branch main`.
4. Worker `/publish-retry` or `/verify-url` verifies:
   - post URL contains the expected title and `Claim ledger`,
   - home page links to the post,
   - category page links to the post.
5. Only then D1 records `published`.

Manual recovery path:

```powershell
npm.cmd run build
npx.cmd wrangler pages deploy dist --project-name memory-systems-daily --branch main
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-post.ps1 -Url "https://memory-systems-daily.pages.dev/posts/<slug>/" -Contains "<title>,Claim ledger"
```

## GitHub Actions Setup

The workflow template is stored at `docs/deploy-pages.workflow.yml`. To activate automatic deploys, copy it to `.github/workflows/deploy-pages.yml` with a GitHub token or account that has workflow-write permission.

The active workflow requires these repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The token needs Cloudflare Pages edit/deploy permission for the `memory-systems-daily` project.
