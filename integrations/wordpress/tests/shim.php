<?php
// Minimal WordPress function shim for running the plugin's pure classes under php-cli (no WordPress).
declare(strict_types=1);

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}
if (!defined('SITE_MANAGER_VERSION')) {
    define('SITE_MANAGER_VERSION', 'test');
}
$GLOBALS['sm_test_options'] = [];
$GLOBALS['sm_test_transients'] = [];

class WP_Error
{
    public function __construct(public string $code = '', public string $message = '', public mixed $data = null) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}
function is_wp_error(mixed $v): bool { return $v instanceof WP_Error; }
function esc_html(mixed $s): string { return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function esc_attr(mixed $s): string { return esc_html($s); }
function esc_url(mixed $s): string { $s = (string) $s; return preg_match('#^(https?:|tel:|mailto:|/)#i', $s) ? esc_html($s) : ''; }
function __(string $s, string $d = 'default'): string { return $s; }
function esc_html__(string $s, string $d = 'default'): string { return esc_html($s); }
function esc_attr__(string $s, string $d = 'default'): string { return esc_attr($s); }
function _x(string $s, string $c, string $d = 'default'): string { return $s; }
function wp_kses_post(string $s): string { return $s; }
function sanitize_text_field(mixed $s): string { return trim(strip_tags((string) $s)); }
function sanitize_key(mixed $s): string { return preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) $s)) ?? ''; }
function absint(mixed $v): int { return abs((int) $v); }
function wp_json_encode(mixed $v, int $flags = 0): string|false { return json_encode($v, $flags | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }
function apply_filters(string $hook, mixed $v, mixed ...$args): mixed { return $v; }
function do_action(string $hook, mixed ...$args): void {}
function add_action(string $hook, mixed $cb, int $p = 10, int $a = 1): void {}
function add_filter(string $hook, mixed $cb, int $p = 10, int $a = 1): void {}
function add_shortcode(string $tag, mixed $cb): void {}
function shortcode_atts(array $pairs, array $atts, string $sc = ''): array { return array_merge($pairs, array_intersect_key($atts, $pairs)); }
function wp_enqueue_style(string $h): void {}
function wp_register_style(string $h, string $src, array $deps = [], mixed $ver = false): void {}
function current_user_can(string $cap): bool { return false; }
function get_option(string $k, mixed $default = false): mixed { return $GLOBALS['sm_test_options'][$k] ?? $default; }
function update_option(string $k, mixed $v, mixed $autoload = null): bool { $GLOBALS['sm_test_options'][$k] = $v; return true; }
function delete_option(string $k): bool { unset($GLOBALS['sm_test_options'][$k]); return true; }
function get_transient(string $k): mixed { return $GLOBALS['sm_test_transients'][$k] ?? false; }
function set_transient(string $k, mixed $v, int $ttl = 0): bool { $GLOBALS['sm_test_transients'][$k] = $v; return true; }
function delete_transient(string $k): bool { unset($GLOBALS['sm_test_transients'][$k]); return true; }
function wp_parse_args(mixed $args, array $defaults = []): array { return array_merge($defaults, is_array($args) ? $args : []); }
function wp_strip_all_tags(string $s): string { return trim(preg_replace('/\s+/', ' ', strip_tags($s)) ?? ''); }
function trailingslashit(string $s): string { return rtrim($s, '/') . '/'; }
function untrailingslashit(string $s): string { return rtrim($s, '/'); }
function esc_url_raw(string $s): string { return $s; }
function wp_remote_get(string $url, array $args = []): mixed { return $GLOBALS['sm_test_remote'] ?? new WP_Error('http_request_failed', 'no network in tests'); }
function wp_remote_retrieve_response_code(mixed $r): int { return is_array($r) ? ($r['response']['code'] ?? 0) : 0; }
function wp_remote_retrieve_body(mixed $r): string { return is_array($r) ? ($r['body'] ?? '') : ''; }
function wp_slash(mixed $v): mixed { return $v; }
function wp_unslash(mixed $v): mixed { return $v; }
function has_blocks(string $content): bool { return str_contains($content, '<!-- wp:'); }
function wp_hash_password(string $p): string { return password_hash($p, PASSWORD_DEFAULT); }
$GLOBALS['sm_test_attachments'] = []; // source_id => ['id' => int, 'url' => string]
function sm_test_find_attachment(string $source_id): ?array { return $GLOBALS['sm_test_attachments'][$source_id] ?? null; }
