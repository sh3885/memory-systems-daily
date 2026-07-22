export const LESSON_STATES = Object.freeze([
  "scheduled",
  "researching",
  "draft_ready",
  "discussing",
  "review_ready",
  "approved",
  "publishing",
  "published",
  "research_failed",
  "publish_failed",
]);

const transitions = new Map([
  ["scheduled", new Set(["researching"])],
  ["researching", new Set(["draft_ready", "research_failed"])],
  ["research_failed", new Set(["researching"])],
  ["draft_ready", new Set(["discussing", "review_ready"])],
  ["discussing", new Set(["review_ready"])],
  ["review_ready", new Set(["discussing", "approved"])],
  ["approved", new Set(["discussing", "publishing"])],
  ["publishing", new Set(["published", "publish_failed"])],
  ["publish_failed", new Set(["discussing", "publishing"])],
  ["published", new Set()],
]);

export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export function isLessonState(value) {
  return LESSON_STATES.includes(value);
}

export function canTransition(from, to) {
  return transitions.get(from)?.has(to) ?? false;
}

export function assertTransition(from, to) {
  if (!isLessonState(from) || !isLessonState(to)) {
    throw new DomainError("UNKNOWN_STATE", `Unknown lesson state: ${from} -> ${to}`, { from, to });
  }

  if (!canTransition(from, to)) {
    throw new DomainError("ILLEGAL_TRANSITION", `Illegal lesson transition: ${from} -> ${to}`, { from, to });
  }
}

export function canonicalizeContent(content) {
  if (typeof content !== "string") {
    throw new DomainError("INVALID_CONTENT", "Content must be a string");
  }
  return content.normalize("NFC").replace(/\r\n?/g, "\n");
}

export async function sha256Hex(content) {
  const bytes = new TextEncoder().encode(canonicalizeContent(content));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
