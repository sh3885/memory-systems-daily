import { publicationPath, publicationPermalink, renderAstroMarkdownPost, taxonomyForPost } from "./astro-post.mjs";

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

function titleFromRenderedPost(content) {
  const match = String(content ?? "").match(/\ntitle:\s*"((?:\\"|[^"])*)"/);
  if (!match) return "";
  return match[1].replace(/\\"/g, '"');
}

function pathFromPermalink(permalink) {
  if (!permalink) return "";
  try {
    return new URL(permalink).pathname;
  } catch {
    return "";
  }
}

function categoryUrl({ publicSiteUrl, category }) {
  const base = String(publicSiteUrl ?? "").trim().replace(/\/+$/g, "");
  if (!base || !category) return "";
  return `${base}/${String(category).toLowerCase()}/`;
}

async function requireDeploymentVerification({ deploymentVerifier, verification }) {
  if (!deploymentVerifier) {
    throw new PublicationServiceError(
      "DEPLOYMENT_VERIFIER_REQUIRED",
      "Publishing requires production URL verification before recording success",
      { deploymentUrl: verification.postUrl },
    );
  }
  return deploymentVerifier(verification);
}

export function createPublicationService({
  store,
  publisher,
  contentDirectory = "src/pages/posts",
  publicSiteUrl = "",
  deploymentVerifier = null,
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
      const taxonomy = taxonomyForPost({ lesson, content: revision.content });
      const publicPath = pathFromPermalink(permalink);

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
        const deployment = await requireDeploymentVerification({
          deploymentVerifier,
          verification: {
            postUrl: permalink,
            homeUrl: String(publicSiteUrl ?? "").trim().replace(/\/+$/g, "") || null,
            categoryUrl: categoryUrl({ publicSiteUrl, category: taxonomy.category }),
            title: titleFromRenderedPost(content),
            path: publicPath,
            extraMarkers: [],
            publication: result,
          },
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
          deploymentUrl: deployment?.postUrl ?? permalink ?? result.pullRequestUrl,
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
