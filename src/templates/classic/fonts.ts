// next/font/google at module scope; both subsets include Cyrillic (Bulgarian is the default language).
import { Literata, Onest } from "next/font/google";

export const display = Literata({ subsets: ["latin", "cyrillic"], variable: "--font-display", display: "swap", axes: ["opsz"] });
export const body = Onest({ subsets: ["latin", "cyrillic"], variable: "--font-body", display: "swap" });
/** Class string that defines --font-display and --font-body on the element it is applied to. */
export const fontVars = `${display.variable} ${body.variable}`;
