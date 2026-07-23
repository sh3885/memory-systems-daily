import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assertDraftContent, DraftQualityError, validateDraftContent } from "../content/draft-quality.mjs";

describe("draft quality checks", () => {
  test("accepts a markdown draft with heading and claim ledger", () => {
    const result = validateDraftContent([
      "# LLM memory traffic",
      "",
      "Decode reads model weights and KV cache.",
      "",
      "## Claim ledger",
      "",
      "claim | source candidate | fact/interpretation/speculation | confidence",
      "KV cache is reused | paper | fact | high",
    ].join("\n"));

    assert.equal(result.ok, true);
  });

  test("rejects likely mojibake and missing claim ledger before saving", () => {
    assert.throws(
      () => assertDraftContent("# ?ㅼ쓬 token ?덉륫\n\n본문"),
      (error) => error instanceof DraftQualityError &&
        error.code === "DRAFT_QUALITY_FAILED" &&
        error.details.errors.includes("LIKELY_MOJIBAKE") &&
        error.details.errors.includes("MISSING_CLAIM_LEDGER"),
    );
  });

  test("rejects invalid frontmatter category", () => {
    const result = validateDraftContent([
      "---",
      "title: Draft",
      "category: Storage",
      "---",
      "# Draft",
      "",
      "## Claim ledger",
      "claim | source candidate | fact/interpretation/speculation | confidence",
    ].join("\n"));

    assert.equal(result.ok, false);
    assert.equal(result.errors.includes("INVALID_CATEGORY"), true);
  });
});
