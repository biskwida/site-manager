<?php
// Reads the public Site Manager feed with a transient cache and a 24-hour "last good copy" fallback. Never throws.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Client
{
    public const OPTION = 'site_manager_settings';
    public const LAST_GOOD = 'site_manager_feed_last_good';
    private const STALE_TTL = 86400;
    private const TIMEOUT = 6;

    /** @return array{base_url: string, slug: string, cache_seconds: int, lang: string} */
    public static function settings(): array
    {
        $s = get_option(self::OPTION, []);
        $s = wp_parse_args(is_array($s) ? $s : [], ['base_url' => '', 'slug' => '', 'cache_seconds' => 30, 'lang' => 'auto']);
        return [
            'base_url' => untrailingslashit(trim((string) $s['base_url'])),
            'slug' => sanitize_key((string) $s['slug']),
            'cache_seconds' => max(5, min(3600, absint($s['cache_seconds']))),
            'lang' => in_array($s['lang'], ['bg', 'en', 'auto'], true) ? (string) $s['lang'] : 'auto',
        ];
    }

    public static function feed_url(): ?string
    {
        $s = self::settings();
        if ($s['base_url'] === '' || $s['slug'] === '') {
            return null;
        }
        return $s['base_url'] . '/api/site/' . rawurlencode($s['slug']);
    }

    private static function cache_key(string $url): string
    {
        return 'site_manager_feed_' . md5($url);
    }

    /**
     * @return array{state: array, now: string, stale: bool}|WP_Error
     */
    public static function fetch(bool $bypass_cache = false): array|WP_Error
    {
        $url = self::feed_url();
        if ($url === null) {
            return new WP_Error('site_manager_unconfigured', __('Site Manager is not configured yet: set the address and the venue code under Settings → Site Manager.', 'site-manager'));
        }
        $s = self::settings();
        $key = self::cache_key($url);
        if (!$bypass_cache) {
            $cached = get_transient($key);
            if (is_array($cached) && isset($cached['state'], $cached['now'])) {
                return ['state' => $cached['state'], 'now' => (string) $cached['now'], 'stale' => false];
            }
        }
        $res = wp_remote_get($url, ['timeout' => self::TIMEOUT, 'headers' => ['Accept' => 'application/json'], 'user-agent' => 'SiteManagerWP/' . SITE_MANAGER_VERSION]);
        $error = null;
        if (is_wp_error($res)) {
            $error = new WP_Error('site_manager_unavailable', sprintf(__('Site Manager did not answer: %s', 'site-manager'), $res->get_error_message()));
        } else {
            $code = wp_remote_retrieve_response_code($res);
            $body = json_decode(wp_remote_retrieve_body($res), true);
            if ($code === 404) {
                $error = new WP_Error('site_manager_unavailable', sprintf(__('Site Manager has no venue with the code "%s".', 'site-manager'), $s['slug']));
            } elseif ($code !== 200 || !is_array($body) || !isset($body['state']['venue'], $body['now'])) {
                $error = new WP_Error('site_manager_unavailable', sprintf(__('Site Manager answered with an unexpected response (HTTP %d).', 'site-manager'), (int) $code));
            } else {
                $value = ['state' => $body['state'], 'now' => (string) $body['now']];
                set_transient($key, $value, $s['cache_seconds']);
                update_option(self::LAST_GOOD, ['at' => time(), 'url' => $url] + $value, false);
                return $value + ['stale' => false];
            }
        }
        $last = get_option(self::LAST_GOOD, null);
        if (is_array($last) && ($last['url'] ?? '') === $url && isset($last['state'], $last['now'], $last['at']) && (int) $last['at'] + self::STALE_TTL > time()) {
            return ['state' => $last['state'], 'now' => (string) $last['now'], 'stale' => true];
        }
        return $error;
    }

    public static function clear_cache(): void
    {
        $url = self::feed_url();
        if ($url !== null) {
            delete_transient(self::cache_key($url));
        }
    }
}
