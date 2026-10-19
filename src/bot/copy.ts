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
/** "not confirmed within N hours": 2 for ordinary proposals, 24 for comment sets (proposalTtlHours). */
const expiredBg = (hours: number) => `Изтекло: не беше потвърдено в рамките на ${hours} часа.`;
const expiredEn = (hours: number) => `Expired: not confirmed within ${hours} hours.`;
/** 1 → "1st", 2 → "2nd", 20 → "20th" (the trial's last change, in English). */
const ordinalEn = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
/** YYYY-MM-DD → "1 ноември" / "1 November". */
const dayMonth = (date: string, months: string[]) => `${Number(date.slice(8, 10))} ${months[Number(date.slice(5, 7)) - 1]}`;

/** "2026-11-02" → "2 ноември" / "2 November" for the reminders. */
export function dayMonthLabel(date: string, lang: Lang): string {
  return dayMonth(date, lang === "bg" ? MONTHS_BG : MONTHS_EN);
}

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
  welcome: (name: string, adminUrl: string, publicUrl: string, ch: Channel, account = false) =>
    `Свързахте се като собственик на ${name}.\n\nКак работи:\n1. Пишете или пращате гласово: „Капучиното става 3,20“, „Баницата свърши“, „Затворени сме на 24 декември“.\n2. Получавате преглед и го потвърждавате с ✅.\n3. Сайтът се обновява веднага; ${ch === "tg" ? "/undo връща последната промяна" : "„върни последната промяна“ (или /undo) я отменя"}.\n\nСайт: ${publicUrl}\n${account ? `Табло: ${adminUrl} (влизате с имейла си)` : `Табло (пазете линка, той е вашият ключ): ${adminUrl}`}`,
  /** Owner welcome for a venue with no website (social media only): no site line, the posts go to their Instagram. */
  welcomeSocial: (name: string, adminUrl: string, ch: Channel, account = false) =>
    `Свързахте се като собственик на ${name}.\n\nКак работи:\n1. Пращате снимка или пишете какво искате да публикуваме: „Постни днешната торта“, „Затворени сме на 24 декември“.\n2. Получавате преглед и го потвърждавате с ✅.\n3. Публикувам го в вашия Instagram; ${ch === "tg" ? "/undo връща последната промяна" : "„върни последната промяна“ (или /undo) я отменя"}.\n\n${account ? `Табло: ${adminUrl} (влизате с имейла си)` : `Табло (пазете линка, той е вашият ключ): ${adminUrl}`}`,
  /** `page`: a venue with no website (site_mode none): its hosted page is "Вашата страница", not a site. */
  welcomeStaff: (name: string, publicUrl: string, page = false) =>
    `Свързахте се като персонал на ${name}. Можете да отбелязвате изчерпани продукти и да добавяте днешните предложения.\n\n${page ? "Вашата страница" : "Сайт"}: ${publicUrl}`,
  welcomeBack: (name: string, adminUrl: string, account = false) => `Вече сте свързани с ${name}. Табло: ${adminUrl}${account ? " (влизате с имейла си)" : ""}`,
  switched: (name: string) => `Вече управлявате ${name}.`,
  help: (ch: Channel) =>
    `${HELP_BG_BODY}\n\n${ch === "tg" ? "Команди: /menu – линкове към сайта, /lang bg|en – език, /undo – връща последната промяна, /members – кой има достъп (за собственика)." : "Думи-команди: „меню“ – линкове към сайта, „език bg“ / „език en“ – език. За да отмените последната промяна, напишете /undo или „върни последната промяна“. Кой има достъп: /members (за собственика)."}`,
  langSet: "Езикът е български.",
  langUsage: (ch: Channel): string => (ch === "tg" ? "Използвайте /lang bg или /lang en." : "Напишете „език bg“ или „език en“."),
  /** menuUrl null = no separate menu line (an own site may have no /menu path). */
  menu: (siteUrl: string, menuUrl: string | null, adminUrl: string | null, page = false, account = false) => `${page ? "Вашата страница" : "Сайтът"}: ${siteUrl}${menuUrl ? `\nМеню: ${menuUrl}` : ""}${adminUrl ? `\nQR код и табло: ${adminUrl}${account ? " (влизате с имейла си)" : ""}` : ""}`,
  changePrompt: "Напишете какво да променя в предложението.",
  notYours: "Това предложение не е от този чат.",
  applied: "✅ Приложено",
  /** ✅ on a boost_plan set: phase 1 only saves the ad plan. */
  planSaved: "✅ Планът е запазен — ще може да се пусне, щом рекламите са свързани.",
  /** ✅ on the undo of a boost_plan set. */
  planRemoved: "✅ Планът е премахнат.",
  scheduled: (when: string) => `⏰ Насрочено за ${when}`,
  cancelled: "❌ Отказано",
  /** Monthly change limit (src/domain/limits.ts); `resetsOn` is YYYY-MM-DD, the 1st of next month. */
  limitReached: (limit: number, used: number, resetsOn: string) => `Лимитът от ${limit} промени за този месец е достигнат (${used}/${limit}). Нови промени от ${dayMonth(resetsOn, MONTHS_BG)}.`,
  changesThisMonth: (used: number, limit: number) => `Промени този месец: ${used}/${limit}`,
  /** Billing (2026-10-19): the free trial counts its changes over the whole trial, not per month. */
  changesInTrial: (used: number, limit: number) => `Промени в пробния период: ${used}/${limit}`,
  /** The last trial change was used (or a new one is refused): new changes wait for a plan. Undo still works. */
  trialLimitReached: (limit: number, url: string) => `Използвахте и последната от ${limit} промени в пробния период, затова новите промени са на пауза, докато изберете план. Отмяната работи: ${url}`,
  /** Reminder "soon": `days` whole days left, `when` = "2 ноември". */
  trialEndsSoon: (days: number, when: string, url: string) => `Безплатният ви пробен период свършва след ${days === 1 ? "1 ден" : `${days} дни`}, на ${when}. За да продължите, изберете план: ${url}`,
  /** Reminder "soon" by use: 15 of the 20 trial changes are used. */
  trialChangesSoon: (used: number, limit: number, url: string) => `Използвахте ${used} от ${limit} промени в пробния период. За да не спират новите промени, изберете план: ${url}`,
  /** Reminder "ended": the trial time is over. */
  trialEnded: (url: string) => `Безплатният ви пробен период приключи, затова новите промени са на пауза. Сайтът и постовете ви остават онлайн. За да продължите, изберете план: ${url}`,
  /** The refusal of an owner request once the trial is over. */
  trialEndedRefusal: (url: string) => `Пробният ви период приключи, затова спрях новите промени. Сайтът и постовете ви остават онлайн. Изберете план и ще го направя веднага: ${url}`,
  /** The refusal when a paid plan is paused or canceled. */
  planPausedRefusal: (url: string) => `Планът ви е на пауза, затова новите промени са спрени. Сайтът и постовете ви остават онлайн. Подновете го тук и ще го направя веднага: ${url}`,
  /** The refusal when a payment failed more than 7 days ago. */
  pastDueRefusal: (url: string) => `Плащането ви не мина преди повече от 7 дни, затова новите промени са спрени. Сайтът и постовете ви остават онлайн. Обновете картата си и ще го направя веднага: ${url}`,
  /** The refusal when TRIAL_REQUIRES_CARD is on and no card was added. */
  cardRequiredRefusal: (url: string) => `Добавете карта, за да започне пробният ви период, и ще го направя веднага: ${url}`,
  /** A feature the plan does not include; `plan` is its name. */
  notInPlanRefusal: (feature: "site" | "social" | "comments" | "boost", plan: string, url: string) => {
    const what = { site: "Промените по сайта", social: "Публикациите в социалните мрежи", comments: "Отговорите на коментари", boost: "Рекламите" }[feature];
    return `${what} не са включени във вашия план ${plan}. Вижте плановете и ще го направя веднага: ${url}`;
  },
  /** The plan's name in a sentence. */
  planName: { admin: "Admin", social: "Социални мрежи", both: "Both" } as Record<"admin" | "social" | "both", string>,
  /** Comment replies (2026-10-15): the separate monthly cap on replies and moderations. */
  commentLimitReached: (limit: number, used: number, resetsOn: string) => `Лимитът от ${limit} отговора на коментари за този месец е достигнат (${used}/${limit}). Нови отговори от ${dayMonth(resetsOn, MONTHS_BG)}.`,
  /** Another owner tapped first on a comment proposal; `channel` is a CHANNEL_NAMES value. */
  decidedByOther: (decision: "apply" | "cancel", channel: string) => (decision === "apply" ? `✅ Отговорено от друг собственик (${channel})` : `❌ Отказано от друг собственик (${channel})`),
  /** A late tap on a comment proposal that is already decided (by this or another owner). */
  alreadyDecided: "Вече решено.",
  /** set_comment_mode summary; `label` is commentModeLabel (src/domain/comment-preview.ts). */
  commentModeSummary: (label: string) => `Известия за коментари: ${label}`,
  /**
   * The line on a comment proposal decided in the dashboard: one comment answered or ignored; for a batch, whether the rest were
   * proposed again at once ("again") or stay in the dashboard (the comment limit leaves no room: "waiting").
   */
  dashboardCommentDecided: (decision: "reply" | "ignore", rest: "none" | "again" | "waiting") =>
    rest === "none"
      ? (decision === "reply" ? "✅ Отговорено от таблото." : "❌ Отказано от таблото.")
      : `${decision === "reply" ? "✅ 1 отговорено от таблото" : "❌ 1 игнорирано от таблото"}; ${rest === "again" ? "останалите са предложени отново" : "останалите чакат в таблото"}`,
  expiredAfter: expiredBg,
  status: {
    proposed: "Чака решение.",
    scheduled: "Насрочено.",
    applied: "Вече е приложено.",
    rejected: "Отхвърлено.",
    expired: expiredBg(2),
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
  connectUsage: "Свържете сайта си на WordPress: инсталирайте плъгина Claudia, отворете Настройки → Claudia, натиснете „Генерирай код“ и изпратете тук реда, който плъгинът показва:\n/connect https://вашият-сайт.bg КОД",
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
  welcome: (name, adminUrl, publicUrl, ch, account = false) =>
    `You are linked as the owner of ${name}.\n\nHow it works:\n1. Type or send a voice note: “Cappuccino is 3.20 now”, “Banitsa is sold out”, “We're closed on 24 December”.\n2. You get a preview and confirm it with ✅.\n3. The site updates right away; ${ch === "tg" ? "/undo reverts the last change" : "“undo the last change” (or /undo) reverts it"}.\n\nSite: ${publicUrl}\n${account ? `Dashboard: ${adminUrl} (log in with your email)` : `Dashboard (keep this link, it is your key): ${adminUrl}`}`,
  welcomeSocial: (name, adminUrl, ch, account = false) =>
    `You are linked as the owner of ${name}.\n\nHow it works:\n1. Send a photo or write what you want posted: “Post today's cake”, “We're closed on 24 December”.\n2. You get a preview and confirm it with ✅.\n3. I publish it to your Instagram; ${ch === "tg" ? "/undo reverts the last change" : "“undo the last change” (or /undo) reverts it"}.\n\n${account ? `Dashboard: ${adminUrl} (log in with your email)` : `Dashboard (keep this link, it is your key): ${adminUrl}`}`,
  welcomeStaff: (name, publicUrl, page = false) => `You are linked as staff of ${name}. You can mark items sold out and add today's specials.\n\n${page ? "Your page" : "Site"}: ${publicUrl}`,
  welcomeBack: (name, adminUrl, account = false) => `You are already linked to ${name}. Dashboard: ${adminUrl}${account ? " (log in with your email)" : ""}`,
  switched: (name) => `You now manage ${name}.`,
  help: (ch) =>
    `${HELP_EN_BODY}\n\n${ch === "tg" ? "Commands: /menu – site links, /lang bg|en – language, /undo – reverts the last change, /members – who has access (owner only)." : "Command words: “menu” – site links, “language bg” / “language en” – language. To revert the last change, type /undo or write “undo the last change”. Who has access: /members (owner only)."}`,
  langSet: "Language set to English.",
  langUsage: (ch) => (ch === "tg" ? "Use /lang bg or /lang en." : "Write “language bg” or “language en”."),
  menu: (siteUrl, menuUrl, adminUrl, page = false, account = false) => `${page ? "Your page" : "Site"}: ${siteUrl}${menuUrl ? `\nMenu: ${menuUrl}` : ""}${adminUrl ? `\nQR code and dashboard: ${adminUrl}${account ? " (log in with your email)" : ""}` : ""}`,
  changePrompt: "Tell me what to change in the proposal.",
  notYours: "That proposal is not from this chat.",
  applied: "✅ Applied",
  planSaved: "✅ Plan saved — it can run once ads are connected.",
  planRemoved: "✅ Plan removed.",
  scheduled: (when) => `⏰ Scheduled for ${when}`,
  cancelled: "❌ Cancelled",
  limitReached: (limit, used, resetsOn) => `This month's limit of ${limit} changes is reached (${used}/${limit}). New changes from ${dayMonth(resetsOn, MONTHS_EN)}.`,
  changesThisMonth: (used, limit) => `Changes this month: ${used}/${limit}`,
  changesInTrial: (used, limit) => `Changes in your trial: ${used}/${limit}`,
  trialLimitReached: (limit, url) => `That was your ${ordinalEn(limit)} trial change, so new changes are paused until you choose a plan. Undo still works: ${url}`,
  trialEndsSoon: (days, when, url) => `Your free trial ends in ${days === 1 ? "1 day" : `${days} days`}, on ${when}. To keep going, choose a plan: ${url}`,
  trialChangesSoon: (used, limit, url) => `You've used ${used} of your ${limit} trial changes. To keep new changes coming, choose a plan: ${url}`,
  trialEnded: (url) => `Your free trial has ended, so new changes are paused. Your website and posts stay online. To keep going, choose a plan: ${url}`,
  trialEndedRefusal: (url) => `Your trial has ended, so I've paused new changes. Your website and posts stay online. Choose a plan and I'll do this right away: ${url}`,
  planPausedRefusal: (url) => `Your plan is paused, so new changes are on hold. Your website and posts stay online. Restart it here and I'll do this right away: ${url}`,
  pastDueRefusal: (url) => `Your payment failed more than 7 days ago, so new changes are on hold. Your website and posts stay online. Update your card and I'll do this right away: ${url}`,
  cardRequiredRefusal: (url) => `Add a card to start your trial and I'll do this right away: ${url}`,
  notInPlanRefusal: (feature, plan, url) => {
    const what = { site: "Website changes", social: "Social media posts", comments: "Comment replies", boost: "Ads" }[feature];
    return `${what} aren't included in your ${plan} plan. See the plans and I'll do this right away: ${url}`;
  },
  planName: { admin: "Admin", social: "Social media", both: "Both" },
  commentLimitReached: (limit, used, resetsOn) => `This month's limit of ${limit} comment replies is reached (${used}/${limit}). New replies from ${dayMonth(resetsOn, MONTHS_EN)}.`,
  decidedByOther: (decision, channel) => (decision === "apply" ? `✅ Answered by another owner (${channel})` : `❌ Declined by another owner (${channel})`),
  alreadyDecided: "Already decided.",
  commentModeSummary: (label) => `Comment notifications: ${label}`,
  dashboardCommentDecided: (decision, rest) =>
    rest === "none"
      ? (decision === "reply" ? "✅ Answered from the dashboard." : "❌ Cancelled from the dashboard.")
      : `${decision === "reply" ? "✅ 1 answered from the dashboard" : "❌ 1 ignored from the dashboard"}; ${rest === "again" ? "the others are proposed again" : "the others wait in the dashboard"}`,
  expiredAfter: expiredEn,
  status: {
    proposed: "Waiting for a decision.",
    scheduled: "Scheduled.",
    applied: "Already applied.",
    rejected: "Rejected.",
    expired: expiredEn(2),
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
  connectUsage: "Connect your WordPress site: install the Claudia plugin, open Settings → Claudia, press “Generate code” and send me the line the plugin shows:\n/connect https://your-site.com CODE",
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
