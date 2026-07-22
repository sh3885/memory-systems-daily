# Cloudflare Deployment Guide

This project runs the Telegram bot and daily 08:30 KST scheduler as a Cloudflare Worker with D1.

## Current Mode

- `AI_MODE=manual`: Telegram sends Claude web prompts; the user pastes the Claude result back with `/draft`.
- Claude API is optional and only used by `/ask-api` and `/revise-api` when `ANTHROPIC_API_KEY` is present.
- The active model is configured by `ANTHROPIC_MODEL`.
- The Telegram webhook path is `/telegram/webhook`.

## Local Checks

Run this before deployment work:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-env.ps1
```

This reports which keys are present without printing secrets.

## Cloudflare Setup

1. Create a Cloudflare Worker using the "Hello World" or empty Worker path. GitHub connection is not required for the Worker.
2. Create a D1 database named `memory-systems-daily-db`.
3. Use `wrangler.toml.example` as the deployment template and fill the D1 `database_id`.
4. Add Worker secrets for the values from `.env`.

Dry-run the secret list first:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\set-worker-secrets.ps1 -DryRun
```

Upload the secrets after `wrangler.toml` exists and Wrangler is logged in:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\set-worker-secrets.ps1
```

The uploaded secret names are:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_BOT_ID
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_ALLOWED_USER_ID
TELEGRAM_ALLOWED_CHAT_ID
AI_MODE
ANTHROPIC_API_KEY
ANTHROPIC_MODEL
DAILY_CURRICULUM_REF
CONTENT_TIMEZONE
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY
GITHUB_INSTALLATION_ID
GITHUB_OWNER
GITHUB_REPOSITORY
GITHUB_CONTENT_BRANCH
GITHUB_CONTENT_DIRECTORY
APPROVAL_SIGNING_SECRET
```

`PUBLIC_SITE_URL`, `DEPLOYMENT_PROVIDER`, and `DEPLOYMENT_TOKEN` are not needed for the current manual Telegram loop. They become relevant when approval-to-deploy is fully connected.

## D1 Migration

After Wrangler is logged in and the D1 database exists:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\apply-d1-migrations.ps1 -DatabaseName memory-systems-daily-db
```

## Deploy Worker

Deploy with Wrangler after the real `wrangler.toml` exists:

```powershell
npx wrangler deploy
```

The scheduled trigger in the template is `30 23 * * *`, which is 08:30 Asia/Seoul.

## Register Telegram Webhook

After deployment, take the Worker URL and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\set-telegram-webhook.ps1 -WorkerUrl https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev
```

Telegram will then deliver bot messages to:

```text
https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/telegram/webhook
```

## First Smoke Test

1. Send `/today` to the bot.
2. Send `/prompt` and paste the output into Claude web.
3. Paste Claude's answer back with `/draft ...`.
4. Send `/review` and press the approval button.

Publishing after approval is the next implementation task.
