// src/destinations/wordpress-types.ts
// Types of the Site Manager WordPress plugin's REST namespace (the plugin's PHP returns exactly these keys).
export type WpBuilder = "gutenberg" | "classic" | "elementor" | "divi" | "unknown";
export interface WpPageSummary { id: number; title: string; slug: string; url: string; status: string; builder: WpBuilder; modified: string; featured_media: number | null; is_front_page: boolean }
export interface WpPageFields { title: string; content: string; elementor_data: string | null; featured_media: number | null }
export interface WpPage extends WpPageSummary, WpPageFields { text: string; texts: string[]; editable: boolean }
export interface WpReplacement { find: string; replace: string }
export interface WpPageEdit { title?: string; content?: string; replacements?: WpReplacement[]; featured_media?: number | null; placeholders?: Record<string, string> }
export interface WpPagePreview { before: WpPageFields; after: WpPageFields; preview_url: string | null; pending_key: string }
export interface WpPageApplied { id: number; url: string; revision_id: number | null; before: WpPageFields; after: WpPageFields }
export interface WpMedia { id: number; url: string; alt: string; existed: boolean }
export interface WpOptions { blogname: string; blogdescription: string; custom_logo: number | null; site_icon: number | null }
export type WpOptionKey = keyof WpOptions;
export interface WpMenuItem { id: number; title: string; url: string; parent_index: number | null; position: number; type: "custom" | "post_type"; object_id: number | null }
export interface WpMenuItemInput { title: string; url: string; parent_index?: number | null; type?: "custom" | "post_type"; object_id?: number | null }
export interface WpMenu { id: number; name: string; locations: string[]; items: WpMenuItem[] }
export interface WpProduct { id: number; name: string; regular_price: string; sale_price: string; stock_status: "instock" | "outofstock" | "onbackorder"; description: string; short_description: string; url: string }
export type WpProductPatch = Partial<Pick<WpProduct, "name" | "regular_price" | "sale_price" | "stock_status" | "description" | "short_description">>;
export interface WpSiteInfo {
  name: string; description: string; url: string; home_url: string; wp_version: string; plugin_version: string; locale: string; timezone: string;
  theme: { name: string; slug: string };
  pages: WpPageSummary[];
  menus: { id: number; name: string; locations: string[]; count: number }[];
  options: WpOptions;
  woocommerce: boolean;
  products: Pick<WpProduct, "id" | "name" | "regular_price" | "sale_price" | "stock_status">[];
  connected_user: { id: number; login: string } | null;
}

/** Shape of the `after`/`before` rows our Change entries keep for a page (contract fields plus display metadata). */
export interface WpPageChangeRow extends WpPageFields {
  page_title: string;
  page_url: string;
  replacements?: WpReplacement[];
  preview_url?: string | null;
}
