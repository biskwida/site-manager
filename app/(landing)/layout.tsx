// app/(landing)/layout.tsx — the frame of the getclaudia.app landing page (`/`). Sofia Sans (designed in Sofia, with Bulgarian Cyrillic
// forms; Condensed for headlines) and the landing's own tokens load here and nowhere else, so the wizard, the dashboard and the venue
// sites keep their look. The fonts' CSS variables are set on the wrapper, not on <html>.
import { Sofia_Sans, Sofia_Sans_Condensed } from "next/font/google";
import type { ReactNode } from "react";
import "./landing.css";

const body = Sofia_Sans({ subsets: ["latin", "cyrillic"], variable: "--font-lp-body", display: "swap" });
const display = Sofia_Sans_Condensed({ subsets: ["latin", "cyrillic"], variable: "--font-lp-display", display: "swap" });

export default function LandingLayout({ children }: { children: ReactNode }) {
  return <div className={`lp ${body.variable} ${display.variable}`}>{children}</div>;
}
