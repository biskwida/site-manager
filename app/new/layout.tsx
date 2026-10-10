import { Commissioner, Sofia_Sans } from "next/font/google";

// Brand faces for the wizard only (venue templates keep their own). Both carry Bulgarian Cyrillic.
// Commissioner's FLAR axis gives headings slightly flared terminals: a painted-sign warmth on a grotesque skeleton.
const display = Commissioner({ subsets: ["latin", "cyrillic"], variable: "--font-brand-display", display: "swap", axes: ["FLAR"] });
const body = Sofia_Sans({ subsets: ["latin", "cyrillic"], variable: "--font-brand-body", display: "swap" });

export default function NewLayout({ children }: LayoutProps<"/new">) {
  return <div className={`sm-brand ${display.variable} ${body.variable} flex min-h-dvh flex-1 flex-col`}>{children}</div>;
}
