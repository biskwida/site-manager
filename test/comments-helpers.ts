// test/comments-helpers.ts — a demo venue with Facebook and Instagram connected to the fake Meta server, the store hook wired,
// and a published post on both networks (so sync rows hold Meta's post/media ids). Shared by the comments tests.
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import type { SyncDeps } from "@/src/destinations/sync";
import type { Change, SocialTarget } from "@/src/domain/types";
import { InMemoryStore } from "@/src/store/memory";
import type { Store } from "@/src/store/types";
import { FakeMeta } from "./fake-meta";
import { FakeMessenger, makeDemo, type Demo } from "./helpers";

export const KEY = parseSecretKey("ab".repeat(32));
export const T0 = new Date("2026-10-15T09:00:00.000Z"); // Thu 15 Oct 2026, 12:00 Sofia
export const at = (ms: number) => new Date(T0.getTime() + ms);
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const IMAGE = "https://media.example/v1/m-1.jpg";

export interface Connected extends Demo {
  /** The store with the destination hook (applyChangeSet pushes). */
  store: Store & Demo["store"];
  raw: Demo["store"];
  meta: FakeMeta;
  page: ReturnType<FakeMeta["addPage"]>;
  ig: ReturnType<FakeMeta["addInstagramUser"]>;
  d: SyncDeps;
  logs: string[];
  messenger: FakeMessenger;
  /** Publishes one social_post to the given targets at `now` and returns the Meta ids. */
  publishPost: (targets: SocialTarget[], caption?: string, now?: Date) => Promise<{ cs: { id: string }; fbPostId: string | null; igMediaId: string | null }>;
}

export async function connectedVenue(opts: { facebook?: boolean; instagram?: boolean; now?: () => Date } = {}): Promise<Connected> {
  // One clock for the fake Meta server, the store hook and the memory store's created_at: publishPost(now) moves it for the apply.
  // It is set before the demo is seeded, so the venue, its members and everything after are stamped from T0, never wall time.
  const clock = { now: opts.now ?? (() => T0) };
  const nowFn = () => clock.now();
  const raw = new InMemoryStore();
  let tick = 0;
  raw.clock = () => new Date(nowFn().getTime() + tick++).toISOString();
  const demo = await makeDemo(raw);
  const meta = new FakeMeta();
  const page = meta.addPage("Кафе Агала");
  const ig = meta.addInstagramUser("agala.cafe");
  meta.now = nowFn;
  if (opts.facebook !== false) await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "facebook", config: { page_id: page.id, page_name: page.name, connected_at: T0.toISOString(), comments: true }, secrets: encryptSecrets({ page_token: page.access_token }, KEY) });
  if (opts.instagram !== false) await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "instagram", config: { ig_user_id: ig.user_id, username: ig.username, connected_at: T0.toISOString(), token_refreshed_at: T0.toISOString(), comments: true }, secrets: encryptSecrets({ token: ig.token }, KEY) });
  const logs: string[] = [];
  const d: SyncDeps = { store: demo.store, secretKey: KEY, fetch: meta.fetch, log: (s: string) => logs.push(s), sleep: async () => undefined };
  const store = withDestinationSync(demo.store, d, nowFn) as Connected["store"];
  const messenger = new FakeMessenger();
  const publishPost: Connected["publishPost"] = async (targets, caption = "Днешното предложение: тиквена супа", now = nowFn()) => {
    const change: Change = { position: 0, op: "social_post", entity: "social_post", entity_id: "m-1", before: null, after: { media_id: "m-1", image_url: IMAGE, caption, targets } };
    const prev = clock.now;
    clock.now = () => now;
    try {
      const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_ref: "tg:1001", summary_bg: "Публикация", summary_en: "Post", preview_bg: "p", preview_en: "p", source: "photo", status: "proposed", changes: [change] });
      const before = { fb: new Set(meta.posts.keys()), ig: new Set(meta.igMedia.keys()) };
      if ((await store.applyChangeSet(cs.id, now.toISOString())) !== "applied") throw new Error("publish failed");
      const fbPostId = [...meta.posts.values()].find((p) => p.kind === "photo" && !before.fb.has(p.post_id))?.post_id ?? null;
      const igMediaId = [...meta.igMedia.values()].find((m) => m.media_type === "IMAGE" && !before.ig.has(m.id))?.id ?? null;
      return { cs, fbPostId, igMediaId };
    } finally {
      clock.now = prev;
    }
  };
  return { ...demo, store, raw: demo.store, meta, page, ig, d, logs, messenger, publishPost };
}
