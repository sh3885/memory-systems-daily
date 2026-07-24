import { createCloudflareScheduledHandler } from "../scheduler/daily-lesson-scheduler.mjs";
import { nextCurriculumRef } from "../content/daily-lesson-prompts.mjs";
import { createBlogApi } from "../blog/blog-api.mjs";
import { D1BlogStore } from "../blog/blog-store.mjs";
import { D1LessonStore } from "../storage/d1-lesson-store.mjs";
import {
  createAnthropicMessagesClient,
  createClaudeAnswerProvider,
} from "../llm/anthropic-messages-provider.mjs";
import { createGitHubAppPublisher } from "../publishing/github-app-publisher.mjs";
import { createGitHubContentWriter } from "../publishing/github-content-writer.mjs";
import { createHttpDeploymentVerifier } from "../publishing/deployment-verifier.mjs";
import { createPublicationService } from "../publishing/publication-service.mjs";
import { createApprovalPromptService, createLessonCommandRouter } from "./lesson-command-router.mjs";
import { createTelegramClient } from "./telegram-client.mjs";
import { createTelegramWebhook } from "./telegram-webhook.mjs";

function configured(value) {
  return String(value ?? "").trim();
}

function githubPublishingConfigured(env) {
  return [
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    env.GITHUB_INSTALLATION_ID,
    env.GITHUB_OWNER,
    env.GITHUB_REPOSITORY,
    env.GITHUB_CONTENT_BRANCH,
    env.GITHUB_CONTENT_DIRECTORY,
  ].every(configured);
}

function createRuntime(env) {
  const store = new D1LessonStore(env.DB);
  const blogStore = new D1BlogStore(env.DB);
  const telegram = createTelegramClient({ botToken: env.TELEGRAM_BOT_TOKEN });
  const anthropicClient = configured(env.ANTHROPIC_API_KEY)
    ? createAnthropicMessagesClient({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.ANTHROPIC_MODEL || "claude-sonnet-5",
      })
    : null;
  const publicationService = githubPublishingConfigured(env)
    ? createPublicationService({
        store,
        publisher: createGitHubAppPublisher({
          appId: env.GITHUB_APP_ID,
          privateKey: env.GITHUB_APP_PRIVATE_KEY,
          installationId: env.GITHUB_INSTALLATION_ID,
          owner: env.GITHUB_OWNER,
          repo: env.GITHUB_REPOSITORY,
          branch: env.GITHUB_CONTENT_BRANCH,
        }),
        contentDirectory: env.GITHUB_CONTENT_DIRECTORY,
        publicSiteUrl: env.PUBLIC_SITE_URL,
        deploymentVerifier: createHttpDeploymentVerifier({
          attempts: Number(env.DEPLOYMENT_VERIFY_ATTEMPTS || 24),
          delayMs: Number(env.DEPLOYMENT_VERIFY_DELAY_MS || 7500),
          fetchTimeoutMs: Number(env.DEPLOYMENT_FETCH_TIMEOUT_MS || 8000),
        }),
      })
    : null;

  const routerOptions = {
    store,
    telegram,
    approvalPrompt: createApprovalPromptService({ store }),
    aiMode: env.AI_MODE || "manual",
    publicationRetry: publicationService
      ? async ({ lesson }) => {
          const approval = await store.getActiveApprovalForLesson(lesson.id);
          if (!approval) throw new Error("No active approval is available for publish retry.");
          return publicationService.publishApprovedRevision({ approval });
        }
      : null,
  };
  if (anthropicClient) {
    routerOptions.answerProvider = createClaudeAnswerProvider({ messagesClient: anthropicClient });
  }

  const router = createLessonCommandRouter(routerOptions);
  const adminWriter = githubPublishingConfigured(env)
    ? createGitHubContentWriter({
        appId: env.GITHUB_APP_ID,
        privateKey: env.GITHUB_APP_PRIVATE_KEY,
        installationId: env.GITHUB_INSTALLATION_ID,
        owner: env.GITHUB_OWNER,
        repo: env.GITHUB_REPOSITORY,
        branch: env.GITHUB_ADMIN_BRANCH || "main",
      })
    : null;
  const blogApi = createBlogApi({
    env,
    store: blogStore,
    publisher: adminWriter
      ? {
          async publishPost(input) {
            const result = await adminWriter.putFile({
              path: input.path,
              content: input.content,
              message: input.message,
              branch: env.GITHUB_ADMIN_BRANCH || "main",
            });
            return { ...result, pullRequestUrl: null };
          },
        }
      : null,
  });

  return { store, telegram, router, publicationService, blogApi };
}

function dailyLessonMessage({ lessonDate, curriculumRef, lesson }) {
  return [
    `Good morning. ${lessonDate} daily study session is ready.`,
    `Curriculum: ${curriculumRef}`,
    `State: ${lesson.state}`,
    "Draft mode: use /prompt, paste into Claude web, then save the result with /draft.",
  ].join("\n");
}

async function notifyApprovalRecorded({ telegram, actor, approval }) {
  await telegram.sendMessage({
    chatId: actor.chatId,
    text: `Approval recorded: ${approval.id}\nGitHub publishing is not configured yet.`,
  });
  return { action: "approval_recorded", notified: true };
}

async function publishAndNotify({ publicationService, telegram, actor, approval }) {
  try {
    const publication = await publicationService.publishApprovedRevision({ approval });
    await telegram.sendMessage({
      chatId: actor.chatId,
      text: [
        "Published through GitHub.",
        `publication=${publication.id}`,
        `file=${publication.filePath}`,
        publication.pullRequestUrl ? `PR=${publication.pullRequestUrl}` : null,
        publication.deploymentUrl ? `URL=${publication.deploymentUrl}` : null,
      ].filter(Boolean).join("\n"),
    });
    return { action: "publication_published", publicationId: publication.id };
  } catch (error) {
    await telegram.sendMessage({
      chatId: actor.chatId,
      text: [
        "Approval was recorded, but publishing failed.",
        `approval=${approval.id}`,
        `error=${error?.message ?? String(error)}`,
        "Fix the cause, then run /publish-retry.",
      ].join("\n"),
    });
    return { action: "publication_failed", error: error?.message ?? String(error) };
  }
}

export default {
  async fetch(request, env) {
    const { store, telegram, router, publicationService, blogApi } = createRuntime(env);
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) return blogApi(request);
    const handler = createTelegramWebhook({
      env,
      store,
      onMessage: router.onMessage,
      onCallback: router.onCallback,
      resolveApprovalCallback: async ({ callback }) => ({ nonce: callback.token }),
      onApprovalRecorded: async ({ update, actor, approval }) => {
        if (update.callback_query?.id) {
          await telegram.answerCallbackQuery({
            callbackQueryId: update.callback_query.id,
            text: "Approval recorded",
          });
        }
        if (!publicationService) return notifyApprovalRecorded({ telegram, actor, approval });
        return publishAndNotify({ publicationService, telegram, actor, approval });
      },
      onApprovalRejected: async ({ update, error }) => {
        if (update.callback_query?.id) {
          await telegram.answerCallbackQuery({
            callbackQueryId: update.callback_query.id,
            text: `Approval failed: ${error.code ?? "ERROR"}`,
            showAlert: true,
          });
        } else if (update.message?.chat?.id) {
          await telegram.sendMessage({
            chatId: update.message.chat.id,
            text: `처리 중 오류가 났어. 상태를 확인하려면 /status를 보내줘. error=${error.code ?? "ERROR"}`,
          });
        }
      },
    });
    return handler(request);
  },

  async scheduled(controller, env) {
    const { store, telegram } = createRuntime(env);
    const handler = createCloudflareScheduledHandler({
      store,
      curriculumRefForDate: async () => {
        const latestPublished = await store.getLatestPublishedLesson?.();
        return nextCurriculumRef(latestPublished?.curriculumRef) ?? env.DAILY_CURRICULUM_REF;
      },
    });
    const result = await handler(controller);
    await telegram.sendMessage({
      chatId: env.TELEGRAM_ALLOWED_CHAT_ID,
      text: dailyLessonMessage(result),
    });
    return result;
  },
};
