// src/landing/copy.ts
// The getclaudia.app landing page, every string in both languages, written in each, not translated word for word.
// Ported from the claudia-landing repo. The buttons are internal links into onboarding (/start); "Talk to us" survives as a
// small contact line that shows the NEXT_PUBLIC_CONTACT_EMAIL address (see Landing.tsx).
import type { PageLang } from "../auth/page-lang";

export type Lang = PageLang;
export const COFFIQUE_URL = "https://coffique.vercel.app";
export const TELEGRAM_URL = "https://t.me/restaurant_site_manager_bot";

export const copy = {
  en: {
    nav: { how: "How it works", pricing: "Pricing", start: "Start free", login: "Log in", dashboard: "Dashboard", contact: "Talk to us", lang: "BG", langLabel: "Switch to Bulgarian" },
    hero: {
      h1: "Your business online, run from one chat.",
      sub: "Send a message, a voice note or a photo. Claudia shows the change, you tap once, and it's live.",
      watch: "Play with sound",
      playing: "Playing",
      demo: "Watch the demo",
      trial: "2 weeks free · 20 changes · no card",
    },
    proof: { award: "Winner of the Crossroads 2026 hackathon", live: "Live at Coffique, Sofia" },
    steps: {
      h: "Three ways to change your site",
      items: [
        { t: "Say it", d: "“Cappuccino is 4.20 now.” Claudia knows your prices and shows the new one before anything changes." },
        { t: "Snap it", d: "Photograph a new product, a price list or today's board. Every item and price goes on the site, and a price that looks wrong gets a second question." },
        { t: "Tap it", d: "Every change waits for your Apply. Undo is one message away." },
      ],
      captions: ["The price goes live beside the chat", "Two changes from one message", "The same photo, posted to Instagram"],
    },
    channels: {
      h: "In the app you already use",
      sub: "Telegram, Messenger or WhatsApp. The same message also posts to Instagram. Google Business is next.",
    },
    trust: {
      h: "Nothing goes live without you.",
      items: [
        { t: "Preview", d: "Every change is shown first, with Apply, Change and Cancel buttons." },
        { t: "Undo", d: "Changed your mind? Write “undo the last change”." },
        { t: "Price guard", d: "A price that looks wrong (4.50 to 14.50) gets a second question before it goes out." },
      ],
    },
    pricing: {
      h: "One setup fee. Then less than a coffee a day.",
      setup: { t: "Ready website", d: "Your own site, domain and hosting, free for the first year.", price: "199 €", unit: "once" },
      keep: "Already have a WordPress site, or only need social media? No setup fee.",
      plans: [
        { id: "admin" as const, t: "Admin", price: "19 €", unit: "a month", d: "Your website kept up to date: prices, products or menu, hours, offers and what's sold out. By text and voice." },
        { id: "social" as const, t: "Social media manager", price: "39 €", unit: "a month", d: "Instagram and Facebook posts, stories and comment replies, made from your photos. Google next." },
        { id: "both" as const, t: "Both", price: "49 €", unit: "a month", d: "Admin and Social media manager together. You save 9 € a month.", featured: true },
      ],
      vat: "Prices exclude VAT.",
    },
    closing: { h: "Your site, ready tonight.", sub: "Twenty minutes from your phone. After that, you just text." },
    footer: { place: "Claudia, Sofia", telegram: "Telegram bot", coffique: "See it live at Coffique", privacy: "Privacy", deletion: "Data deletion" },
  },
  bg: {
    nav: { how: "Как работи", pricing: "Цени", start: "Започнете безплатно", login: "Вход", dashboard: "Табло", contact: "Пишете ни", lang: "EN", langLabel: "Switch to English" },
    hero: {
      h1: "Бизнесът ти онлайн, управляван от един чат.",
      sub: "Пращаш съобщение, гласово или снимка. Клаудия ти показва промяната, натискаш веднъж и тя е онлайн.",
      watch: "Пусни със звук",
      playing: "Върви",
      demo: "Виж демото",
      trial: "2 седмици безплатно · 20 промени · без карта",
    },
    proof: { award: "Победител в хакатона Crossroads 2026", live: "Работи в Coffique, София" },
    steps: {
      h: "Три начина да промениш сайта си",
      items: [
        { t: "Кажи го", d: "„Капучиното става 4,20.“ Клаудия знае цените ти и показва новата, преди да промени каквото и да е." },
        { t: "Снимай го", d: "Снимай нов продукт, ценоразпис или дъската с днешните предложения. Всяка позиция и цена отиват на сайта, а съмнителна цена получава втори въпрос." },
        { t: "Потвърди", d: "Всяка промяна чака твоето „Приложи“. Връщането е на едно съобщение разстояние." },
      ],
      captions: ["Цената излиза онлайн до чата", "Две промени от едно съобщение", "Същата снимка, публикувана в Instagram"],
    },
    channels: {
      h: "В приложението, което вече ползваш",
      sub: "Telegram, Messenger или WhatsApp. Същото съобщение публикува и в Instagram. Следва Google Business.",
    },
    trust: {
      h: "Нищо не излиза онлайн без теб.",
      items: [
        { t: "Преглед", d: "Всяка промяна първо се показва, с бутони Приложи, Промени и Откажи." },
        { t: "Връщане", d: "Размисли? Напиши „върни последната промяна“." },
        { t: "Пазач на цените", d: "Цена, която изглежда грешна (4,50 към 14,50), получава втори въпрос, преди да излезе." },
      ],
    },
    pricing: {
      h: "Еднократна такса. После по-малко от едно кафе на ден.",
      setup: { t: "Готов сайт", d: "Твой сайт, домейн и хостинг, първата година без доплащане.", price: "199 €", unit: "еднократно" },
      keep: "Имаш WordPress сайт или ти трябват само социалните мрежи? Без такса за изработка.",
      plans: [
        { id: "admin" as const, t: "Администратор", price: "19 €", unit: "на месец", d: "Сайтът ти винаги актуален: цени, продукти или меню, работно време, оферти и какво е изчерпано. С текст и глас." },
        { id: "social" as const, t: "Мениджър социални мрежи", price: "39 €", unit: "на месец", d: "Публикации и истории в Instagram и Facebook и отговори на коментари, направени от твоите снимки. Следва Google." },
        { id: "both" as const, t: "Двата заедно", price: "49 €", unit: "на месец", d: "Администратор и Мениджър социални мрежи заедно. Спестяваш 9 € на месец.", featured: true },
      ],
      vat: "Цените са без ДДС.",
    },
    closing: { h: "Сайтът ти, готов довечера.", sub: "Двайсет минути от телефона. След това само пишеш." },
    footer: { place: "Клаудия, София", telegram: "Telegram бот", coffique: "Виж го на живо в Coffique", privacy: "Поверителност", deletion: "Изтриване на данни" },
  },
};

export type Copy = (typeof copy)["en"];

