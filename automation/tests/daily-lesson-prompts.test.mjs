import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildDailyLessonPromptContext,
  findDailyLesson,
} from "../content/daily-lesson-prompts.mjs";

describe("daily lesson prompts", () => {
  test("starts with a beginner LLM lesson without forcing a memory calculation", () => {
    const lesson = findDailyLesson("M01-W01-D1");
    const context = buildDailyLessonPromptContext({ curriculumRef: "M01-W01-D1" });

    assert.equal(lesson?.title, "LLM은 무엇이고 왜 필요한가");
    assert.equal(lesson?.theme, "LLM");
    assert.equal(lesson?.postType, "Foundation Explainer");
    assert.match(context.text, /다이어그램을 그리기 좋은 경우/);
    assert.match(context.text, /이 산출물이 없으면 독자가 이해하지 못하는 것은 무엇인가/);
    assert.match(context.text, /주제 축\(category\): LLM/);
    assert.doesNotMatch(context.text, /필수 산출물/);
  });

  test("keeps unknown lessons usable with adaptive guidance", () => {
    const context = buildDailyLessonPromptContext({ curriculumRef: "M09-W26-D1" });

    assert.equal(context.lesson, null);
    assert.match(context.text, /상세 lesson은 아직 자동 프롬프트 목록에 없다/);
    assert.match(context.text, /자주 나올 질문과 답변/);
  });
});
