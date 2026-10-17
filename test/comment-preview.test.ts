// test/comment-preview.test.ts — social_reply / social_moderate rows in the change engine and their preview lines.
import { describe, expect, it } from "vitest";
import { applyChange, invertChanges, planChange, validateChange } from "@/src/domain/changes";
import { commentPreviewLines, excerpt } from "@/src/domain/comment-preview";
import { countsTowardLimit } from "@/src/domain/limits";
import { renderPreview } from "@/src/domain/preview";
import { COMMENT_MODES, isExternalEntity, isSocialEntity, OP_NAMES, SOCIAL_ENTITIES, type Change } from "@/src/domain/types";
import { progressLabel } from "@/src/bot/progress";
import { state, TZ } from "./fixtures";

const reply: Change = {
  position: 0, op: "social_reply", entity: "social_reply", entity_id: "17890000000000001", before: null,
  after: { network: "instagram", comment_id: "17890000000000001", post_ref: "17950000000000002", author_name: "Мария", comment_text: "Имате ли безглутенови?", reply_text: "Да, имаме безглутенов хляб всеки ден." },
};
const hide: Change = {
  position: 0, op: "social_moderate", entity: "social_moderate", entity_id: "9001", before: null,
  after: { network: "facebook", comment_id: "9001", author_name: "Spam Bot", comment_text: "Buy followers at ...", action: "hide" },
};
const del: Change = { ...hide, after: { ...hide.after, action: "delete" } };

describe("comment entities in the change engine", () => {
  it("are external social entities and apply as no-ops", () => {
    expect(SOCIAL_ENTITIES).toEqual(["social_post", "social_reply", "social_moderate"]);
    expect(isSocialEntity("social_reply")).toBe(true);
    expect(isSocialEntity("wp_page")).toBe(false);
    expect(isExternalEntity("social_reply")).toBe(true);
    expect(isExternalEntity("social_moderate")).toBe(true);
    expect(COMMENT_MODES).toEqual(["each", "digest", "off"]);
    expect(OP_NAMES).toContain("set_comment_mode");
    const s = state();
    expect(applyChange(s, reply)).toEqual(s);
    expect(applyChange(s, hide)).toEqual(s);
    const [inv] = invertChanges([reply]);
    expect(inv).toMatchObject({ op: "social_reply", before: reply.after, after: null });
  });

  it("comment sets never count toward the monthly change limit", () => {
    expect(countsTowardLimit("comment")).toBe(false);
    expect(countsTowardLimit("text")).toBe(true);
    expect(countsTowardLimit("undo")).toBe(false);
  });

  it("a set made only of set_comment_mode rows keeps source text and still never counts", () => {
    const mode = { op: "set_comment_mode" } as const;
    expect(countsTowardLimit("text", [mode])).toBe(false);
    expect(countsTowardLimit("dashboard", [mode, mode])).toBe(false);
    expect(countsTowardLimit("text", [mode, { op: "set_price" }])).toBe(true);
    expect(countsTowardLimit("text", [])).toBe(true);
  });

  it("set_comment_mode is a venue change with both fields and a preview line", () => {
    const s = state();
    const ctx = { newId: () => "n", now: "2026-10-15T09:00:00.000Z" };
    expect(validateChange(s, { op: "set_comment_mode", mode: "digest", digest_hour: 10 }, ctx)).toBeNull();
    expect(validateChange(s, { op: "set_comment_mode", mode: "digest", digest_hour: 24 }, ctx)).toMatch(/digest_hour/);
    expect(validateChange(s, { op: "set_comment_mode", mode: "weekly" as never }, ctx)).toMatch(/mode/);
    const c = planChange(s, { op: "set_comment_mode", mode: "digest", digest_hour: 10 }, ctx);
    expect(c).toMatchObject({ entity: "venue", entity_id: s.venue.id, before: { comment_mode: "each", comment_digest_hour: 9 }, after: { comment_mode: "digest", comment_digest_hour: 10 } });
    expect(renderPreview(s, [c], "bg", TZ)).toBe("• Известия за коментари: при всеки → веднъж дневно в 10:00");
    expect(renderPreview(s, [c], "en", TZ)).toBe("• Comment notifications: each comment → once a day at 10:00");
    const off = planChange(s, { op: "set_comment_mode", mode: "off" }, ctx);
    expect(off.after).toEqual({ comment_mode: "off", comment_digest_hour: 9 });
    expect(renderPreview(s, [off], "bg", TZ)).toBe("• Известия за коментари: при всеки → изключени");
  });
});

describe("commentPreviewLines", () => {
  it("shows a reply as comment → reply, in both languages", () => {
    // The customer's name and words and the reply drafted for them are kept as written in any language (src/bot/translate.ts).
    expect(commentPreviewLines(reply, "bg")).toEqual(["• Отговор на коментар от ⟦Мария⟧ (Instagram): „⟦Имате ли безглутенови?⟧“ → „⟦Да, имаме безглутенов хляб всеки ден.⟧“"]);
    expect(commentPreviewLines(reply, "en")).toEqual(["• Reply to a comment by ⟦Мария⟧ (Instagram): “⟦Имате ли безглутенови?⟧” → “⟦Да, имаме безглутенов хляб всеки ден.⟧”"]);
    expect(renderPreview(state(), [reply], "bg", TZ)).toContain("Отговор на коментар от ⟦Мария⟧");
    expect(commentPreviewLines({ ...reply, after: { ...reply.after, author_name: "" } }, "en")[0]).toMatch(/^• Reply to a comment by a customer \(Instagram\)/); // no name: Claudia's words
  });
  it("shows an undo of a reply as a removal", () => {
    const [inv] = invertChanges([reply]);
    expect(commentPreviewLines(inv, "bg")).toEqual(["• Изтрива отговора на коментара от ⟦Мария⟧ (Instagram)"]);
    expect(commentPreviewLines(inv, "en")).toEqual(["• Deletes the reply to ⟦Мария⟧'s comment (Instagram)"]);
  });
  it("shows hide, delete (not undoable) and their undo rows", () => {
    expect(commentPreviewLines(hide, "bg")).toEqual(["• Скрива коментар от ⟦Spam Bot⟧ (Facebook): „⟦Buy followers at ...⟧“"]);
    expect(commentPreviewLines(hide, "en")).toEqual(["• Hides a comment by ⟦Spam Bot⟧ (Facebook): “⟦Buy followers at ...⟧”"]);
    expect(commentPreviewLines(del, "bg")).toEqual(["• Изтрива коментар от ⟦Spam Bot⟧ (Facebook): „⟦Buy followers at ...⟧“", "  (изтриването не може да се отмени)"]);
    expect(commentPreviewLines(del, "en")).toEqual(["• Deletes a comment by ⟦Spam Bot⟧ (Facebook): “⟦Buy followers at ...⟧”", "  (a deletion cannot be undone)"]);
    const [unhide] = invertChanges([hide]);
    expect(commentPreviewLines(unhide, "bg")).toEqual(["• Показва отново коментара от ⟦Spam Bot⟧ (Facebook)"]);
    expect(commentPreviewLines(unhide, "en")).toEqual(["• Shows ⟦Spam Bot⟧'s comment again (Facebook)"]);
    const [undel] = invertChanges([del]);
    expect(commentPreviewLines(undel, "bg")).toEqual(["• Коментарът от ⟦Spam Bot⟧ е изтрит и не може да бъде върнат (Facebook)"]);
    expect(commentPreviewLines(undel, "en")).toEqual(["• ⟦Spam Bot⟧'s comment was deleted and cannot be restored (Facebook)"]);
  });
  it("cuts long comments to one line of 60 characters", () => {
    expect(excerpt("a".repeat(80))).toBe(`${"a".repeat(59)}…`);
    expect(excerpt("first line\nsecond")).toBe("first line…");
    expect(excerpt("short")).toBe("short");
    const long = { ...reply, after: { ...reply.after, comment_text: "x".repeat(100) } };
    expect(commentPreviewLines(long, "bg")[0]).toContain(`„⟦${"x".repeat(59)}…⟧“`);
  });
  it("has progress labels for the comment tools", () => {
    expect(progressLabel("reply_to_comments", "bg")).toBe("💬 Подготвям отговора…");
    expect(progressLabel("list_comments", "en")).toBe("💬 Reading the comments…");
    expect(progressLabel("set_comment_mode", "en")).toBe("💬 Preparing the proposal…");
  });
});
