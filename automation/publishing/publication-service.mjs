import { publicationPath, publicationPermalink, renderAstroMarkdownPost } from "./astro-post.mjs";

export class PublicationServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PublicationServiceError";
    this.code = code;
    this.details = details;
  }
}

function required(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new PublicationServiceError("MISCONFIGURED", `${field} is required`, { field });
  return normalized;
}

export function createPublicationService({
  store,
  publisher,
  contentDirectory = "src/pages/posts",
  publicSiteUrl = "",
} = {}) {
  if (!store?.startPublishing || !store?.recordPublicationSuccess || !store?.recordPublicationFailure) {
    throw new PublicationServiceError("MISCONFIGURED", "publication-capable store is required");
  }
  if (!publisher?.publishPost) throw new PublicationServiceError("MISCONFIGURED", "publisher is required");

  return {
    async publishApprovedRevision({ approval }) {
      const approvalId = required(approval?.id, "approval.id");
      const successOperationKey = `publication:success:${approvalId}`;
      const existing = await store.findPublicationByOperationKey(successOperationKey);
      if (existing?.status === "published") return existing;

      const publishingLesson = await store.startPublishing({ lessonId: approval.lessonId, approvalId });
      const failureOperationKey = `publication:failure:${approvalId}:v${publishingLesson.stateVersion}`;
      const [lesson, revision] = await Promise.all([
        store.getLesson(approval.lessonId),
        store.getRevision(approval.revisionId),
      ]);
      const path = publicationPath({ lesson, revision, directory: contentDirectory });
      const content = renderAstroMarkdownPost({ lesson, revision });
      const permalink = publicationPermalink({ publicSiteUrl, lesson, revision });

      try {
        const result = await publisher.publishPost({
          path,
          content,
          message: `Publish ${lesson.lessonDate} ${lesson.curriculumRef}`,
          title: `Publish ${lesson.lessonDate} ${lesson.curriculumRef}`,
          body: [
            `Approved Telegram revision: ${approval.revisionId}`,
            `Lesson date: ${lesson.lessonDate}`,
            `Curriculum: ${lesson.curriculumRef}`,
            `Content hash: ${approval.contentHash}`,
          ].join("\n"),
        });
        return store.recordPublicationSuccess({
          lessonId: approval.lessonId,
          revisionId: approval.revisionId,
          approvalId,
          operationKey: successOperationKey,
          provider: result.provider,
          branch: result.branch,
          filePath: result.filePath,
          commitSha: result.commitSha,
          pullRequestUrl: result.pullRequestUrl,
          deploymentUrl: permalink ?? result.pullRequestUrl,
        });
      } catch (error) {
        const failure = await store.recordPublicationFailure({
          lessonId: approval.lessonId,
          revisionId: approval.revisionId,
          approvalId,
          operationKey: failureOperationKey,
          provider: "github",
          errorMessage: error?.message ?? String(error),
        });
        throw new PublicationServiceError("PUBLISH_FAILED", "Publishing failed and was recorded", {
          publication: failure,
          cause: error?.message ?? String(error),
        });
      }
    },
  };
}
