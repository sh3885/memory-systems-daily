import { StoreError } from "../storage/d1-lesson-store.mjs";

const APPROVAL_ERROR_CODES = new Set([
  "APPROVAL_EXPIRED",
  "APPROVAL_IDENTITY_MISMATCH",
  "CHALLENGE_NOT_FOUND",
  "OPERATION_KEY_CONFLICT",
  "STALE_APPROVAL",
]);

export class TelegramWebhookError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "TelegramWebhookError";
    this.code = code;
    this.status = status;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function requiredConfig(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TelegramWebhookError("MISCONFIGURED", `${field} is not configured`, 500);
  return normalized;
}

function normalizeId(value) {
  return value === undefined || value === null ? null : String(value);
}

async function digestText(value) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function constantTimeEqual(left, right) {
  const [leftDigest, rightDigest] = await Promise.all([digestText(left), digestText(right)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < leftDigest.length; index += 1) difference |= leftDigest[index] ^ rightDigest[index];
  return difference === 0;
}

function getUpdateSource(update) {
  return update.callback_query ?? update.message ?? update.edited_message ?? update.my_chat_member ?? update.chat_member ?? update.channel_post ?? null;
}

export function getTelegramActor(update) {
  const source = getUpdateSource(update);
  const actor = source?.from ?? null;
  const chat = source?.message?.chat ?? source?.chat ?? null;
  return {
    userId: normalizeId(actor?.id),
    chatId: normalizeId(chat?.id),
    chatType: chat?.type ?? null,
  };
}

export function parseApprovalCallbackData(data) {
  if (typeof data !== "string" || !data.startsWith("approve:")) return null;
  const [, challengeId, token] = data.split(":");
  if (!challengeId || !token || data.split(":").length !== 3) {
    throw new TelegramWebhookError("MALFORMED_CALLBACK", "Approval callback payload is malformed", 400);
  }
  return { action: "approve", challengeId, token };
}

function validateUpdate(update) {
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    throw new TelegramWebhookError("MALFORMED_UPDATE", "Telegram update must be a JSON object", 400);
  }
  if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) {
    throw new TelegramWebhookError("MALFORMED_UPDATE", "Telegram update_id must be a non-negative safe integer", 400);
  }
  if (!getUpdateSource(update)) {
    throw new TelegramWebhookError("MALFORMED_UPDATE", "Telegram update has no supported message or callback source", 400);
  }
  return update;
}

function isKnownHandledError(error) {
  return error instanceof TelegramWebhookError ||
    (error instanceof StoreError && APPROVAL_ERROR_CODES.has(error.code));
}

function publicErrorCode(error) {
  return error?.code ?? "WEBHOOK_ERROR";
}

async function readJson(request) {
  let raw;
  try {
    raw = await request.text();
    return JSON.parse(raw);
  } catch {
    throw new TelegramWebhookError("INVALID_JSON", "Request body is not valid JSON", 400);
  }
}

export function createTelegramWebhook({
  env = {},
  botId = env.TELEGRAM_BOT_ID,
  webhookPath = "/telegram/webhook",
  store,
  onMessage = async () => ({ action: "ignored_message" }),
  onCallback = async () => ({ action: "ignored_callback" }),
  resolveApprovalCallback = async () => {
    throw new TelegramWebhookError("CALLBACK_RESOLVER_NOT_CONFIGURED", "Approval callback resolver is not configured", 500);
  },
} = {}) {
  if (!store?.claimTelegramUpdate || !store?.completeTelegramUpdate) {
    throw new TelegramWebhookError("MISCONFIGURED", "A Telegram update store is required", 500);
  }
  const configuredBotId = requiredConfig(botId, "TELEGRAM_BOT_ID");
  const webhookSecret = requiredConfig(env.TELEGRAM_WEBHOOK_SECRET, "TELEGRAM_WEBHOOK_SECRET");
  const allowedUserId = requiredConfig(env.TELEGRAM_ALLOWED_USER_ID, "TELEGRAM_ALLOWED_USER_ID");
  const allowedChatId = requiredConfig(env.TELEGRAM_ALLOWED_CHAT_ID, "TELEGRAM_ALLOWED_CHAT_ID");
  return async function handle(request) {
    if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    if (new URL(request.url).pathname !== webhookPath) return json({ ok: false, error: "NOT_FOUND" }, 404);
    const suppliedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!(await constantTimeEqual(suppliedSecret, webhookSecret))) {
      return json({ ok: false, error: "UNAUTHORIZED_WEBHOOK" }, 401);
    }

    let update;
    try {
      update = validateUpdate(await readJson(request));
    } catch (error) {
      if (error instanceof TelegramWebhookError) {
        return json({ ok: false, error: error.code }, error.status);
      }
      throw error;
    }
    const actor = getTelegramActor(update);
    if (actor.userId !== allowedUserId || actor.chatId !== allowedChatId || actor.chatType !== "private") {
      return json({ ok: false, error: "FORBIDDEN_ACTOR" }, 403);
    }

    const claim = await store.claimTelegramUpdate({
      botId: configuredBotId,
      updateId: update.update_id,
    });
    if (claim.status === "duplicate" || claim.status === "in_progress") {
      return json({ ok: true, duplicate: claim.status === "duplicate", inProgress: claim.status === "in_progress" });
    }

    try {
      let outcome;
      if (update.callback_query) {
        const callback = parseApprovalCallbackData(update.callback_query.data);
        if (callback?.action === "approve") {
          const binding = await resolveApprovalCallback({ callback, update, actor });
          const approval = await store.consumeApprovalChallenge({
            challengeId: callback.challengeId,
            telegramUserId: actor.userId,
            telegramChatId: actor.chatId,
            nonce: requiredConfig(binding?.nonce, "approval nonce"),
            operationKey: `telegram:approval:${configuredBotId}:${update.update_id}`,
          });
          outcome = { action: "approval_recorded", approvalId: approval.id };
        } else {
          outcome = await onCallback({ update, actor });
        }
      } else {
        outcome = await onMessage({ update, actor });
      }

      const result = JSON.stringify({ status: "handled", action: outcome?.action ?? "completed" });
      await store.completeTelegramUpdate({
        botId: configuredBotId,
        updateId: update.update_id,
        claimToken: claim.claimToken,
        result,
      });
      return json({ ok: true, handled: true, ...(outcome ?? {}) });
    } catch (error) {
      if (isKnownHandledError(error)) {
        const result = JSON.stringify({ status: "rejected", error: publicErrorCode(error) });
        await store.completeTelegramUpdate({
          botId: configuredBotId,
          updateId: update.update_id,
          claimToken: claim.claimToken,
          result,
        });
        return json({ ok: true, handled: true, rejected: publicErrorCode(error) });
      }
      console.error("telegram_update_processing_failed", {
        botId: configuredBotId,
        updateId: update.update_id,
        error: error?.message ?? String(error),
      });
      return json({ ok: false, error: "PROCESSING_FAILED" }, 500);
    }
  };
}
