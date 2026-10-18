import type { Metadata } from "next";
import { Literata, Onest } from "next/font/google";
import "./globals.css";

const literata = Literata({ subsets: ["latin", "cyrillic"], variable: "--font-literata", display: "swap", axes: ["opsz"] });
const onest = Onest({ subsets: ["latin", "cyrillic"], variable: "--font-onest", display: "swap" });

export const metadata: Metadata = {
  title: "Claudia",
  description: "A café website its owner runs from Telegram.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="bg" className={`${literata.variable} ${onest.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
