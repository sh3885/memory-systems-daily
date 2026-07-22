import { sha256Hex } from "../domain/lesson-state.mjs";

export const PRIMARY_SOURCE_TYPES = Object.freeze([
  "standard",
  "vendor_documentation",
  "official_documentation",
  "official_repository",
  "paper",
  "dataset",
]);

export const CONFIDENCE_LEVELS = Object.freeze(["high", "medium", "low"]);
export const VERIFICATION_STATUSES = Object.freeze(["verified", "needs_review", "conflicting"]);

export class ClaimLedgerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ClaimLedgerError";
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new ClaimLedgerError("INVALID_CLAIM", `${field} is required`, { field });
  return normalized;
}

function normalizeUrl(value, field) {
  const raw = requireText(value, field);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ClaimLedgerError("INVALID_CLAIM", `${field} must be an absolute URL`, { field, value: raw });
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new ClaimLedgerError("INVALID_CLAIM", `${field} must use http or https`, { field, value: raw });
  }
  return parsed.toString();
}

function normalizeTimestamp(value, field) {
  const raw = requireText(value, field);
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) {
    throw new ClaimLedgerError("INVALID_CLAIM", `${field} must be a valid timestamp`, { field, value: raw });
  }
  return new Date(milliseconds).toISOString();
}

function requireKnown(value, field, allowed) {
  const normalized = requireText(value, field);
  if (!allowed.includes(normalized)) {
    throw new ClaimLedgerError("INVALID_CLAIM", `${field} is not allowed`, { field, value: normalized, allowed });
  }
  return normalized;
}

export function normalizeClaims(claims, options = {}) {
  if (!Array.isArray(claims) || claims.length === 0) {
    throw new ClaimLedgerError("NO_CLAIMS", "At least one claim backed by a primary source is required");
  }

  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const seen = new Set();
  return claims.map((claim, index) => {
    const claimKey = requireText(claim.claimKey ?? claim.id ?? `claim-${index + 1}`, `claims[${index}].claimKey`);
    if (seen.has(claimKey)) {
      throw new ClaimLedgerError("DUPLICATE_CLAIM", "Claim keys must be unique within a revision", { claimKey });
    }
    seen.add(claimKey);

    return {
      claimKey,
      statement: requireText(claim.statement, `claims[${index}].statement`),
      sourceUrl: normalizeUrl(claim.sourceUrl, `claims[${index}].sourceUrl`),
      sourceTitle: String(claim.sourceTitle ?? "").trim() || null,
      sourceType: requireKnown(claim.sourceType, `claims[${index}].sourceType`, PRIMARY_SOURCE_TYPES),
      evidenceLocator: requireText(claim.evidenceLocator, `claims[${index}].evidenceLocator`),
      confidence: requireKnown(claim.confidence ?? "medium", `claims[${index}].confidence`, CONFIDENCE_LEVELS),
      verificationStatus: requireKnown(
        claim.verificationStatus ?? "verified",
        `claims[${index}].verificationStatus`,
        VERIFICATION_STATUSES,
      ),
      checkedAt: normalizeTimestamp(claim.checkedAt ?? checkedAt, `claims[${index}].checkedAt`),
    };
  });
}

export function canonicalClaimsJson(claims) {
  const ordered = [...claims].sort((left, right) => left.claimKey.localeCompare(right.claimKey));
  return JSON.stringify(ordered);
}

export async function claimsHash(claims) {
  return sha256Hex(canonicalClaimsJson(claims));
}
