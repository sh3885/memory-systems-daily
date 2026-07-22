import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AnthropicProviderError } from "../llm/anthropic-messages-provider.mjs";
import { OpenAIProviderError } from "../llm/openai-responses-provider.mjs";
import {
  classifyProviderError,
  createProviderFallback,
  ProviderFallbackError,
} from "../llm/provider-fallback-router.mjs";

describe("provider fallback router", () => {
  test("classifies Anthropic and OpenAI fallback-worthy errors", () => {
    assert.equal(classifyProviderError(new AnthropicProviderError("ANTHROPIC_HTTP_ERROR", "x", {
      status: 429,
      type: "rate_limit_error",
    })), "rate_limit");
    assert.equal(classifyProviderError(new AnthropicProviderError("ANTHROPIC_HTTP_ERROR", "x", {
      status: 529,
      type: "overloaded_error",
    })), "overloaded");
    assert.equal(classifyProviderError(new AnthropicProviderError("ANTHROPIC_HTTP_ERROR", "x", {
      status: 413,
      type: "request_too_large",
    })), "context_length");
    assert.equal(classifyProviderError(new OpenAIProviderError("OPENAI_HTTP_ERROR", "x", {
      status: 429,
      body: { error: { code: "insufficient_quota" } },
    })), "quota");
  });

  test("falls back from Claude to OpenAI and records attempts", async () => {
    const calls = [];
    const router = createProviderFallback({
      providers: [
        {
          id: "anthropic",
          model: "claude-sonnet-5",
          fn: async () => {
            calls.push("anthropic");
            throw new AnthropicProviderError("ANTHROPIC_HTTP_ERROR", "rate limit", {
              status: 429,
              type: "rate_limit_error",
            });
          },
        },
        {
          id: "openai",
          model: "gpt-5.6",
          fn: async () => {
            calls.push("openai");
            return { answer: "OpenAI fallback answer" };
          },
        },
      ],
    });

    const result = await router({ question: "why?" });
    assert.deepEqual(calls, ["anthropic", "openai"]);
    assert.equal(result.answer, "OpenAI fallback answer");
    assert.equal(result.provider.id, "openai");
    assert.equal(result.provider.attempts[0].reason, "rate_limit");
  });

  test("does not fall back on fatal provider errors", async () => {
    const router = createProviderFallback({
      providers: [
        {
          id: "anthropic",
          fn: async () => {
            throw new AnthropicProviderError("INVALID_INPUT", "bad prompt");
          },
        },
        {
          id: "openai",
          fn: async () => ({ answer: "should not run" }),
        },
      ],
    });

    await assert.rejects(
      () => router({}),
      (error) => {
        assert.equal(error instanceof ProviderFallbackError, true);
        assert.equal(error.code, "ALL_PROVIDERS_FAILED");
        assert.equal(error.details.attempts.length, 1);
        assert.equal(error.details.attempts[0].reason, "fatal");
        return true;
      },
    );
  });
});
