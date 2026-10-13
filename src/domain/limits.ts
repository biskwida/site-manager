// src/domain/limits.ts
// Monthly change limit (pricing plans: Menu 40, Everywhere 150 changes a month).
//
// Definitions:
// - One "change" is one change set that reaches status `applied`, whatever the number of rows inside it. A set that was
//   applied and later undone still counts (it reached `applied`); scheduled sets count when they are applied.
// - Sets with source "undo" never count: undo is a safety feature. Sets with source "auto" never count either: the tick
//   writes them when a sold-out mark or a special runs out, so they only record what the owner already decided.
// - Rejected, expired and cancelled sets never reached `applied`, so they do not count.
// - The month is the calendar month in the venue's time zone (venue.tz, e.g. Europe/Sofia).
// - Venue.change_limit null = unlimited (the default).
import { localDate, zonedToIso } from "../time";
import type { ChangeSource } from "./types";

export interface LimitState {
  used: number;
  /** null = unlimited. */
  limit: number | null;
  /** null when unlimited; never negative. */
  remaining: number | null;
  reached: boolean;
}

/** The venue's current calendar month as [from, to) ISO instants: local midnight on the 1st to local midnight on the next 1st. */
export function monthWindow(now: Date, tz: string): { from: string; to: string } {
  const [y, m] = localDate(now, tz).split("-").map(Number);
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const first = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;
  return { from: zonedToIso(first(y, m), "00:00", tz), to: zonedToIso(first(next.y, next.m), "00:00", tz) };
}

export function limitState(used: number, limit: number | null): LimitState {
  if (limit === null) return { used, limit: null, remaining: null, reached: false };
  return { used, limit, remaining: Math.max(0, limit - used), reached: used >= limit };
}

/** Whether an applied set of this source uses up one change of the month. */
export function countsTowardLimit(source: ChangeSource): boolean {
  return source !== "undo" && source !== "auto";
}

/** Parses a --change-limit argument: "none" (or "null", "unlimited") clears the limit, a whole number >= 0 sets it; anything else is an Error. */
export function parseChangeLimit(raw: string): number | null | Error {
  const v = raw.trim().toLowerCase();
  if (v === "none" || v === "null" || v === "unlimited") return null;
  if (!/^\d{1,6}$/.test(v)) return new Error(`--change-limit must be a whole number >= 0 or "none", got "${raw}"`);
  return Number(v);
}
