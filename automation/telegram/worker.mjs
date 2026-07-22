import { D1LessonStore } from "../storage/d1-lesson-store.mjs";
import { createResearchPipeline } from "../research/research-pipeline.mjs";
import { createCloudflareScheduledHandler } from "../scheduler/daily-lesson-scheduler.mjs";
import {
  createOpenAIResponsesClient,
  createStudyAnswerProvider,
  createStudyResearchProvider,
  createStudyRevisionProvider,
} from "../llm/openai-responses-provider.mjs";
import { createApprovalPromptService, createLessonCommandRouter } from "./lesson-command-router.mjs";
import { createTelegramClient } from "./telegram-client.mjs";
import { createTelegramWebhook } from "./telegram-webhook.mjs";

function createRuntime(env) {
  const store = new D1LessonStore(env.DB);
  const telegram = createTelegramClient({ botToken: env.TELEGRAM_BOT_TOKEN });
  const responsesClient = String(env.OPENAI_API_KEY ?? "").trim()
    ? createOpenAIResponsesClient({
        apiKey: env.OPENAI_API_KEY,
        model: env.AI_MODEL || "gpt-5.6",
      })
    : null;
  const routerOptions = {
    store,
    telegram,
    approvalPrompt: createApprovalPromptService({ store }),
  };
  if (responsesClient) {
    routerOptions.answerProvider = createStudyAnswerProvider({ responsesClient });
    routerOptions.revisionProvider = createStudyRevisionProvider({ responsesClient });
  }
  const router = createLessonCommandRouter(routerOptions);
  const researchPipeline = responsesClient
    ? createResearchPipeline({
        store,
        researchProvider: createStudyResearchProvider({ responsesClient }),
      })
    : null;
  return { store, telegram, router, researchPipeline };
}

function dailyLessonMessage({ lessonDate, curriculumRef, lesson, research }) {
  const lines = [
    `좋은 아침. ${lessonDate} 학습 세션이 준비됐어.`,
    `커리큘럼: ${curriculumRef}`,
    `상태: ${research?.lesson?.state ?? lesson.state}`,
    `초안: ${research ? `revision ${research.revision.revisionNumber}` : "아직 생성 전"}`,
    "",
    "/today로 현재 초안을 확인하고, 이해 안 되는 부분은 그대로 질문해줘.",
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
    const { store, telegram, researchPipeline } = createRuntime(env);
    const handler = createCloudflareScheduledHandler({
      store,
      curriculumRefForDate: async () => env.DAILY_CURRICULUM_REF,
    });
    const result = await handler(controller);
    let research = null;
    if (researchPipeline) {
      research = await researchPipeline.runLessonResearch({
        lessonDate: result.lessonDate,
        curriculumRef: result.curriculumRef,
        topic: {
          curriculumRef: result.curriculumRef,
          instruction: "Create today's Korean study draft and primary-source claim ledger.",
        },
        operationKey: `scheduled:${result.lessonDate}:${result.curriculumRef}`,
      });
    }
    await telegram.sendMessage({
      chatId: env.TELEGRAM_ALLOWED_CHAT_ID,
      text: dailyLessonMessage({ ...result, research }),
    });
    return { ...result, research };
  },
};
