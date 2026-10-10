// test/wp-errors.test.ts
import { describe, expect, it } from "vitest";
import { wpErrorText } from "@/src/destinations/wp-errors";

describe("wpErrorText", () => {
  it("maps the known plugin codes to text in both languages", () => {
    expect(wpErrorText("sm_unauthorized: Missing or invalid plugin token.", "bg")).toBe("връзката с WordPress вече не е валидна; свържете сайта отново с /connect");
    expect(wpErrorText("sm_unauthorized: Missing or invalid plugin token.", "en")).toBe("the WordPress connection is no longer valid; reconnect with /connect");
    expect(wpErrorText('sm_replace_failed: "x" occurs 0 times; it must occur exactly once.', "bg")).toBe("текстът на страницата е променен; поискайте промяната отново");
    expect(wpErrorText('sm_replace_failed: "x" occurs 0 times; it must occur exactly once.', "en")).toBe("the page text has changed; ask for the change again");
    expect(wpErrorText("sm_upload_failed: could not download", "bg")).toBe("снимката не можа да се качи");
    expect(wpErrorText("sm_upload_failed: could not download", "en")).toBe("the photo could not be uploaded");
    expect(wpErrorText("sm_builder_unsupported: Elementor pages take replacements, not full content.", "bg")).toBe("тази страница е направена с редактор, който не поддържаме");
    expect(wpErrorText("sm_builder_unsupported: Elementor pages take replacements, not full content.", "en")).toBe("this page uses an editor we do not support");
  });
  it("keeps the message for anything else, and passes old rows without a code through", () => {
    expect(wpErrorText("sm_not_found: No such page.", "bg")).toBe("No such page.");
    expect(wpErrorText("sm_unreachable: WordPress unreachable: fetch failed", "en")).toBe("WordPress unreachable: fetch failed");
    expect(wpErrorText("WordPress unreachable: fetch failed", "en")).toBe("WordPress unreachable: fetch failed");
    expect(wpErrorText("destination not found", "bg")).toBe("destination not found");
    expect(wpErrorText(null, "bg")).toBe("");
  });
});
