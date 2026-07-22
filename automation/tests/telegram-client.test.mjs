import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTelegramClient, TelegramClientError } from "../telegram/telegram-client.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Telegram client", () => {
  test("sends JSON sendMessage requests to the Bot API", async () => {
    const calls = [];
    const client = createTelegramClient({
      botToken: "123:abc",
      fetchImpl: async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({ ok: true, result: { message_id: 42 } });
      },
    });

    const result = await client.sendMessage({
      chatId: "5678",
      text: "hello",
      replyMarkup: { inline_keyboard: [[{ text: "OK", callback_data: "ok" }]] },
    });

    assert.equal(result.message_id, 42);
    assert.equal(calls[0].url, "https://api.telegram.org/bot123:abc/sendMessage");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(calls[0].body, {
      chat_id: "5678",
      text: "hello",
      reply_markup: { inline_keyboard: [[{ text: "OK", callback_data: "ok" }]] },
    });
  });

  test("answers callback queries and enforces Telegram text limits", async () => {
    const calls = [];
    const client = createTelegramClient({
      botToken: "123:abc",
      fetchImpl: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return jsonResponse({ ok: true, result: true });
      },
    });

    assert.equal(await client.answerCallbackQuery({ callbackQueryId: "cb1", text: "done" }), true);
    assert.equal(calls[0].url, "https://api.telegram.org/bot123:abc/answerCallbackQuery");
    assert.deepEqual(calls[0].body, { callback_query_id: "cb1", text: "done" });

    assert.throws(
      () => client.answerCallbackQuery({ callbackQueryId: "cb2", text: "x".repeat(201) }),
      (error) => error instanceof TelegramClientError && error.code === "INVALID_INPUT",
    );
    assert.throws(
      () => client.sendMessage({ chatId: "5678", text: "" }),
      (error) => error instanceof TelegramClientError && error.code === "INVALID_INPUT",
    );
  });

  test("surfaces HTTP and API errors with structured codes", async () => {
    const httpClient = createTelegramClient({
      botToken: "123:abc",
      fetchImpl: async () => jsonResponse({ ok: false, description: "bad gateway" }, 502),
    });
    await assert.rejects(
      () => httpClient.sendMessage({ chatId: "5678", text: "hello" }),
      (error) => error instanceof TelegramClientError && error.code === "TELEGRAM_HTTP_ERROR",
    );

    const apiClient = createTelegramClient({
      botToken: "123:abc",
      fetchImpl: async () => jsonResponse({ ok: false, description: "chat not found" }),
    });
    await assert.rejects(
      () => apiClient.sendMessage({ chatId: "5678", text: "hello" }),
      (error) => error instanceof TelegramClientError && error.code === "TELEGRAM_API_ERROR",
    );
  });
});
