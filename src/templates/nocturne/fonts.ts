// Module scope on purpose: next/font/google must be called at the top level of a module.
import { Manrope, Unbounded } from "next/font/google";

/** Grotesk display with Cyrillic (verified subsets: cyrillic, cyrillic-ext, latin, latin-ext, vietnamese). */
export const display = Unbounded({ subsets: ["latin", "cyrillic"], variable: "--font-display", display: "swap", preload: false });
/** Body sans with Cyrillic (verified subsets: cyrillic, cyrillic-ext, greek, latin, latin-ext, vietnamese). */
export const body = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-body", display: "swap", preload: false });

/** Class string that defines --font-display and --font-body on the element it is applied to. */
export const fontVars = `${display.variable} ${body.variable}`;
