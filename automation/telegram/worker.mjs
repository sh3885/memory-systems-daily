import { D1LessonStore } from "../storage/d1-lesson-store.mjs";
import { createTelegramWebhook } from "./telegram-webhook.mjs";

export default {
  async fetch(request, env) {
    const handler = createTelegramWebhook({
      env,
      store: new D1LessonStore(env.DB),
      onMessage: async () => ({ action: "message_received" }),
    });
    return handler(request);
  },
};

