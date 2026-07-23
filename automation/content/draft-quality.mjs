export class DraftQualityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DraftQualityError";
    this.code = code;
    this.details = details;
  }
}

function lines(content) {
  return String(content ?? "").replace(/\r\n?/g, "\n").split("\n");
}

function hasHeading(content) {
  return lines(content).some((line) => /^#\s+\S/.test(line));
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

function hasRawDiagramOrHtml(content) {
  return /<\/?(?:svg|text|path|rect|circle|g|defs|marker)\b/i.test(content) || /```(?:svg|html|xml|mermaid)\b/i.test(content);
}

export function validateDraftContent(content) {
  const text = String(content ?? "").trim();
  const errors = [];
  const warnings = [];
  if (!text) errors.push("EMPTY_DRAFT");
  if (!hasHeading(text)) errors.push("MISSING_H1");
  if (hasLikelyMojibake(text)) errors.push("LIKELY_MOJIBAKE");
  if (frontmatter(text)) errors.push("FRONTMATTER_NOT_ALLOWED");
  if (hasRawDiagramOrHtml(text)) errors.push("RAW_DIAGRAM_OR_HTML_NOT_ALLOWED");

  return { ok: errors.length === 0, errors, warnings };
}

export function assertDraftContent(content, options = {}) {
  const result = validateDraftContent(content, options);
  if (!result.ok) {
    throw new DraftQualityError("DRAFT_QUALITY_FAILED", "Draft content failed quality checks", result);
  }
  return result;
}
