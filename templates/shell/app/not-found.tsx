import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-semibold">Страницата не е намерена · Page not found</h1>
      <p className="mt-3 text-ink-soft">Сайтът се обновява в момента. Опитайте след малко. · The site is being updated. Please try again in a moment.</p>
      <Link href="/" className="mt-6 text-accent underline">Начало · Home</Link>
    </main>
  );
}
