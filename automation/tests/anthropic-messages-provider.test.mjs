import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AnthropicProviderError,
  createAnthropicMessagesClient,
  createClaudeAnswerProvider,
  createClaudeRevisionProvider,
} from "../llm/anthropic-messages-provider.mjs";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Anthropic Messages provider", () => {
  test("calls the Messages API and extracts text content", async () => {
    const calls = [];
    const client = createAnthropicMessagesClient({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-5",
      fetchImpl: async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return jsonResponse({
          content: [{ type: "text", text: "Claude answer" }],
          model: "claude-sonnet-5",
        });
      },
    });

    const response = await client.createMessage({
      system: "Answer in Korean.",
      input: "KV cache?",
      metadata: { workflow: "test" },
    });

    assert.equal(response.outputText, "Claude answer");
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(calls[0].init.headers["x-api-key"], "sk-ant-test");
    assert.equal(calls[0].init.headers["anthropic-version"], "2023-06-01");
    assert.deepEqual(calls[0].body.messages, [{ role: "user", content: "KV cache?" }]);
    assert.equal(calls[0].body.max_tokens, 2048);
  });

  test("surfaces rate-limit details and retry-after", async () => {
    const client = createAnthropicMessagesClient({
      apiKey: "sk-ant-test",
      fetchImpl: async () => jsonResponse(
        { error: { type: "rate_limit_error", message: "rate limit" } },
        429,
        { "retry-after": "2" },
      ),
    });

    await assert.rejects(
      () => client.createMessage({ system: "x", input: "y" }),
      (error) => {
        assert.equal(error instanceof AnthropicProviderError, true);
        assert.equal(error.code, "ANTHROPIC_HTTP_ERROR");
        assert.equal(error.details.status, 429);
        assert.equal(error.details.type, "rate_limit_error");
        assert.equal(error.details.retryAfter, "2");
        return true;
      },
    );
  });

  test("builds Claude Q&A and revision providers", async () => {
    const requests = [];
    const messagesClient = {
      createMessage: async (request) => {
        requests.push(request);
        return { outputText: requests.length === 1 ? "설명 답변" : "# revised" };
      },
    };
    const answerProvider = createClaudeAnswerProvider({ messagesClient });
    const revisionProvider = createClaudeRevisionProvider({ messagesClient });

    const answer = await answerProvider({
        question: "KV cache가 뭐야?",
        lessonDate: "2026-07-22",
        lesson: { curriculumRef: "M07-W18-D1", state: "draft_ready" },
        revision: { revisionNumber: 1, content: "# draft" },
      });
    assert.equal(answer.answer, "설명 답변");
    assert.equal(answer.provider.id, "anthropic");
    assert.equal(requests[0].metadata.workflow, "telegram_qna");

    const revision = await revisionProvider({
      instruction: "대역폭 관점 추가",
      currentContent: "# draft",
      lesson: { curriculumRef: "M07-W18-D1" },
    });
    assert.equal(revision.content, "# revised");
    assert.match(revision.changeSummary, /Claude Messages/);
    assert.equal(revision.provider.id, "anthropic");
    assert.equal(requests[1].metadata.workflow, "telegram_revision");
  });
});
