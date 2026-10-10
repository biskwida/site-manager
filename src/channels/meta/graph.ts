// Meta Graph API: the one version constant and the media fetch shape shared by the parser and the senders.
export const GRAPH = "https://graph.facebook.com/v25.0";
export type MediaFetch = (idOrUrl: string) => Promise<{ bytes: Uint8Array; contentType: string; name?: string }>;
