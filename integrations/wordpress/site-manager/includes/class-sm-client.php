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
    /** After a failed remote fetch, page views serve the last good copy (or the error) without calling out for this long. */
    private const FAIL_TTL = 60;
    /** @var array<string, array{state: array, now: string, stale: bool}|WP_Error> Results of this request, by feed URL. */
    private static array $memo = [];

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

    /**
     * A stored copy with the feed server's clock advanced by the time that has passed since it was fetched,
     * so open/closed status, sold-out marks and expiries stay correct while a cached or stale copy is served.
     *
     * @param array{state: array, now: string, fetched_at?: int} $copy
     * @return array{state: array, now: string}
     */
    private static function aged(array $copy): array
    {
        $base = strtotime((string) $copy['now']);
        $elapsed = max(0, time() - (int) ($copy['fetched_at'] ?? time()));
        $now = $base === false ? (string) $copy['now'] : gmdate('Y-m-d\TH:i:s\Z', $base + $elapsed);
        return ['state' => $copy['state'], 'now' => $now];
    }

    private static function cache_key(string $url): string
    {
        return 'site_manager_feed_' . md5($url);
    }

    private static function fail_key(string $url): string
    {
        return 'site_manager_feed_fail_' . md5($url);
    }

    /** Forgets this request's results (tests; also after the settings change). */
    public static function reset_memo(): void
    {
        self::$memo = [];
    }

    /** The last good copy for $url (aged, marked stale) when it is younger than a day, else null. */
    private static function last_good(string $url): ?array
    {
        $last = get_option(self::LAST_GOOD, null);
        if (is_array($last) && ($last['url'] ?? '') === $url && isset($last['state'], $last['now'], $last['at']) && (int) $last['at'] + self::STALE_TTL > time()) {
            return self::aged($last) + ['stale' => true];
        }
        return null;
    }

    /**
     * Several blocks on one page share one result per request (unless $bypass_cache, the settings page's
     * "Check connection"), and for a minute after a failed remote fetch no page view calls out again.
     *
     * @return array{state: array, now: string, stale: bool}|WP_Error
     */
    public static function fetch(bool $bypass_cache = false): array|WP_Error
    {
        $url = self::feed_url();
        if ($url === null) {
            return new WP_Error('site_manager_unconfigured', __('Site Manager is not configured yet: set the address and the venue code under Settings → Site Manager.', 'site-manager'));
        }
        if ($bypass_cache) {
            return self::fetch_uncached($url, true);
        }
        if (!isset(self::$memo[$url])) {
            self::$memo[$url] = self::fetch_uncached($url, false);
        }
        return self::$memo[$url];
    }

    /** @return array{state: array, now: string, stale: bool}|WP_Error */
    private static function fetch_uncached(string $url, bool $bypass_cache): array|WP_Error
    {
        $s = self::settings();
        $key = self::cache_key($url);
        if (!$bypass_cache) {
            $cached = get_transient($key);
            if (is_array($cached) && isset($cached['state'], $cached['now'])) {
                return self::aged($cached) + ['stale' => false];
            }
            $failed = get_transient(self::fail_key($url));
            if (is_array($failed)) {
                return self::last_good($url) ?? new WP_Error((string) ($failed['code'] ?? 'site_manager_unavailable'), (string) ($failed['message'] ?? ''));
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
                $stored = $value + ['fetched_at' => time()];
                set_transient($key, $stored, $s['cache_seconds']);
                update_option(self::LAST_GOOD, ['at' => time(), 'url' => $url] + $stored, false);
                delete_transient(self::fail_key($url));
                return $value + ['stale' => false];
            }
        }
        set_transient(self::fail_key($url), ['code' => $error->get_error_code(), 'message' => $error->get_error_message()], self::FAIL_TTL);
        return self::last_good($url) ?? $error;
    }

    public static function clear_cache(): void
    {
        $url = self::feed_url();
        if ($url !== null) {
            delete_transient(self::cache_key($url));
            delete_transient(self::fail_key($url));
            unset(self::$memo[$url]);
        }
    }
}
