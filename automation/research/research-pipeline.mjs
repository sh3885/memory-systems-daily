import { ClaimLedgerError, normalizeClaims } from "./claim-ledger.mjs";
import { StoreError } from "../storage/d1-lesson-store.mjs";

export class ResearchPipelineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ResearchPipelineError";
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new ResearchPipelineError("INVALID_INPUT", `${field} is required`, { field });
  return normalized;
}

function normalizeProviderResult(result, checkedAt) {
  if (!result || typeof result !== "object") {
    throw new ResearchPipelineError("INVALID_RESEARCH_RESULT", "Research provider must return an object");
  }
  const content = requireText(result.content, "content");
  const changeSummary = requireText(result.changeSummary ?? "Initial research draft", "changeSummary");
  const claims = normalizeClaims(result.claims, { checkedAt });
  return { content, changeSummary, claims };
}

async function transitionIfNeeded(store, lesson, target) {
  if (lesson.state === target) return lesson;
  return store.transitionLesson(lesson.id, target, lesson.stateVersion);
}

async function markResearchFailed(store, lessonId) {
  const current = await store.getLesson(lessonId);
  if (current.state === "researching") {
    return store.transitionLesson(current.id, "research_failed", current.stateVersion);
  }
  return current;
}

export function createResearchPipeline({ store, researchProvider, now = () => new Date().toISOString() }) {
  if (!store) throw new ResearchPipelineError("INVALID_INPUT", "store is required");
  if (typeof researchProvider !== "function") {
    throw new ResearchPipelineError("INVALID_INPUT", "researchProvider function is required");
  }

  return {
    async runLessonResearch({ lessonDate, curriculumRef, topic, operationKey, createdBy = "research-pipeline" }) {
      const date = requireText(lessonDate, "lessonDate");
      const curriculum = requireText(curriculumRef, "curriculumRef");
      const key = requireText(operationKey, "operationKey");
      const author = requireText(createdBy, "createdBy");
      const revisionOperationKey = `research:revision:${key}`;
      const claimOperationKey = `research:claims:${key}`;

      const existingRevision = await store.findRevisionByOperationKey(revisionOperationKey);
      if (existingRevision) {
        const existingLedger = await store.getClaimLedgerByRevision(existingRevision.id);
        return {
          lesson: await store.getLesson(existingRevision.lessonId),
          revision: existingRevision,
          ledger: existingLedger,
          replayed: true,
        };
      }

      let lesson = await store.createLesson({ lessonDate: date, curriculumRef: curriculum });
      if (lesson.state === "scheduled" || lesson.state === "research_failed") {
        lesson = await transitionIfNeeded(store, lesson, "researching");
      }
      if (lesson.state !== "researching") {
        throw new ResearchPipelineError("LESSON_NOT_RESEARCHABLE", "Lesson is not ready for research", {
          lessonId: lesson.id,
          state: lesson.state,
        });
      }

      try {
        const providerResult = await researchProvider({
          lesson,
          lessonDate: date,
          curriculumRef: curriculum,
          topic,
          checkedAt: now(),
        });
        const normalized = normalizeProviderResult(providerResult, now());
        const revision = await store.appendRevision({
          lessonId: lesson.id,
          content: normalized.content,
          createdBy: author,
          changeSummary: normalized.changeSummary,
          operationKey: revisionOperationKey,
        });
        const ledger = await store.recordClaimLedger({
          revisionId: revision.id,
          claims: normalized.claims,
          createdBy: author,
          operationKey: claimOperationKey,
        });
        const latest = await store.getLesson(lesson.id);
        const ready = latest.state === "researching"
          ? await store.transitionLesson(lesson.id, "draft_ready", latest.stateVersion)
          : latest;
        return { lesson: ready, revision, ledger, replayed: false };
      } catch (error) {
        if (error instanceof StoreError && error.code === "OPERATION_KEY_CONFLICT") throw error;
        if (error instanceof ClaimLedgerError || error instanceof ResearchPipelineError || !(error instanceof StoreError)) {
          await markResearchFailed(store, lesson.id);
        }
        throw error;
      }
    },
  };
}
