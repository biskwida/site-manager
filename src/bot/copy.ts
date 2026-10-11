// src/bot/copy.ts
import type { Channel } from "../channels/ref";
import type { Lang } from "../domain/types";

export function langFromCode(code?: string): Lang {
  return (code ?? "").toLowerCase().startsWith("bg") ? "bg" : "en";
}

const HELP_BG_BODY =
  "Пишете какво искате да промените, на български или английски. Примери:\n• „Капучиното става 3,20“\n• „Баницата свърши“\n• „Добави шопска салата 7,50“\n• „Затворени сме на 24 и 25 декември“\n• снимка на дъската с предложенията\n• снимка с текст „това е новата корица“";
const HELP_EN_BODY =
  "Tell me what to change, in English or Bulgarian. Examples:\n• “Cappuccino is 3.20 now”\n• “Banitsa is sold out”\n• “Add shopska salad 7.50”\n• “We're closed on 24 and 25 December”\n• a photo of the specials board\n• a photo captioned “this is the new cover”";

const BG = {
  noAccess: (ch: Channel): string =>
    ch === "tg"
      ? "Този бот управлява сайта на конкретно заведение. Изпратете /start <код> с кода, който получихте от нас."
      : "Този бот управлява сайта на конкретно заведение. Изпратете кода, който получихте от нас.",
  badCode: "Кодът е невалиден, изтекъл или вече използван. Поискайте нов от нас.",
  welcome: (name: string, adminUrl: string, publicUrl: string, ch: Channel) =>
    `Свързахте се като собственик на ${name}.\n\nКак работи:\n1. Пишете или пращате гласово: „Капучиното става 3,20“, „Баницата свърши“, „Затворени сме на 24 декември“.\n2. Получавате преглед и го потвърждавате с ✅.\n3. Сайтът се обновява веднага; ${ch === "tg" ? "/undo връща последната промяна" : "„върни последната промяна“ (или /undo) я отменя"}.\n\nСайт: ${publicUrl}\nТабло (пазете линка, той е вашият ключ): ${adminUrl}`,
  welcomeStaff: (name: string, publicUrl: string) =>
    `Свързахте се като персонал на ${name}. Можете да отбелязвате изчерпани продукти и да добавяте днешните предложения.\n\nСайт: ${publicUrl}`,
  welcomeBack: (name: string, adminUrl: string) => `Вече сте свързани с ${name}. Табло: ${adminUrl}`,
  switched: (name: string) => `Вече управлявате ${name}.`,
  help: (ch: Channel) =>
    `${HELP_BG_BODY}\n\n${ch === "tg" ? "Команди: /menu – линкове към сайта, /lang bg|en – език, /undo – връща последната промяна." : "Думи-команди: „меню“ – линкове към сайта, „език bg“ / „език en“ – език. За да отмените последната промяна, напишете /undo или „върни последната промяна“."}`,
  langSet: "Езикът е български.",
  langUsage: (ch: Channel): string => (ch === "tg" ? "Използвайте /lang bg или /lang en." : "Напишете „език bg“ или „език en“."),
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
  connectUsage: "Свържете сайта си на WordPress: инсталирайте плъгина Site Manager, отворете Настройки → Site Manager, натиснете „Генерирай код“ и изпратете тук реда, който плъгинът показва:\n/connect https://вашият-сайт.bg КОД",
  connectOwnerOnly: "Само собственикът може да свързва сайта.",
  connectUnavailable: "Свързването на сайтове не е включено на този сървър.",
  connectOk: (name: string, url: string) => `✅ Свързах WordPress сайта „${name}“ (${url}). Вече мога да редактирам страниците, снимките и менютата му; всяка промяна първо ще ви покажа за одобрение.`,
  connectFailed: (reason: string) => `Не успях да свържа сайта. ${reason}`,
  publishing: "Сайтът ви се публикува. Ще ви пиша, когато е готов (обикновено до 2–3 минути).",
  siteLive: (name: string, url: string) => `🎉 Сайтът на ${name} е готов: ${url}\n\nОт тук нататък промените от този чат се появяват на него за секунди.`,
  designLive: (url: string) => `✅ Новият дизайн е онлайн: ${url}`,
  siteFailed: (name: string) => `Публикуването на сайта на ${name} не успя. Отворете таблото и натиснете „Опитай пак“; дотогава сайтът ви остава достъпен на адреса от приветственото съобщение.`,
};

const EN: typeof BG = {
  noAccess: (ch) =>
    ch === "tg" ? "This bot manages one venue's website. Send /start <code> with the code you received from us." : "This bot manages one venue's website. Send the code you received from us.",
  badCode: "That code is invalid, expired or already used. Ask us for a new one.",
  welcome: (name, adminUrl, publicUrl, ch) =>
    `You are linked as the owner of ${name}.\n\nHow it works:\n1. Type or send a voice note: “Cappuccino is 3.20 now”, “Banitsa is sold out”, “We're closed on 24 December”.\n2. You get a preview and confirm it with ✅.\n3. The site updates right away; ${ch === "tg" ? "/undo reverts the last change" : "“undo the last change” (or /undo) reverts it"}.\n\nSite: ${publicUrl}\nDashboard (keep this link, it is your key): ${adminUrl}`,
  welcomeStaff: (name, publicUrl) => `You are linked as staff of ${name}. You can mark items sold out and add today's specials.\n\nSite: ${publicUrl}`,
  welcomeBack: (name, adminUrl) => `You are already linked to ${name}. Dashboard: ${adminUrl}`,
  switched: (name) => `You now manage ${name}.`,
  help: (ch) =>
    `${HELP_EN_BODY}\n\n${ch === "tg" ? "Commands: /menu – site links, /lang bg|en – language, /undo – reverts the last change." : "Command words: “menu” – site links, “language bg” / “language en” – language. To revert the last change, type /undo or write “undo the last change”."}`,
  langSet: "Language set to English.",
  langUsage: (ch) => (ch === "tg" ? "Use /lang bg or /lang en." : "Write “language bg” or “language en”."),
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
  connectUsage: "Connect your WordPress site: install the Site Manager plugin, open Settings → Site Manager, press “Generate code” and send me the line the plugin shows:\n/connect https://your-site.com CODE",
  connectOwnerOnly: "Only the owner can connect the site.",
  connectUnavailable: "Connecting sites is not enabled on this server.",
  connectOk: (name, url) => `✅ Connected the WordPress site “${name}” (${url}). I can now edit its pages, photos and menus; every change is shown to you for approval first.`,
  connectFailed: (reason) => `I could not connect the site. ${reason}`,
  publishing: "Your site is being published. I'll message you when it's live (usually within 2–3 minutes).",
  siteLive: (name, url) => `🎉 ${name}'s site is live: ${url}\n\nFrom now on, changes from this chat show up there within seconds.`,
  designLive: (url) => `✅ The new design is live: ${url}`,
  siteFailed: (name) => `Publishing ${name}'s site failed. Open the dashboard and press Try again; until then your site stays available at the address from the welcome message.`,
};

export function copy(lang: Lang) {
  return lang === "bg" ? BG : EN;
}
