export class OpenAIProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "OpenAIProviderError";
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new OpenAIProviderError("INVALID_INPUT", `${field} is required`, { field });
  return normalized;
}

function normalizeBaseUrl(value) {
  const url = new URL(value ?? "https://api.openai.com/v1");
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new OpenAIProviderError("INVALID_INPUT", "baseUrl must use http or https", { field: "baseUrl" });
  }
  return url.toString().replace(/\/$/, "");
}

function extractOutputText(body) {
  if (typeof body?.output_text === "string" && body.output_text.trim()) return body.output_text;
  const fragments = [];
  for (const item of body?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") fragments.push(content.text);
    }
  }
  const text = fragments.join("\n").trim();
  if (!text) throw new OpenAIProviderError("EMPTY_RESPONSE", "OpenAI response did not contain output text", { body });
  return text;
}

async function parseJsonResponse(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new OpenAIProviderError("OPENAI_INVALID_RESPONSE", "OpenAI returned a non-JSON response", {
      status: response.status,
    });
  }
  if (!response.ok) {
    throw new OpenAIProviderError("OPENAI_HTTP_ERROR", "OpenAI request failed at the HTTP layer", {
      status: response.status,
      body,
    });
  }
  if (body?.error) {
    throw new OpenAIProviderError("OPENAI_API_ERROR", "OpenAI API returned an error", { body });
  }
  return body;
}

export function createOpenAIResponsesClient({
  apiKey,
  model = "gpt-5.6",
  baseUrl = "https://api.openai.com/v1",
  fetchImpl = globalThis.fetch,
  defaultReasoningEffort = "low",
  defaultWebSearch = true,
} = {}) {
  const key = requireText(apiKey, "apiKey");
  const selectedModel = requireText(model, "model");
  const endpoint = `${normalizeBaseUrl(baseUrl)}/responses`;
  if (typeof fetchImpl !== "function") {
    throw new OpenAIProviderError("INVALID_INPUT", "fetchImpl function is required", { field: "fetchImpl" });
  }

  return {
    async createResponse({
      instructions,
      input,
      reasoningEffort = defaultReasoningEffort,
      webSearch = defaultWebSearch,
      metadata,
    }) {
      const body = {
        model: selectedModel,
        instructions: requireText(instructions, "instructions"),
        input: requireText(input, "input"),
      };
      if (reasoningEffort) body.reasoning = { effort: requireText(reasoningEffort, "reasoningEffort") };
      if (webSearch) body.tools = [{ type: "web_search" }];
      if (metadata) body.metadata = metadata;

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });
      const responseBody = await parseJsonResponse(response);
      return { body: responseBody, outputText: extractOutputText(responseBody) };
    },
  };
}

function revisionContext({ lessonDate, lesson, revision }) {
  const lines = [
    `lessonDate: ${lessonDate ?? "unknown"}`,
    `curriculumRef: ${lesson?.curriculumRef ?? "unknown"}`,
    `lessonState: ${lesson?.state ?? "missing"}`,
    `revisionNumber: ${revision?.revisionNumber ?? 0}`,
    "",
    "currentRevision:",
    revision?.content ?? "(no current revision)",
  ];
  return lines.join("\n");
}

function parseJsonObject(text, field) {
  const raw = requireText(text, field);
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const value = JSON.parse(stripped);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value;
  } catch (error) {
    throw new OpenAIProviderError("INVALID_JSON_OUTPUT", `${field} must be a JSON object`, {
      field,
      cause: error.message,
    });
  }
}

export function createStudyAnswerProvider({ responsesClient }) {
  if (!responsesClient?.createResponse) {
    throw new OpenAIProviderError("INVALID_INPUT", "responsesClient is required", { field: "responsesClient" });
  }
  return async function answerQuestion({ question, lessonDate, lesson, revision }) {
    const response = await responsesClient.createResponse({
      instructions: [
        "You are a Korean tutor for an engineer studying LLMs, computer architecture, DRAM/HBM, CXL, and memory bottlenecks.",
        "Answer in Korean. Keep public-company confidentiality boundaries strict.",
        "Separate established facts from interpretation. If recent facts are needed, use web search and cite source names in prose.",
        "Do not modify the draft unless the user explicitly asks for a revision command.",
      ].join("\n"),
      input: [
        revisionContext({ lessonDate, lesson, revision }),
        "",
        "userQuestion:",
        requireText(question, "question"),
      ].join("\n"),
      metadata: { workflow: "telegram_qna" },
    });
    return { answer: response.outputText };
  };
}

export function createStudyResearchProvider({ responsesClient }) {
  if (!responsesClient?.createResponse) {
    throw new OpenAIProviderError("INVALID_INPUT", "responsesClient is required", { field: "responsesClient" });
  }
  return async function researchTopic({ lessonDate, curriculumRef, topic, checkedAt }) {
    const response = await responsesClient.createResponse({
      instructions: [
        "You create Korean technical study drafts for a DRAM systems engineer studying LLMs, architecture, memory systems, and emerging interfaces.",
        "Use only public information. Never include employer-confidential, customer-confidential, unreleased product, roadmap, benchmark, yield, or proprietary design details.",
        "Use web search when recent or source-backed facts are needed.",
        "Return a JSON object only, with keys: content, changeSummary, claims.",
        "content must be a Korean Markdown draft. claims must be an array of primary-source claims.",
        "Each claim must include claimKey, statement, sourceUrl, sourceTitle, sourceType, evidenceLocator, confidence, verificationStatus, checkedAt.",
        "Allowed sourceType values: standard, vendor_documentation, official_documentation, official_repository, paper, dataset.",
        "Allowed confidence values: high, medium, low. Allowed verificationStatus values: verified, needs_review, conflicting.",
      ].join("\n"),
      input: [
        `lessonDate: ${lessonDate}`,
        `curriculumRef: ${curriculumRef}`,
        `checkedAt: ${checkedAt}`,
        "",
        "topic:",
        JSON.stringify(topic ?? {}),
      ].join("\n"),
      metadata: { workflow: "daily_research_draft" },
    });
    const parsed = parseJsonObject(response.outputText, "researchOutput");
    return {
      content: requireText(parsed.content, "content"),
      changeSummary: requireText(parsed.changeSummary ?? "OpenAI research draft", "changeSummary"),
      claims: parsed.claims,
    };
  };
}

export function createStudyRevisionProvider({ responsesClient }) {
  if (!responsesClient?.createResponse) {
    throw new OpenAIProviderError("INVALID_INPUT", "responsesClient is required", { field: "responsesClient" });
  }
  return async function reviseDraft({ instruction, currentContent, lesson }) {
    const response = await responsesClient.createResponse({
      instructions: [
        "You revise a Korean technical learning draft.",
        "Return the full revised Markdown document only. Do not wrap it in code fences.",
        "Preserve confidentiality: do not add employer-confidential, customer-confidential, unreleased product, or proprietary details.",
        "Keep factual claims cautious unless supported by public sources.",
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
      changeSummary: "Revised by OpenAI Responses provider from Telegram instruction",
    };
  };
}
