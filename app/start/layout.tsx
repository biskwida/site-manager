import type { Metadata } from "next";
import type { ReactNode } from "react";

// No indexing: sign-up steps and a signed-in checklist. The account pages draw their own frame (app/components/AccountShell.tsx).
export const metadata: Metadata = { title: "Claudia", robots: { index: false, follow: false } };

export default function StartLayout({ children }: { children: ReactNode }) {
  return children;
}
