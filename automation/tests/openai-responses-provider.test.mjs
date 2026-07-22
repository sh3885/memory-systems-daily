import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createOpenAIResponsesClient,
  createStudyAnswerProvider,
  createStudyRevisionProvider,
  OpenAIProviderError,
} from "../llm/openai-responses-provider.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenAI Responses provider", () => {
  test("calls the Responses API with model, reasoning, and web_search", async () => {
    const calls = [];
    const client = createOpenAIResponsesClient({
      apiKey: "sk-test",
      model: "gpt-5.6",
      fetchImpl: async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({ output_text: "안녕하세요" });
      },
    });

    const response = await client.createResponse({
      instructions: "Answer in Korean.",
      input: "LLM memory bottleneck?",
      metadata: { workflow: "test" },
    });

    assert.equal(response.outputText, "안녕하세요");
    assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
    assert.equal(calls[0].init.headers.authorization, "Bearer sk-test");
    assert.deepEqual(calls[0].body.tools, [{ type: "web_search" }]);
    assert.deepEqual(calls[0].body.reasoning, { effort: "low" });
    assert.equal(calls[0].body.model, "gpt-5.6");
  });

  test("extracts message content when output_text is absent", async () => {
    const client = createOpenAIResponsesClient({
      apiKey: "sk-test",
      fetchImpl: async () => jsonResponse({
        output: [{ content: [{ text: "첫 줄" }, { text: "둘째 줄" }] }],
      }),
    });
    const response = await client.createResponse({ instructions: "x", input: "y", webSearch: false });
    assert.equal(response.outputText, "첫 줄\n둘째 줄");
  });

  test("surfaces OpenAI HTTP and empty-response errors", async () => {
    const httpClient = createOpenAIResponsesClient({
      apiKey: "sk-test",
      fetchImpl: async () => jsonResponse({ error: { message: "bad" } }, 429),
    });
    await assert.rejects(
      () => httpClient.createResponse({ instructions: "x", input: "y" }),
      (error) => error instanceof OpenAIProviderError && error.code === "OPENAI_HTTP_ERROR",
    );

    const emptyClient = createOpenAIResponsesClient({
      apiKey: "sk-test",
      fetchImpl: async () => jsonResponse({ output: [] }),
    });
    await assert.rejects(
      () => emptyClient.createResponse({ instructions: "x", input: "y" }),
      (error) => error instanceof OpenAIProviderError && error.code === "EMPTY_RESPONSE",
    );
  });

  test("builds study Q&A and revision providers", async () => {
    const requests = [];
    const responsesClient = {
      createResponse: async (request) => {
        requests.push(request);
        return { outputText: requests.length === 1 ? "Q&A 답변" : "# revised" };
      },
    };
    const answerProvider = createStudyAnswerProvider({ responsesClient });
    const revisionProvider = createStudyRevisionProvider({ responsesClient });

    assert.deepEqual(
      await answerProvider({
        question: "KV cache가 뭐야?",
        lessonDate: "2026-07-22",
        lesson: { curriculumRef: "M07-W18-D1", state: "draft_ready" },
        revision: { revisionNumber: 1, content: "# draft" },
      }),
      { answer: "Q&A 답변" },
    );
    assert.equal(requests[0].metadata.workflow, "telegram_qna");
    assert.match(requests[0].input, /KV cache/);

    const revision = await revisionProvider({
      instruction: "메모리 대역폭 설명 추가",
      currentContent: "# draft",
      lesson: { curriculumRef: "M07-W18-D1" },
    });
    assert.equal(revision.content, "# revised");
    assert.match(revision.changeSummary, /OpenAI Responses/);
    assert.equal(requests[1].metadata.workflow, "telegram_revision");
  });
});
