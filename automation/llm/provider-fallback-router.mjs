import { AnthropicProviderError } from "./anthropic-messages-provider.mjs";
import { OpenAIProviderError } from "./openai-responses-provider.mjs";

export class ProviderFallbackError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProviderFallbackError";
    this.code = code;
    this.details = details;
  }
}

export const DEFAULT_FALLBACK_REASONS = Object.freeze([
  "rate_limit",
  "quota",
  "overloaded",
  "timeout",
  "context_length",
  "transient",
]);

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new ProviderFallbackError("INVALID_INPUT", `${field} is required`, { field });
  return normalized;
}

function normalizeProvider(provider, index) {
  if (!provider || typeof provider.fn !== "function") {
    throw new ProviderFallbackError("INVALID_INPUT", "provider.fn is required", { index });
  }
  return {
    id: requireText(provider.id ?? `provider-${index + 1}`, `providers[${index}].id`),
    model: String(provider.model ?? "").trim() || null,
    fn: provider.fn,
  };
}

export function classifyProviderError(error) {
  const status = error?.details?.status;
  const type = String(error?.details?.type ?? error?.details?.body?.error?.type ?? "");
  const code = String(error?.details?.body?.error?.code ?? error?.code ?? "");
  const message = String(error?.message ?? "");

  if (error instanceof AnthropicProviderError) {
    if (status === 429 || type === "rate_limit_error") return "rate_limit";
    if (status === 529 || type === "overloaded_error") return "overloaded";
    if (status === 504 || type === "timeout_error") return "timeout";
    if (status === 413 || type === "request_too_large") return "context_length";
    if (status >= 500) return "transient";
  }

  if (error instanceof OpenAIProviderError) {
    if (code === "insufficient_quota" || type === "insufficient_quota") return "quota";
    if (status === 429 && /quota|billing|credits|monthly spend/i.test(message)) return "quota";
    if (status === 429) return "rate_limit";
    if (status === 413 || /context|maximum context|too large/i.test(message)) return "context_length";
    if (status === 408 || status === 504) return "timeout";
    if (status >= 500) return "transient";
  }

  return "fatal";
}

export function createProviderFallback({ providers, fallbackOn = DEFAULT_FALLBACK_REASONS } = {}) {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new ProviderFallbackError("INVALID_INPUT", "At least one provider is required");
  }
  const chain = providers.map(normalizeProvider);
  const allowed = new Set(fallbackOn);

  return async function runWithFallback(input) {
    const attempts = [];
    for (const provider of chain) {
      try {
        const result = await provider.fn(input);
        return {
          ...result,
          provider: {
            id: provider.id,
            model: provider.model,
            attempts,
          },
        };
      } catch (error) {
        const reason = classifyProviderError(error);
        attempts.push({
          providerId: provider.id,
          model: provider.model,
          reason,
          code: error?.code ?? error?.name ?? "ERROR",
          status: error?.details?.status ?? null,
        });
        if (!allowed.has(reason) || provider === chain.at(-1)) {
          throw new ProviderFallbackError("ALL_PROVIDERS_FAILED", "No configured AI provider completed the request", {
            attempts,
            cause: error?.message ?? String(error),
          });
        }
      }
    }
    throw new ProviderFallbackError("ALL_PROVIDERS_FAILED", "No configured AI provider completed the request", {
      attempts,
    });
  };
}
