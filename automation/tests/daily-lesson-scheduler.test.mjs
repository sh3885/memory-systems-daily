import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DAILY_CRON,
  SchedulerError,
  createCloudflareScheduledHandler,
  createDailyLessonScheduler,
  dateInTimeZone,
} from "../scheduler/daily-lesson-scheduler.mjs";

describe("daily lesson scheduler", () => {
  test("maps UTC cron instants to the correct Asia/Seoul calendar date", () => {
    assert.equal(dateInTimeZone("2026-07-22T14:29:00.000Z"), "2026-07-22");
    assert.equal(dateInTimeZone("2026-07-22T23:30:00.000Z"), "2026-07-23");
    assert.equal(dateInTimeZone("2026-12-31T23:30:00.000Z"), "2027-01-01");
  });

  test("creates one idempotent lesson for repeated scheduler delivery", async () => {
    const calls = [];
    const lessons = new Map();
    const store = {
      async createLesson(input) {
        calls.push(input);
        if (!lessons.has(input.lessonDate)) lessons.set(input.lessonDate, { id: "lesson_1", ...input });
        return lessons.get(input.lessonDate);
      },
    };
    const run = createDailyLessonScheduler({
      store,
      curriculumRefForDate: async ({ lessonDate }) => lessonDate < "2026-07-24" ? "M01-W01" : "M01-W02",
    });
    const first = await run("2026-07-22T23:30:00.000Z");
    const retry = await run("2026-07-22T23:30:00.000Z");
    assert.deepEqual(first, retry);
    assert.deepEqual(calls, [
      { lessonDate: "2026-07-23", curriculumRef: "M01-W01" },
      { lessonDate: "2026-07-23", curriculumRef: "M01-W01" },
    ]);
  });

  test("fails closed when curriculum selection is missing or invalid", async () => {
    assert.throws(
      () => createDailyLessonScheduler({ store: { createLesson() {} } }),
      (error) => error instanceof SchedulerError && error.code === "MISCONFIGURED",
    );
    const run = createDailyLessonScheduler({
      store: { async createLesson() { throw new Error("should not be called"); } },
      curriculumRefForDate: async () => "",
    });
    await assert.rejects(
      () => run("2026-07-22T23:30:00.000Z"),
      (error) => error instanceof SchedulerError && error.code === "INVALID_INPUT",
    );
  });

  test("validates the Cloudflare cron expression", async () => {
    const store = { async createLesson(input) { return input; } };
    const handle = createCloudflareScheduledHandler({
      store,
      curriculumRefForDate: async () => "M01-W01",
    });
    const result = await handle({ cron: DAILY_CRON, scheduledTime: "2026-07-22T23:30:00.000Z" });
    assert.deepEqual(result, { lessonDate: "2026-07-23", curriculumRef: "M01-W01", lesson: { lessonDate: "2026-07-23", curriculumRef: "M01-W01" } });
    await assert.rejects(
      () => handle({ cron: "0 * * * *", scheduledTime: "2026-07-22T23:30:00.000Z" }),
      (error) => error instanceof SchedulerError && error.code === "UNEXPECTED_CRON",
    );
  });
});

