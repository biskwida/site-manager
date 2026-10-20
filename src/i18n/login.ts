// src/i18n/login.ts
// Copy for /login (BG first). Client-safe: no server imports. {email} is filled in by the form.
import type { Lang } from "../domain/types";

const bg = {
  title: "Вход в Claudia",
  lead: "Въведете имейла си и ще ви изпратим линк за вход. Без парола.",
  emailLabel: "Имейл",
  submit: "Изпратете ми линк",
  sending: "Изпращаме…",
  or: "или",
  google: "Продължете с Google",
  sentTitle: "Проверете пощата си",
  sentBody: "Изпратихме линк за вход на {email}. Отворете го в този браузър. Ако не го виждате, проверете в спама.",
  another: "Използвайте друг имейл",
  errorSend: "Не успяхме да изпратим линка. Опитайте пак след малко.",
  errorGoogle: "Входът с Google не се получи. Опитайте пак.",
  errorCallback: "Линкът не проработи или е изтекъл. Заявете нов.",
  unavailable: "Входът не е наличен в тази среда.",
  otherLang: "English",
  otherLangCode: "en",
} as const;

const en: Record<keyof typeof bg, string> = {
  title: "Sign in to Claudia",
  lead: "Enter your email and we will send you a sign-in link. No password.",
  emailLabel: "Email",
  submit: "Email me a link",
  sending: "Sending…",
  or: "or",
  google: "Continue with Google",
  sentTitle: "Check your email",
  sentBody: "We sent a sign-in link to {email}. Open it in this browser. If you do not see it, check your spam folder.",
  another: "Use a different email",
  errorSend: "We could not send the link. Please try again in a moment.",
  errorGoogle: "Sign-in with Google did not work. Please try again.",
  errorCallback: "The link did not work or has expired. Request a new one.",
  unavailable: "Sign-in is not available in this environment.",
  otherLang: "Български",
  otherLangCode: "bg",
};

export type LoginCopy = Record<keyof typeof bg, string>;
export const LOGIN: Record<Lang, LoginCopy> = { bg, en };
