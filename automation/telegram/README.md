# Telegram Webhook

`telegram-webhook.mjs` is the transport boundary for a Cloudflare Worker. Message replies, callback acknowledgements, and approval-token resolution are injected as functions so they can be tested independently.

The handler performs these checks in order:

1. `POST` method
2. `X-Telegram-Bot-Api-Secret-Token`
3. JSON and `update_id` validation
4. exact Telegram user and chat allowlist
5. atomic `(bot_id, update_id)` claim with a short lease
6. message or approval callback routing
7. durable completion record

Approval callback data has the shape `approve:<challenge-id>:<opaque-token>`. The Worker-generated approval prompt uses the opaque token as the nonce and stores only its hash in the approval challenge. The default resolver still rejects requests so a deployment cannot accidentally treat client-supplied data as the approval nonce without choosing that contract explicitly.

`telegram-client.mjs` wraps `sendMessage` and `answerCallbackQuery` with JSON POST requests. `lesson-command-router.mjs` handles `/today`, `/revise`, `/review`, `/help`, and plain-text Q&A. `worker.mjs` expects a D1 binding named `DB` and the environment values in `.env.example`, including `DAILY_CURRICULUM_REF` until a full curriculum selector is wired in.
