export const DAILY_CRON = "30 23 * * *";
export const DEFAULT_TIME_ZONE = "Asia/Seoul";

export class SchedulerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SchedulerError";
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new SchedulerError("INVALID_INPUT", `${field} is required`, { field });
  return normalized;
}

export function dateInTimeZone(instant, timeZone = DEFAULT_TIME_ZONE) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) {
    throw new SchedulerError("INVALID_TIMESTAMP", "The scheduler instant must be a valid timestamp", { instant });
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function createDailyLessonScheduler({
  store,
  curriculumRefForDate,
  now = () => new Date().toISOString(),
  timeZone = DEFAULT_TIME_ZONE,
} = {}) {
  if (!store?.createLesson) throw new SchedulerError("MISCONFIGURED", "A lesson store is required");
  if (typeof curriculumRefForDate !== "function") {
    throw new SchedulerError("MISCONFIGURED", "curriculumRefForDate is required");
  }

  return async function runDailyLesson(scheduledAt = now()) {
    const instant = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
    const lessonDate = dateInTimeZone(instant, timeZone);
    const curriculumRef = requireText(await curriculumRefForDate({ lessonDate, instant }), "curriculumRef");
    const lesson = await store.createLesson({ lessonDate, curriculumRef });
    return { lessonDate, curriculumRef, lesson };
  };
}

export function createCloudflareScheduledHandler({
  store,
  curriculumRefForDate,
  now,
  timeZone,
  expectedCron = DAILY_CRON,
} = {}) {
  const runDailyLesson = createDailyLessonScheduler({ store, curriculumRefForDate, now, timeZone });
  return async function handleScheduled(controller) {
    if (controller?.cron && controller.cron !== expectedCron) {
      throw new SchedulerError("UNEXPECTED_CRON", `Unexpected cron expression: ${controller.cron}`, {
        expectedCron,
      });
    }
    return runDailyLesson(controller?.scheduledTime ?? now?.() ?? new Date().toISOString());
  };
}

