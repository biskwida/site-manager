// src/agent/wp-tool-schemas.ts
import { z } from "zod";

const Summary = {
  summary_bg: z.string().min(1).describe("One line in Bulgarian, e.g. „Нов текст на страница „За нас““"),
  summary_en: z.string().min(1).describe("The same line in English"),
};
export const WpPhotoSchema = z.object({
  media_id: z.string().min(1).describe("A media_id of a photo the owner sent to the bot"),
  alt_bg: z.string().min(1).describe("Short alt text in Bulgarian"),
  alt_en: z.string().min(1).describe("Short alt text in English"),
  as_featured: z.boolean().optional().describe("true = becomes the page's featured image"),
});
export const WpReadPageSchema = z.object({ page_id: z.number().int().positive() });
export const WpEditPageSchema = z.object({
  ...Summary,
  page_id: z.number().int().positive().describe("An id from wp_list_site"),
  title: z.string().optional().describe("New page title"),
  content: z.string().optional().describe("Full new content (Gutenberg block HTML or plain HTML). Prefer replacements for small edits. Not allowed on Elementor pages."),
  replacements: z.array(z.object({ find: z.string().min(1).describe("Exact text copied from the page (wp_read_page content), long enough to occur once"), replace: z.string() })).max(20).optional(),
  photos: z.array(WpPhotoSchema).max(10).optional().describe("Photos to upload with this edit; reference them in content as {{sm_media_url:<media_id>}} (img src) and {{sm_media_id:<media_id>}} (Gutenberg image id)"),
});
export const WpUploadPhotoSchema = z.object({
  ...Summary,
  ...WpPhotoSchema.shape,
  page_id: z.number().int().positive().optional().describe("Page that gets this photo as its featured image (with as_featured true)"),
});
export const WpSetOptionSchema = z.object({
  ...Summary,
  key: z.enum(["blogname", "blogdescription", "custom_logo", "site_icon"]),
  value: z.string().nullable().optional().describe("For blogname/blogdescription: the new text. For custom_logo/site_icon: null to remove, or omit and pass media_id"),
  media_id: z.string().optional().describe("For custom_logo/site_icon: a media_id of a photo the owner sent"),
  alt_bg: z.string().optional(),
  alt_en: z.string().optional(),
});
export const WpEditMenuSchema = z.object({
  ...Summary,
  menu_id: z.number().int().positive().describe("An id from wp_list_site"),
  items: z.array(z.object({ title: z.string().min(1), url: z.string().min(1), parent_index: z.number().int().min(0).nullable().optional().describe("Index of the parent item in this list, or null") })).min(1).max(40).describe("The complete new list of items, in order"),
});
export const WpEditProductSchema = z.object({
  ...Summary,
  product_id: z.number().int().positive(),
  patch: z.object({
    name: z.string().optional(),
    regular_price: z.string().optional().describe("Decimal as text, e.g. \"13.50\""),
    sale_price: z.string().optional().describe("Empty string removes the sale price"),
    stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
    description: z.string().optional(),
    short_description: z.string().optional(),
  }),
});
