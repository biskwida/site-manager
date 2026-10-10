// Module scope on purpose: next/font/google must be called at the top level of a module.
import { Fira_Sans, Geologica } from "next/font/google";

/** Geometric grotesk display with Cyrillic (verified subsets: cyrillic, cyrillic-ext, greek, latin, latin-ext, vietnamese).
 *  Variable (wght 100-900): the page uses 600, 800 and 900. */
export const display = Geologica({ subsets: ["latin", "cyrillic"], variable: "--font-display", display: "swap" });
/** Humanist sans with Cyrillic (verified subsets: cyrillic, cyrillic-ext, greek, greek-ext, latin, latin-ext, vietnamese).
 *  Static weights; 400, 500 and 700 are the ones the page sets. */
export const body = Fira_Sans({ subsets: ["latin", "cyrillic"], weight: ["400", "500", "700"], variable: "--font-body", display: "swap" });

/** Class string that defines --font-display and --font-body on the element it is applied to. */
export const fontVars = `${display.variable} ${body.variable}`;
