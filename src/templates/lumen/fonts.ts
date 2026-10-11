// Module scope on purpose: next/font/google must be called at the top level of a module.
import { Golos_Text, Playfair_Display } from "next/font/google";

/** High-contrast serif display with Cyrillic (verified subsets: cyrillic, latin, latin-ext, vietnamese). Italic is used for the tagline. */
export const display = Playfair_Display({ subsets: ["latin", "cyrillic"], style: ["normal", "italic"], variable: "--font-display", display: "swap" });
/** Humanist sans with Cyrillic (verified subsets: cyrillic, cyrillic-ext, latin, latin-ext). */
export const body = Golos_Text({ subsets: ["latin", "cyrillic"], variable: "--font-body", display: "swap" });

/** Class string that defines --font-display and --font-body on the element it is applied to. */
export const fontVars = `${display.variable} ${body.variable}`;
