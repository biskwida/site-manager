// src/bot/copy.ts
import type { Lang } from "../domain/types";

export function langFromCode(code?: string): Lang {
  return (code ?? "").toLowerCase().startsWith("bg") ? "bg" : "en";
}

const BG = {
  noAccess: "Този бот управлява сайта на конкретно заведение. Изпратете /start <код> с кода, който получихте от нас.",
  badCode: "Кодът е невалиден, изтекъл или вече използван. Поискайте нов от нас.",
  welcome: (name: string, adminUrl: string, publicUrl: string) =>
    `Свързахте се като собственик на ${name}.\n\nКак работи:\n1. Пишете или пращате гласово: „Капучиното става 3,20“, „Баницата свърши“, „Затворени сме на 24 декември“.\n2. Получавате преглед и го потвърждавате с ✅.\n3. Сайтът се обновява веднага; /undo връща последната промяна.\n\nСайт: ${publicUrl}\nТабло (пазете линка, той е вашият ключ): ${adminUrl}`,
  welcomeStaff: (name: string, publicUrl: string) =>
    `Свързахте се като персонал на ${name}. Можете да отбелязвате изчерпани продукти и да добавяте днешните предложения.\n\nСайт: ${publicUrl}`,
  welcomeBack: (name: string, adminUrl: string) => `Вече сте свързани с ${name}. Табло: ${adminUrl}`,
  help: "Пишете какво искате да промените, на български или английски. Примери:\n• „Капучиното става 3,20“\n• „Баницата свърши“\n• „Добави шопска салата 7,50“\n• „Затворени сме на 24 и 25 декември“\n• снимка на дъската с предложенията\n• снимка с текст „това е новата корица“\n\nКоманди: /menu – линкове към сайта, /lang bg|en – език, /undo – връща последната промяна.",
  langSet: "Езикът е български.",
  langUsage: "Използвайте /lang bg или /lang en.",
  menu: (publicUrl: string, adminUrl: string | null) => `Сайтът: ${publicUrl}\nМеню: ${publicUrl}/menu${adminUrl ? `\nQR код и табло: ${adminUrl}` : ""}`,
  changePrompt: "Напишете какво да променя в предложението.",
  notYours: "Това предложение не е от този чат.",
  applied: "✅ Приложено",
  scheduled: (when: string) => `⏰ Насрочено за ${when}`,
  cancelled: "❌ Отказано",
  status: {
    proposed: "Чака решение.",
    scheduled: "Насрочено.",
    applied: "Вече е приложено.",
    rejected: "Отхвърлено.",
    expired: "Изтекло: не беше потвърдено в рамките на 2 часа.",
    cancelled: "Отказано.",
    reverted: "Отменено с по-късна промяна.",
  },
  voiceUnavailable: "Гласовите съобщения не са включени на този сървър. Моля, напишете го.",
  voiceFailed: "Не успях да разпозная записа. Опитайте отново или го напишете.",
  heard: (text: string) => `🎤 Чух: „${text}“`,
  photoFailed: "Не успях да изтегля снимката. Опитайте отново.",
  photoTooBig: "Снимката е над 5 MB. Изпратете по-малка или я пратете като снимка, а не като файл.",
  error: "Възникна грешка. Опитайте отново.",
  publishing: "Сайтът ви се публикува. Ще ви пиша, когато е готов (обикновено до 2–3 минути).",
  siteLive: (name: string, url: string) => `🎉 Сайтът на ${name} е готов: ${url}\n\nОт тук нататък промените от този чат се появяват на него за секунди.`,
  designLive: (url: string) => `✅ Новият дизайн е онлайн: ${url}`,
  siteFailed: (name: string) => `Публикуването на сайта на ${name} не успя. Отворете таблото и натиснете „Опитай пак“; дотогава сайтът ви остава достъпен на адреса от приветственото съобщение.`,
};

const EN: typeof BG = {
  noAccess: "This bot manages one venue's website. Send /start <code> with the code you received from us.",
  badCode: "That code is invalid, expired or already used. Ask us for a new one.",
  welcome: (name, adminUrl, publicUrl) =>
    `You are linked as the owner of ${name}.\n\nHow it works:\n1. Type or send a voice note: “Cappuccino is 3.20 now”, “Banitsa is sold out”, “We're closed on 24 December”.\n2. You get a preview and confirm it with ✅.\n3. The site updates right away; /undo reverts the last change.\n\nSite: ${publicUrl}\nDashboard (keep this link, it is your key): ${adminUrl}`,
  welcomeStaff: (name, publicUrl) => `You are linked as staff of ${name}. You can mark items sold out and add today's specials.\n\nSite: ${publicUrl}`,
  welcomeBack: (name, adminUrl) => `You are already linked to ${name}. Dashboard: ${adminUrl}`,
  help: "Tell me what to change, in English or Bulgarian. Examples:\n• “Cappuccino is 3.20 now”\n• “Banitsa is sold out”\n• “Add shopska salad 7.50”\n• “We're closed on 24 and 25 December”\n• a photo of the specials board\n• a photo captioned “this is the new cover”\n\nCommands: /menu – site links, /lang bg|en – language, /undo – reverts the last change.",
  langSet: "Language set to English.",
  langUsage: "Use /lang bg or /lang en.",
  menu: (publicUrl, adminUrl) => `Site: ${publicUrl}\nMenu: ${publicUrl}/menu${adminUrl ? `\nQR code and dashboard: ${adminUrl}` : ""}`,
  changePrompt: "Tell me what to change in the proposal.",
  notYours: "That proposal is not from this chat.",
  applied: "✅ Applied",
  scheduled: (when) => `⏰ Scheduled for ${when}`,
  cancelled: "❌ Cancelled",
  status: {
    proposed: "Waiting for a decision.",
    scheduled: "Scheduled.",
    applied: "Already applied.",
    rejected: "Rejected.",
    expired: "Expired: not confirmed within 2 hours.",
    cancelled: "Cancelled.",
    reverted: "Reverted by a later change.",
  },
  voiceUnavailable: "Voice notes are not enabled on this server. Please type it.",
  voiceFailed: "I couldn't transcribe that. Try again or type it.",
  heard: (text) => `🎤 Heard: “${text}”`,
  photoFailed: "I couldn't download the photo. Please try again.",
  photoTooBig: "The photo is over 5 MB. Send a smaller one, or send it as a photo rather than a file.",
  error: "Something went wrong. Please try again.",
  publishing: "Your site is being published. I'll message you when it's live (usually within 2–3 minutes).",
  siteLive: (name, url) => `🎉 ${name}'s site is live: ${url}\n\nFrom now on, changes from this chat show up there within seconds.`,
  designLive: (url) => `✅ The new design is live: ${url}`,
  siteFailed: (name) => `Publishing ${name}'s site failed. Open the dashboard and press Try again; until then your site stays available at the address from the welcome message.`,
};

export function copy(lang: Lang) {
  return lang === "bg" ? BG : EN;
}
