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

Approval callback data has the shape `approve:<opaque-token>` so it stays under Telegram's 64-byte callback limit. The Worker-generated approval prompt uses the opaque token as the nonce, stores only its hash in the approval challenge, and resolves the pending challenge from D1 when the button is pressed. The legacy `approve:<challenge-id>:<opaque-token>` shape is still parsed for compatibility.

`telegram-client.mjs` wraps `sendMessage` and `answerCallbackQuery` with JSON POST requests. `lesson-command-router.mjs` handles `/today`, `/revise`, `/review`, `/help`, and plain-text Q&A. `worker.mjs` expects a D1 binding named `DB` and the environment values in `.env.example`, including `DAILY_CURRICULUM_REF` until a full curriculum selector is wired in.
