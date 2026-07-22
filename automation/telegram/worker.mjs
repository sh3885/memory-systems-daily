import { D1LessonStore } from "../storage/d1-lesson-store.mjs";
import { createCloudflareScheduledHandler } from "../scheduler/daily-lesson-scheduler.mjs";
import {
  createAnthropicMessagesClient,
  createClaudeAnswerProvider,
  createClaudeRevisionProvider,
} from "../llm/anthropic-messages-provider.mjs";
import { createApprovalPromptService, createLessonCommandRouter } from "./lesson-command-router.mjs";
import { createTelegramClient } from "./telegram-client.mjs";
import { createTelegramWebhook } from "./telegram-webhook.mjs";

function configured(value) {
  return String(value ?? "").trim();
}

function createRuntime(env) {
  const store = new D1LessonStore(env.DB);
  const telegram = createTelegramClient({ botToken: env.TELEGRAM_BOT_TOKEN });
  const anthropicClient = configured(env.ANTHROPIC_API_KEY)
    ? createAnthropicMessagesClient({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.ANTHROPIC_MODEL || "claude-sonnet-5",
      })
    : null;
  const routerOptions = {
    store,
    telegram,
    approvalPrompt: createApprovalPromptService({ store }),
    aiMode: env.AI_MODE || "manual",
  };
  if (anthropicClient) {
    routerOptions.answerProvider = createClaudeAnswerProvider({ messagesClient: anthropicClient });
    routerOptions.revisionProvider = createClaudeRevisionProvider({ messagesClient: anthropicClient });
  }
  const router = createLessonCommandRouter(routerOptions);
  return { store, telegram, router };
}

function dailyLessonMessage({ lessonDate, curriculumRef, lesson }) {
  const lines = [
    `좋은 아침. ${lessonDate} 학습 세션이 준비됐어.`,
    `커리큘럼: ${curriculumRef}`,
    `상태: ${lesson.state}`,
    `초안: Claude 웹에서 /prompt로 생성`,
    "",
    "/prompt로 Claude 웹에 붙여넣을 프롬프트를 받고, 결과는 /draft로 저장해줘.",
  ];
  return lines.join("\n");
}

export default {
  async fetch(request, env) {
    const { store, telegram, router } = createRuntime(env);
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
            text: "승인 기록 완료",
          });
        }
        await telegram.sendMessage({
          chatId: actor.chatId,
          text: `승인을 기록했어. approval=${approval.id}. 다음 단계에서 GitHub 배포를 이어갈게.`,
        });
        return { notified: true };
      },
      onApprovalRejected: async ({ update, error }) => {
        if (update.callback_query?.id) {
          await telegram.answerCallbackQuery({
            callbackQueryId: update.callback_query.id,
            text: `승인 실패: ${error.code ?? "ERROR"}`,
            showAlert: true,
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
      curriculumRefForDate: async () => env.DAILY_CURRICULUM_REF,
    });
    const result = await handler(controller);
    await telegram.sendMessage({
      chatId: env.TELEGRAM_ALLOWED_CHAT_ID,
      text: dailyLessonMessage(result),
    });
    return result;
  },
};
