"use client";

// Shown when Site Manager is unreachable and this instance has no last good state yet (feed.ts throws).
// A temporary 5xx, so search engines retry instead of dropping the page as they would after a 404.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-semibold">Сайтът се обновява · The site is being updated</h1>
      <p className="mt-3 text-ink-soft">Опитайте отново след малко. · Please try again in a moment.</p>
      <button type="button" onClick={() => reset()} className="mt-6 text-accent underline">Опитай пак · Try again</button>
    </main>
  );
}
