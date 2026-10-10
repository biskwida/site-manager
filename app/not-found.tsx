import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-semibold">Page not found · Страницата не е намерена</h1>
      <Link href="/" className="mt-6 text-accent underline">Site Manager</Link>
    </main>
  );
}
