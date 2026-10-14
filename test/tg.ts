// test/tg.ts
import type { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

export const BOT_INFO: UserFromGetMe = { id: 1, is_bot: true, first_name: "Site", username: "site_manager_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false };

let n = 1;
const from = (chatId: number, lang: string) => ({ id: chatId, is_bot: false, first_name: "T", language_code: lang });
const chat = (chatId: number) => ({ id: chatId, type: "private" as const, first_name: "T" });

export function textUpdate(chatId: number, text: string, lang = "bg"): Update {
  const cmd = text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0].length }] : undefined;
  return { update_id: n++, message: { message_id: n++, date: 0, chat: chat(chatId), from: from(chatId, lang), text, entities: cmd } } as Update;
}
export function callbackUpdate(chatId: number, data: string, messageId: number, lang = "bg"): Update {
  return { update_id: n++, callback_query: { id: `cq${n}`, from: from(chatId, lang), chat_instance: "ci", data, message: { message_id: messageId, date: 0, chat: chat(chatId), text: "preview" } } } as Update;
}
export function photoUpdate(chatId: number, caption?: string, lang = "bg"): Update {
  return { update_id: n++, message: { message_id: n++, date: 0, chat: chat(chatId), from: from(chatId, lang), caption, photo: [{ file_id: "small", file_unique_id: "s", width: 90, height: 90 }, { file_id: "big", file_unique_id: "b", width: 1280, height: 960 }] } } as Update;
}
export function voiceUpdate(chatId: number, lang = "bg"): Update {
  return { update_id: n++, message: { message_id: n++, date: 0, chat: chat(chatId), from: from(chatId, lang), voice: { file_id: "v1", file_unique_id: "v", duration: 3, mime_type: "audio/ogg" } } } as Update;
}

/** Intercepts every Bot API call; returns canned results and records the calls. */
export function captureApi(bot: Bot) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  let msgId = 500;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result: unknown =
      method === "sendMessage" || method === "sendPhoto" ? { message_id: msgId++, date: 0, chat: { id: (payload as { chat_id: number }).chat_id, type: "private" }, text: (payload as { text: string }).text }
      : method === "getFile" ? { file_id: (payload as { file_id: string }).file_id, file_unique_id: "u", file_path: `files/${(payload as { file_id: string }).file_id}.bin` }
      : true;
    return { ok: true, result } as never;
  });
  return { calls, texts: () => calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text as string) };
}
