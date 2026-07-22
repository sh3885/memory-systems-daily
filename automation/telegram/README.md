# Telegram Webhook

`telegram-webhook.mjs` is the transport boundary for a Cloudflare Worker. It does not call the Telegram API directly; message replies and server-side approval-token resolution are injected as functions so they can be tested independently.

The handler performs these checks in order:

1. `POST` method
2. `X-Telegram-Bot-Api-Secret-Token`
3. JSON and `update_id` validation
4. exact Telegram user and chat allowlist
5. atomic `(bot_id, update_id)` claim with a short lease
6. message or approval callback routing
7. durable completion record

Approval callback data has the shape `approve:<challenge-id>:<opaque-token>`. The opaque token must be resolved by a server-side `resolveApprovalCallback` implementation. The default resolver rejects requests so a deployment cannot accidentally treat client-supplied data as the approval nonce.

`worker.mjs` is the minimal Cloudflare Worker entrypoint. It expects a D1 binding named `DB` and the environment values in `.env.example`. It currently acknowledges messages; the tutor and Telegram API reply integration belong to the next automation task.

