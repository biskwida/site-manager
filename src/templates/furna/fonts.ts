// Module scope on purpose: next/font/google must be called at the top level of a module.
import { Arsenal, Yeseva_One } from "next/font/google";

/** Shop-sign display face with Cyrillic (verified subsets: cyrillic, cyrillic-ext, latin, latin-ext, vietnamese; one weight, 400). */
export const display = Yeseva_One({ subsets: ["latin", "cyrillic"], weight: "400", variable: "--font-display", display: "swap" });
/** Warm humanist body face with Cyrillic (verified subsets: cyrillic, cyrillic-ext, latin, latin-ext, vietnamese; 400 and 700). */
export const body = Arsenal({ subsets: ["latin", "cyrillic"], weight: ["400", "700"], variable: "--font-body", display: "swap" });

/** Class string that defines --font-display and --font-body on the element it is applied to. */
export const fontVars = `${display.variable} ${body.variable}`;
