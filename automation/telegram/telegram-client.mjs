export class TelegramClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TelegramClientError";
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TelegramClientError("INVALID_INPUT", `${field} is required`, { field });
  return normalized;
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value);
  if (maxLength && normalized.length > maxLength) {
    throw new TelegramClientError("INVALID_INPUT", `${field} is too long`, { field, maxLength });
  }
  return normalized;
}

function normalizeChatId(value) {
  const normalized = requireText(value, "chatId");
  if (normalized.length > 128) {
    throw new TelegramClientError("INVALID_INPUT", "chatId is too long", { field: "chatId" });
  }
  return normalized;
}

function normalizeToken(value) {
  const token = requireText(value, "botToken");
  if (/[\s/]/.test(token)) {
    throw new TelegramClientError("INVALID_INPUT", "botToken contains invalid characters", { field: "botToken" });
  }
  return token;
}

function normalizeApiBaseUrl(value) {
  const url = new URL(value ?? "https://api.telegram.org");
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new TelegramClientError("INVALID_INPUT", "apiBaseUrl must use http or https", { field: "apiBaseUrl" });
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeFilePath(value) {
  const filePath = requireText(value, "filePath");
  if (filePath.includes("..") || filePath.startsWith("/") || filePath.includes("\\")) {
    throw new TelegramClientError("INVALID_INPUT", "filePath is invalid", { field: "filePath" });
  }
  return filePath;
}

async function parseTelegramResponse(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new TelegramClientError("TELEGRAM_INVALID_RESPONSE", "Telegram returned a non-JSON response", {
      status: response.status,
    });
  }

  if (!response.ok) {
    throw new TelegramClientError("TELEGRAM_HTTP_ERROR", "Telegram request failed at the HTTP layer", {
      status: response.status,
      body,
    });
  }
  if (body?.ok !== true) {
    throw new TelegramClientError("TELEGRAM_API_ERROR", "Telegram API rejected the request", { body });
  }
  return body.result;
}

export function createTelegramClient({
  botToken,
  apiBaseUrl = "https://api.telegram.org",
  fetchImpl = globalThis.fetch,
} = {}) {
  const token = normalizeToken(botToken);
  const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
  if (typeof fetchImpl !== "function") {
    throw new TelegramClientError("INVALID_INPUT", "fetchImpl function is required", { field: "fetchImpl" });
  }

  async function call(method, payload) {
    const response = await fetchImpl(`${baseUrl}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    return parseTelegramResponse(response);
  }

  async function getFile({ fileId } = {}) {
    return call("getFile", { file_id: requireText(fileId, "fileId") });
  }

  async function downloadFileText({ filePath, maxBytes = 512_000 } = {}) {
    const path = normalizeFilePath(filePath);
    const response = await fetchImpl(`${baseUrl}/file/bot${token}/${path}`);
    if (!response.ok) {
      throw new TelegramClientError("TELEGRAM_HTTP_ERROR", "Telegram file download failed", {
        status: response.status,
      });
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new TelegramClientError("FILE_TOO_LARGE", "Telegram file is too large", { maxBytes, contentLength });
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      throw new TelegramClientError("FILE_TOO_LARGE", "Telegram file is too large", { maxBytes });
    }
    return text;
  }

  return {
    call,
    getFile,
    downloadFileText,

    async downloadDocumentText({ fileId, maxBytes } = {}) {
      const file = await getFile({ fileId });
      return downloadFileText({ filePath: file.file_path, maxBytes });
    },

    sendMessage({
      chatId,
      text,
      parseMode,
      replyMarkup,
      replyParameters,
      disableWebPagePreview,
      disableNotification,
    }) {
      const body = {
        chat_id: normalizeChatId(chatId),
        text: requireText(optionalText(text, "text", 4096), "text"),
      };
      if (parseMode) body.parse_mode = requireText(parseMode, "parseMode");
      if (replyMarkup) body.reply_markup = replyMarkup;
      if (replyParameters) body.reply_parameters = replyParameters;
      if (disableWebPagePreview !== undefined) body.disable_web_page_preview = Boolean(disableWebPagePreview);
      if (disableNotification !== undefined) body.disable_notification = Boolean(disableNotification);
      return call("sendMessage", body);
    },

    answerCallbackQuery({ callbackQueryId, text, showAlert, url, cacheTime } = {}) {
      const body = { callback_query_id: requireText(callbackQueryId, "callbackQueryId") };
      const notification = optionalText(text, "text", 200);
      if (notification !== undefined) body.text = notification;
      if (showAlert !== undefined) body.show_alert = Boolean(showAlert);
      if (url !== undefined) body.url = requireText(url, "url");
      if (cacheTime !== undefined) body.cache_time = Number(cacheTime);
      return call("answerCallbackQuery", body);
    },
  };
}
