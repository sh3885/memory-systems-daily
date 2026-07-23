export class DraftQualityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DraftQualityError";
    this.code = code;
    this.details = details;
  }
}

const allowedCategories = new Set(["LLM", "Memory", "System", "llm", "memory", "system"]);

function lines(content) {
  return String(content ?? "").replace(/\r\n?/g, "\n").split("\n");
}

function hasHeading(content) {
  return lines(content).some((line) => /^#\s+\S/.test(line));
}

function hasClaimLedger(content) {
  return /(^|\n)#{2,3}\s*claim ledger\b/i.test(content) || /\bclaim\s*\|\s*source/i.test(content);
}

function hasLikelyMojibake(content) {
  const text = String(content ?? "");
  return text.includes("\uFFFD") ||
    /[?][ㄱ-ㅎㅏ-ㅣ가-힣]/u.test(text) ||
    /(?:Ã|Â|媛|꾩|ㅼ|쒕|뱀|섏|댁|덉|대떎|�)/u.test(text);
}

function frontmatter(content) {
  const text = String(content ?? "").replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return null;
  return text.slice(4, end);
}

function frontmatterValue(block, key) {
  const match = String(block ?? "").match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?\\s*$`, "im"));
  return match?.[1]?.trim() ?? "";
}

export function validateDraftContent(content, { requireClaimLedger = true } = {}) {
  const text = String(content ?? "").trim();
  const errors = [];
  const warnings = [];
  if (!text) errors.push("EMPTY_DRAFT");
  if (!hasHeading(text)) errors.push("MISSING_H1");
  if (requireClaimLedger && !hasClaimLedger(text)) errors.push("MISSING_CLAIM_LEDGER");
  if (hasLikelyMojibake(text)) errors.push("LIKELY_MOJIBAKE");

  const block = frontmatter(text);
  if (block) {
    const category = frontmatterValue(block, "category");
    if (category && !allowedCategories.has(category)) errors.push("INVALID_CATEGORY");
    if (!frontmatterValue(block, "title")) warnings.push("FRONTMATTER_MISSING_TITLE");
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function assertDraftContent(content, options = {}) {
  const result = validateDraftContent(content, options);
  if (!result.ok) {
    throw new DraftQualityError("DRAFT_QUALITY_FAILED", "Draft content failed quality checks", result);
  }
  return result;
}
