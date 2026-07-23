import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assertDraftContent, DraftQualityError, validateDraftContent } from "../content/draft-quality.mjs";

describe("draft quality checks", () => {
  test("accepts a reader-facing markdown draft with a heading", () => {
    const result = validateDraftContent([
      "# LLM memory traffic",
      "",
      "Decode reads model weights and KV cache.",
    ].join("\n"));

    assert.equal(result.ok, true);
  });

  test("rejects likely mojibake before saving", () => {
    assert.throws(
      () => assertDraftContent("# ?ㅼ쓬 token ?덉륫\n\n본문"),
      (error) => error instanceof DraftQualityError &&
        error.code === "DRAFT_QUALITY_FAILED" &&
        error.details.errors.includes("LIKELY_MOJIBAKE"),
    );
  });

  test("rejects frontmatter and raw SVG markup", () => {
    const result = validateDraftContent([
      "---",
      "title: Draft",
      "---",
      "# Draft",
      "",
      "<svg><text>diagram</text></svg>",
    ].join("\n"));

    assert.equal(result.ok, false);
    assert.equal(result.errors.includes("FRONTMATTER_NOT_ALLOWED"), true);
    assert.equal(result.errors.includes("RAW_DIAGRAM_OR_HTML_NOT_ALLOWED"), true);
  });
});
