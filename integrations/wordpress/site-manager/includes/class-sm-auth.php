<?php
// Connect code, plugin token, bearer check, rate limits, impersonation and the API log ring buffer.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Auth
{
    public const OPT_CODE = 'site_manager_connect_code';
    public const OPT_TOKEN = 'site_manager_token';
    public const OPT_LOG = 'site_manager_api_log';
    private const CODE_TTL = 900;
    private const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    private const LOG_SIZE = 50;

    /** A fresh one-time code for the owner to send to the bot; stored hashed with its expiry and the admin's id. */
    public static function new_code(int $user_id): string
    {
        $code = '';
        for ($i = 0; $i < 10; $i++) {
            $code .= self::CODE_ALPHABET[random_int(0, strlen(self::CODE_ALPHABET) - 1)];
        }
        update_option(self::OPT_CODE, ['hash' => hash('sha256', $code), 'expires' => time() + self::CODE_TTL, 'user_id' => $user_id], false);
        return $code;
    }

    /** @return ?array{expires: int, user_id: int} */
    public static function code_info(): ?array
    {
        $c = get_option(self::OPT_CODE, null);
        return is_array($c) && (int) ($c['expires'] ?? 0) > time() ? ['expires' => (int) $c['expires'], 'user_id' => (int) $c['user_id']] : null;
    }

    /** Exchanges a valid code for a new token (returned once; only its hash is kept). */
    public static function redeem_code(string $code, string $slug): string|WP_Error
    {
        $c = get_option(self::OPT_CODE, null);
        $settings = SM_Client::settings();
        $normalised = strtoupper(trim($code));
        if (!is_array($c) || (int) ($c['expires'] ?? 0) < time() || !hash_equals((string) ($c['hash'] ?? ''), hash('sha256', $normalised))) {
            return new WP_Error('sm_forbidden', 'The code is wrong or expired. Generate a new one on the plugin\'s settings page.', ['status' => 403]);
        }
        if ($settings['slug'] === '' || $slug !== $settings['slug']) {
            return new WP_Error('sm_forbidden', sprintf('This plugin is configured for the venue "%s".', $settings['slug']), ['status' => 403]);
        }
        $user = get_user_by('id', (int) $c['user_id']);
        if (!$user || !user_can($user, 'edit_pages')) {
            return new WP_Error('sm_forbidden', 'The WordPress user who generated the code can no longer edit pages.', ['status' => 403]);
        }
        $token = bin2hex(random_bytes(32));
        update_option(self::OPT_TOKEN, ['hash' => hash('sha256', $token), 'prefix' => substr($token, 0, 6), 'user_id' => (int) $c['user_id'], 'connected_at' => time(), 'venue_slug' => $slug], false);
        delete_option(self::OPT_CODE);
        return $token;
    }

    public static function disconnect(): void
    {
        delete_option(self::OPT_TOKEN);
        delete_option(self::OPT_CODE);
    }

    /** @return ?array{prefix: string, user_id: int, connected_at: int, venue_slug: string} */
    public static function connection(): ?array
    {
        $t = get_option(self::OPT_TOKEN, null);
        return is_array($t) && !empty($t['hash']) ? ['prefix' => (string) $t['prefix'], 'user_id' => (int) $t['user_id'], 'connected_at' => (int) $t['connected_at'], 'venue_slug' => (string) ($t['venue_slug'] ?? '')] : null;
    }

    public static function client_ip(): string
    {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
        return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '0.0.0.0';
    }

    /** Fixed one-minute windows in a transient: `$max` calls per bucket per minute. */
    public static function rate_limit(string $bucket, int $max): true|WP_Error
    {
        $key = 'site_manager_rl_' . md5($bucket . '|' . (int) floor(time() / 60));
        $n = (int) get_transient($key) + 1;
        set_transient($key, $n, 120);
        if ($n > $max) {
            return new WP_Error('sm_rate_limited', 'Too many requests; try again in a minute.', ['status' => 429]);
        }
        return true;
    }

    /** Bearer token check with a constant-time compare, then runs the request as the connecting admin. */
    public static function permission(WP_REST_Request $r): true|WP_Error
    {
        $rl = self::rate_limit('api|' . self::client_ip(), 120);
        if (is_wp_error($rl)) {
            return $rl;
        }
        $header = (string) $r->get_header('authorization');
        if (!preg_match('/^Bearer\s+([a-f0-9]{64})$/i', trim($header), $m)) {
            return new WP_Error('sm_unauthorized', 'Missing or invalid plugin token.', ['status' => 401]);
        }
        $t = get_option(self::OPT_TOKEN, null);
        if (!is_array($t) || empty($t['hash']) || !hash_equals((string) $t['hash'], hash('sha256', strtolower($m[1])))) {
            return new WP_Error('sm_unauthorized', 'Missing or invalid plugin token.', ['status' => 401]);
        }
        $user = get_user_by('id', (int) ($t['user_id'] ?? 0));
        if (!$user || !user_can($user, 'edit_pages')) {
            return new WP_Error('sm_forbidden', 'The connected WordPress user can no longer edit pages; reconnect from the settings page.', ['status' => 403]);
        }
        wp_set_current_user($user->ID);
        return true;
    }

    public static function handshake_permission(WP_REST_Request $r): true|WP_Error
    {
        return self::rate_limit('handshake|' . self::client_ip(), 5);
    }

    public static function log(string $method, string $route, int $status, float $ms): void
    {
        $log = get_option(self::OPT_LOG, []);
        $log = is_array($log) ? $log : [];
        $log[] = ['t' => time(), 'ip' => self::client_ip(), 'm' => $method, 'r' => $route, 's' => $status, 'ms' => (int) round($ms)];
        if (count($log) > self::LOG_SIZE) {
            $log = array_slice($log, -self::LOG_SIZE);
        }
        update_option(self::OPT_LOG, $log, false);
    }

    public static function recent_log(int $n = 20): array
    {
        $log = get_option(self::OPT_LOG, []);
        return is_array($log) ? array_reverse(array_slice($log, -$n)) : [];
    }
}
