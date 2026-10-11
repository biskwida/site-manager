// Module scope on purpose: next/font/google must be called at the top level of a module.
import { Brygada_1918, Wix_Madefor_Text } from "next/font/google";

/** Old-style book serif cut from 1918 Polish type, with Cyrillic (verified subsets: cyrillic, cyrillic-ext, greek, latin, latin-ext,
 *  vietnamese; variable wght 400–700, the template uses 500 and 700). Title, course and section headings, the dish of the day. */
export const display = Brygada_1918({ subsets: ["latin", "cyrillic"], variable: "--font-display", display: "swap", preload: false });
/** Warm humanist sans with Cyrillic (verified subsets: cyrillic, cyrillic-ext, latin, latin-ext, vietnamese; variable wght 400–800,
 *  the template uses 400, 600 and 700). Body, item names, prices, buttons. */
export const body = Wix_Madefor_Text({ subsets: ["latin", "cyrillic"], variable: "--font-body", display: "swap", preload: false });

/** Class string that defines --font-display and --font-body on the element it is applied to. */
export const fontVars = `${display.variable} ${body.variable}`;
