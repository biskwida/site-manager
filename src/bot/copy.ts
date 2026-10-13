// src/bot/copy.ts
import type { Channel } from "../channels/ref";
import type { Lang, Role } from "../domain/types";
import type { InviteView, MemberView } from "./members";

export function langFromCode(code?: string): Lang {
  return (code ?? "").toLowerCase().startsWith("bg") ? "bg" : "en";
}

const HELP_BG_BODY =
  "Пишете какво искате да промените, на български или английски. Примери:\n• „Капучиното става 3,20“\n• „Баницата свърши“\n• „Добави шопска салата 7,50“\n• „Затворени сме на 24 и 25 декември“\n• снимка на дъската с предложенията\n• снимка с текст „това е новата корица“";
const HELP_EN_BODY =
  "Tell me what to change, in English or Bulgarian. Examples:\n• “Cappuccino is 3.20 now”\n• “Banitsa is sold out”\n• “Add shopska salad 7.50”\n• “We're closed on 24 and 25 December”\n• a photo of the specials board\n• a photo captioned “this is the new cover”";

const MONTHS_BG = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** YYYY-MM-DD → "1 ноември" / "1 November". */
const dayMonth = (date: string, months: string[]) => `${Number(date.slice(8, 10))} ${months[Number(date.slice(5, 7)) - 1]}`;

function membersText(head: string, roles: Record<Role, string>, you: string, lastSeen: string, never: string, joined: string, codesHead: string, validUntil: string, noCodes: string, tail: string, members: MemberView[], invites: InviteView[]): string {
  const lines = members.map((m) => `• ${roles[m.role]}${m.you ? ` (${you})` : ""} · ${m.channel} ${m.id} · ${m.lang.toUpperCase()} · ${m.lastSeen ? `${lastSeen} ${m.lastSeen}` : never} · ${joined} ${m.joined}`);
  const codes = invites.length ? `${codesHead}\n${invites.map((i) => `• ${roles[i.role]} · ${validUntil} ${i.expires}`).join("\n")}` : noCodes;
  return `${head}\n${lines.join("\n")}\n\n${codes}\n\n${tail}`;
}

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
    `${HELP_BG_BODY}\n\n${ch === "tg" ? "Команди: /menu – линкове към сайта, /lang bg|en – език, /undo – връща последната промяна, /members – кой има достъп (за собственика)." : "Думи-команди: „меню“ – линкове към сайта, „език bg“ / „език en“ – език. За да отмените последната промяна, напишете /undo или „върни последната промяна“. Кой има достъп: /members (за собственика)."}`,
  langSet: "Езикът е български.",
  langUsage: (ch: Channel): string => (ch === "tg" ? "Използвайте /lang bg или /lang en." : "Напишете „език bg“ или „език en“."),
  menu: (publicUrl: string, adminUrl: string | null) => `Сайтът: ${publicUrl}\nМеню: ${publicUrl}/menu${adminUrl ? `\nQR код и табло: ${adminUrl}` : ""}`,
  changePrompt: "Напишете какво да променя в предложението.",
  notYours: "Това предложение не е от този чат.",
  applied: "✅ Приложено",
  scheduled: (when: string) => `⏰ Насрочено за ${when}`,
  cancelled: "❌ Отказано",
  /** Monthly change limit (src/domain/limits.ts); `resetsOn` is YYYY-MM-DD, the 1st of next month. */
  limitReached: (limit: number, used: number, resetsOn: string) => `Лимитът от ${limit} промени за този месец е достигнат (${used}/${limit}). Нови промени от ${dayMonth(resetsOn, MONTHS_BG)}.`,
  changesThisMonth: (used: number, limit: number) => `Промени този месец: ${used}/${limit}`,
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
  photoWaiting: "📷 Получих снимката. Какво да направя с нея? Напишете или изпратете гласово съобщение.",
  error: "Възникна грешка. Опитайте отново.",
  connectUsage: "Свържете сайта си на WordPress: инсталирайте плъгина Site Manager, отворете Настройки → Site Manager, натиснете „Генерирай код“ и изпратете тук реда, който плъгинът показва:\n/connect https://вашият-сайт.bg КОД",
  connectOwnerOnly: "Само собственикът може да свързва сайта.",
  membersOwnerOnly: "Само собственикът може да вижда кой има достъп.",
  members: (name: string, members: MemberView[], invites: InviteView[]) =>
    membersText(`Достъп до ${name}:`, { owner: "Собственик", staff: "Персонал" }, "вие", "последно писал", "още не е писал", "добавен", "Неизползвани кодове:", "валиден до", "Няма неизползвани кодове.", "Достъпът се премахва от нас: пишете ни, ако някой вече не бива да управлява сайта.", members, invites),
  connectUnavailable: "Свързването на сайтове не е включено на този сървър.",
  connectOk: (name: string, url: string) => `✅ Свързах WordPress сайта „${name}“ (${url}). Вече мога да редактирам страниците, снимките и менютата му; всяка промяна първо ще ви покажа за одобрение.`,
  connectFailed: (reason: string) => `Не успях да свържа сайта. ${reason}`,
  ownSite: (url: string) => `Сайтът ви ${url} е свързан и аз го поддържам: промените, които одобрите тук, се появяват на него.`,
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
    `${HELP_EN_BODY}\n\n${ch === "tg" ? "Commands: /menu – site links, /lang bg|en – language, /undo – reverts the last change, /members – who has access (owner only)." : "Command words: “menu” – site links, “language bg” / “language en” – language. To revert the last change, type /undo or write “undo the last change”. Who has access: /members (owner only)."}`,
  langSet: "Language set to English.",
  langUsage: (ch) => (ch === "tg" ? "Use /lang bg or /lang en." : "Write “language bg” or “language en”."),
  menu: (publicUrl, adminUrl) => `Site: ${publicUrl}\nMenu: ${publicUrl}/menu${adminUrl ? `\nQR code and dashboard: ${adminUrl}` : ""}`,
  changePrompt: "Tell me what to change in the proposal.",
  notYours: "That proposal is not from this chat.",
  applied: "✅ Applied",
  scheduled: (when) => `⏰ Scheduled for ${when}`,
  cancelled: "❌ Cancelled",
  limitReached: (limit, used, resetsOn) => `This month's limit of ${limit} changes is reached (${used}/${limit}). New changes from ${dayMonth(resetsOn, MONTHS_EN)}.`,
  changesThisMonth: (used, limit) => `Changes this month: ${used}/${limit}`,
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
  photoWaiting: "📷 Got the photo. What should I do with it? Type it or send a voice note.",
  error: "Something went wrong. Please try again.",
  connectUsage: "Connect your WordPress site: install the Site Manager plugin, open Settings → Site Manager, press “Generate code” and send me the line the plugin shows:\n/connect https://your-site.com CODE",
  connectOwnerOnly: "Only the owner can connect the site.",
  membersOwnerOnly: "Only the owner can see who has access.",
  members: (name, members, invites) =>
    membersText(`Who has access to ${name}:`, { owner: "Owner", staff: "Staff" }, "you", "last message", "no messages yet", "joined", "Unused codes:", "valid until", "No unused codes.", "To remove someone's access, ask us.", members, invites),
  connectUnavailable: "Connecting sites is not enabled on this server.",
  connectOk: (name, url) => `✅ Connected the WordPress site “${name}” (${url}). I can now edit its pages, photos and menus; every change is shown to you for approval first.`,
  connectFailed: (reason) => `I could not connect the site. ${reason}`,
  ownSite: (url) => `Your site ${url} is connected and I manage it: the changes you approve here appear on it.`,
  publishing: "Your site is being published. I'll message you when it's live (usually within 2–3 minutes).",
  siteLive: (name, url) => `🎉 ${name}'s site is live: ${url}\n\nFrom now on, changes from this chat show up there within seconds.`,
  designLive: (url) => `✅ The new design is live: ${url}`,
  siteFailed: (name) => `Publishing ${name}'s site failed. Open the dashboard and press Try again; until then your site stays available at the address from the welcome message.`,
};

export function copy(lang: Lang) {
  return lang === "bg" ? BG : EN;
}
