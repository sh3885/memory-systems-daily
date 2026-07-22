export class AnthropicProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AnthropicProviderError";
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new AnthropicProviderError("INVALID_INPUT", `${field} is required`, { field });
  return normalized;
}

function normalizeBaseUrl(value) {
  const url = new URL(value ?? "https://api.anthropic.com/v1");
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new AnthropicProviderError("INVALID_INPUT", "baseUrl must use http or https", { field: "baseUrl" });
  }
  return url.toString().replace(/\/$/, "");
}

function extractText(body) {
  const text = (body?.content ?? [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
  if (!text) throw new AnthropicProviderError("EMPTY_RESPONSE", "Anthropic response did not contain text", { body });
  return text;
}

async function parseJsonResponse(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new AnthropicProviderError("ANTHROPIC_INVALID_RESPONSE", "Anthropic returned a non-JSON response", {
      status: response.status,
    });
  }

  if (!response.ok) {
    throw new AnthropicProviderError("ANTHROPIC_HTTP_ERROR", "Anthropic request failed at the HTTP layer", {
      status: response.status,
      type: body?.error?.type,
      body,
      retryAfter: response.headers.get("retry-after"),
    });
  }
  if (body?.error) {
    throw new AnthropicProviderError("ANTHROPIC_API_ERROR", "Anthropic API returned an error", {
      type: body.error.type,
      body,
    });
  }
  return body;
}

export function createAnthropicMessagesClient({
  apiKey,
  model = "claude-sonnet-5",
  baseUrl = "https://api.anthropic.com/v1",
  anthropicVersion = "2023-06-01",
  fetchImpl = globalThis.fetch,
  defaultMaxTokens = 2048,
} = {}) {
  const key = requireText(apiKey, "apiKey");
  const selectedModel = requireText(model, "model");
  const endpoint = `${normalizeBaseUrl(baseUrl)}/messages`;
  if (typeof fetchImpl !== "function") {
    throw new AnthropicProviderError("INVALID_INPUT", "fetchImpl function is required", { field: "fetchImpl" });
  }

  return {
    providerId: "anthropic",
    model: selectedModel,

    async createMessage({ system, input, maxTokens = defaultMaxTokens, metadata } = {}) {
      const body = {
        model: selectedModel,
        max_tokens: Number(maxTokens),
        system: requireText(system, "system"),
        messages: [{ role: "user", content: requireText(input, "input") }],
      };
      if (!Number.isSafeInteger(body.max_tokens) || body.max_tokens <= 0) {
        throw new AnthropicProviderError("INVALID_INPUT", "maxTokens must be a positive safe integer", {
          field: "maxTokens",
        });
      }
      if (metadata) body.metadata = metadata;

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-api-key": key,
          "anthropic-version": requireText(anthropicVersion, "anthropicVersion"),
        },
        body: JSON.stringify(body),
      });
      const responseBody = await parseJsonResponse(response);
      return { body: responseBody, outputText: extractText(responseBody) };
    },
  };
}

function revisionContext({ lessonDate, lesson, revision }) {
  return [
    `lessonDate: ${lessonDate ?? "unknown"}`,
    `curriculumRef: ${lesson?.curriculumRef ?? "unknown"}`,
    `lessonState: ${lesson?.state ?? "missing"}`,
    `revisionNumber: ${revision?.revisionNumber ?? 0}`,
    "",
    "currentRevision:",
    revision?.content ?? "(no current revision)",
  ].join("\n");
}

export function createClaudeAnswerProvider({ messagesClient }) {
  if (!messagesClient?.createMessage) {
    throw new AnthropicProviderError("INVALID_INPUT", "messagesClient is required", { field: "messagesClient" });
  }
  return async function answerQuestion({ question, lessonDate, lesson, revision }) {
    const response = await messagesClient.createMessage({
      system: [
        "You are a Korean tutor for an engineer studying LLMs, computer architecture, DRAM/HBM, CXL, and memory bottlenecks.",
        "Answer in Korean. Keep public-company confidentiality boundaries strict.",
        "Separate established facts from interpretation. Be concise but technically precise.",
      ].join("\n"),
      input: [
        revisionContext({ lessonDate, lesson, revision }),
        "",
        "userQuestion:",
        requireText(question, "question"),
      ].join("\n"),
      metadata: { workflow: "telegram_qna" },
    });
    return {
      answer: response.outputText,
      provider: {
        id: messagesClient.providerId ?? "anthropic",
        model: messagesClient.model ?? null,
        attempts: [],
      },
    };
  };
}

export function createClaudeRevisionProvider({ messagesClient }) {
  if (!messagesClient?.createMessage) {
    throw new AnthropicProviderError("INVALID_INPUT", "messagesClient is required", { field: "messagesClient" });
  }
  return async function reviseDraft({ instruction, currentContent, lesson }) {
    const response = await messagesClient.createMessage({
      system: [
        "You revise a Korean technical learning draft.",
        "Return the full revised Markdown document only. Do not wrap it in code fences.",
        "Preserve confidentiality and avoid unsupported factual additions.",
      ].join("\n"),
      input: [
        `curriculumRef: ${lesson?.curriculumRef ?? "unknown"}`,
        "",
        "revisionInstruction:",
        requireText(instruction, "instruction"),
        "",
        "currentMarkdown:",
        requireText(currentContent, "currentContent"),
      ].join("\n"),
      metadata: { workflow: "telegram_revision" },
    });
    return {
      content: response.outputText,
      changeSummary: "Revised by Claude Messages provider from Telegram instruction",
      provider: {
        id: messagesClient.providerId ?? "anthropic",
        model: messagesClient.model ?? null,
        attempts: [],
      },
    };
  };
}
