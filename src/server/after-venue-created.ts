// src/server/after-venue-created.ts
// Server-only. The ONE place that runs when a venue has just been created for a signed-in account: a path B/C venue made by
// /start (createOwnVenue), or a wizard venue published by a signed-in owner (publishDraft, path A). It does nothing yet.
// Billing (Task 6) starts the free trial here: add its call below and nothing else has to change. Never throw from it: the venue
// is already live, so a failure here must not undo or hide it (log and carry on).
import type { Venue } from "../domain/types";

export async function afterVenueCreated(venue: Venue): Promise<void> {
  void venue;
}
