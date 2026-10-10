<?php
// Settings → Site Manager: the feed settings, a "Check connection" button and a shortcode cheat-sheet.
// Task 10 appends the connect box and the API log through the `site_manager_settings_after_form` action.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Settings
{
    public const PAGE = 'site-manager';

    public static function add_page(): void
    {
        add_options_page(__('Site Manager', 'site-manager'), __('Site Manager', 'site-manager'), 'manage_options', self::PAGE, [self::class, 'page']);
    }

    public static function register(): void
    {
        register_setting('site_manager', SM_Client::OPTION, ['type' => 'array', 'sanitize_callback' => [self::class, 'sanitize'], 'default' => []]);
        add_settings_section('site_manager_feed', __('Your venue in Site Manager', 'site-manager'), static function (): void {
            echo '<p>' . esc_html__('Copy both values from your Site Manager dashboard (the "WordPress" card).', 'site-manager') . '</p>';
        }, self::PAGE);
        self::field('base_url', __('Site Manager address', 'site-manager'), 'url', 'https://site-manager.example');
        self::field('slug', __('Venue code', 'site-manager'), 'text', 'my-cafe');
        self::field('cache_seconds', __('Refresh every (seconds)', 'site-manager'), 'number', '30');
        add_settings_field('lang', __('Language of the blocks', 'site-manager'), static function (): void {
            $s = SM_Client::settings();
            echo '<select name="' . esc_attr(SM_Client::OPTION) . '[lang]">';
            foreach (['auto' => __('Venue default', 'site-manager'), 'bg' => 'Български', 'en' => 'English'] as $value => $label) {
                echo '<option value="' . esc_attr($value) . '"' . selected($s['lang'], $value, false) . '>' . esc_html($label) . '</option>';
            }
            echo '</select><p class="description">' . esc_html__('Each shortcode or block can override this with lang="bg" or lang="en".', 'site-manager') . '</p>';
        }, self::PAGE, 'site_manager_feed');
        add_action('admin_post_site_manager_check', [self::class, 'handle_check']);
        add_action('admin_post_site_manager_code', [self::class, 'handle_code']);
        add_action('admin_post_site_manager_disconnect', [self::class, 'handle_disconnect']);
        add_action('site_manager_settings_after_form', [self::class, 'connect_box']);
    }

    private static function field(string $key, string $label, string $type, string $placeholder): void
    {
        add_settings_field($key, $label, static function () use ($key, $type, $placeholder): void {
            $s = SM_Client::settings();
            echo '<input class="regular-text" type="' . esc_attr($type) . '" name="' . esc_attr(SM_Client::OPTION) . '[' . esc_attr($key) . ']" value="' . esc_attr((string) $s[$key]) . '" placeholder="' . esc_attr($placeholder) . '"' . ($type === 'number' ? ' min="5" max="3600"' : '') . '>';
        }, self::PAGE, 'site_manager_feed');
    }

    /** @param mixed $in */
    public static function sanitize($in): array
    {
        $in = is_array($in) ? $in : [];
        $out = [
            'base_url' => untrailingslashit(esc_url_raw(trim((string) ($in['base_url'] ?? '')))),
            'slug' => sanitize_key((string) ($in['slug'] ?? '')),
            'cache_seconds' => max(5, min(3600, absint($in['cache_seconds'] ?? 30))),
            'lang' => in_array($in['lang'] ?? 'auto', ['bg', 'en', 'auto'], true) ? (string) $in['lang'] : 'auto',
        ];
        SM_Client::clear_cache();
        return $out;
    }

    public static function handle_check(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You are not allowed to do that.', 'site-manager'));
        }
        check_admin_referer('site_manager_check');
        $feed = SM_Client::fetch(true);
        $msg = is_wp_error($feed)
            ? ['error', $feed->get_error_message()]
            : ['success', sprintf(__('Connected: %s (%d menu items).', 'site-manager'), (string) ($feed['state']['venue']['name'] ?? ''), count($feed['state']['items'] ?? []))];
        wp_safe_redirect(add_query_arg(['page' => self::PAGE, 'sm_check' => $msg[0], 'sm_msg' => rawurlencode($msg[1])], admin_url('options-general.php')));
        exit;
    }

    public static function page(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        $s = SM_Client::settings();
        echo '<div class="wrap"><h1>' . esc_html__('Site Manager', 'site-manager') . '</h1>';
        if (isset($_GET['sm_check'], $_GET['sm_msg'])) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only
            $type = $_GET['sm_check'] === 'success' ? 'success' : 'error';
            echo '<div class="notice notice-' . esc_attr($type) . ' is-dismissible"><p>' . esc_html(rawurldecode(sanitize_text_field(wp_unslash((string) $_GET['sm_msg'])))) . '</p></div>';
        }
        echo '<form method="post" action="options.php">';
        settings_fields('site_manager');
        do_settings_sections(self::PAGE);
        submit_button();
        echo '</form>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="margin-top:-1em">';
        wp_nonce_field('site_manager_check');
        echo '<input type="hidden" name="action" value="site_manager_check">';
        submit_button(__('Check connection', 'site-manager'), 'secondary', 'submit', false);
        echo '</form>';
        echo '<h2>' . esc_html__('Shortcodes and blocks', 'site-manager') . '</h2>';
        echo '<p>' . esc_html__('Add a "Site Manager" block in the editor, or paste a shortcode anywhere:', 'site-manager') . '</p><ul>';
        foreach (['menu' => __('the full menu with prices, allergens and sold-out marks', 'site-manager'), 'specials' => __('today\'s specials', 'site-manager'), 'hours' => __('open-now status, opening hours, upcoming closures and contact', 'site-manager'), 'announcements' => __('current announcements', 'site-manager'), 'photos' => __('the photo gallery', 'site-manager')] as $block => $what) {
            echo '<li><code>[site_manager_' . esc_html($block) . ']</code> — ' . esc_html($what) . '</li>';
        }
        echo '<li><code>[site_manager_text key="welcome"]</code> — ' . esc_html__('one text: welcome, footer_note, tagline, about, address, phone, instagram or name', 'site-manager') . '</li></ul>';
        echo '<p>' . esc_html__('Add lang="bg" or lang="en" to any of them to force the language.', 'site-manager') . '</p>';
        do_action('site_manager_settings_after_form', $s);
        echo '</div>';
    }

    public static function handle_code(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You are not allowed to do that.', 'site-manager'));
        }
        check_admin_referer('site_manager_code');
        $code = SM_Auth::new_code(get_current_user_id());
        set_transient('site_manager_show_code_' . get_current_user_id(), $code, 900);
        wp_safe_redirect(add_query_arg(['page' => self::PAGE], admin_url('options-general.php')) . '#connect');
        exit;
    }

    public static function handle_disconnect(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You are not allowed to do that.', 'site-manager'));
        }
        check_admin_referer('site_manager_disconnect');
        SM_Auth::disconnect();
        wp_safe_redirect(add_query_arg(['page' => self::PAGE, 'sm_check' => 'success', 'sm_msg' => rawurlencode(__('Disconnected. The blocks keep working; the agent can no longer edit this site.', 'site-manager'))], admin_url('options-general.php')));
        exit;
    }

    public static function connect_box(array $settings): void
    {
        $conn = SM_Auth::connection();
        $code = get_transient('site_manager_show_code_' . get_current_user_id());
        echo '<h2 id="connect">' . esc_html__('Let the Site Manager agent edit this site', 'site-manager') . '</h2>';
        if ($conn) {
            $user = get_user_by('id', $conn['user_id']);
            echo '<p>' . esc_html(sprintf(__('Connected to venue "%1$s" since %2$s, acting as %3$s (token %4$s…).', 'site-manager'), $conn['venue_slug'], wp_date(get_option('date_format') . ' ' . get_option('time_format'), $conn['connected_at']), $user ? $user->user_login : '?', $conn['prefix'])) . '</p>';
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
            wp_nonce_field('site_manager_disconnect');
            echo '<input type="hidden" name="action" value="site_manager_disconnect">';
            submit_button(__('Disconnect', 'site-manager'), 'delete', 'submit', false);
            echo '</form>';
        } else {
            echo '<p>' . esc_html__('Generate a one-time code, then send the line below to the Site Manager bot in Telegram. The code is valid for 15 minutes. Nothing changes on this site until you approve each edit in Telegram.', 'site-manager') . '</p>';
            if (is_string($code) && $code !== '' && SM_Auth::code_info() !== null) {
                $line = '/connect ' . home_url('/') . ' ' . $code;
                echo '<p><input type="text" readonly class="large-text code" id="sm-connect-line" value="' . esc_attr($line) . '" onclick="this.select()"> ';
                echo '<button type="button" class="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById(\'sm-connect-line\').value)">' . esc_html__('Copy', 'site-manager') . '</button></p>';
                echo '<p class="description">' . esc_html(sprintf(__('Expires at %s.', 'site-manager'), wp_date(get_option('time_format'), SM_Auth::code_info()['expires']))) . '</p>';
            }
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
            wp_nonce_field('site_manager_code');
            echo '<input type="hidden" name="action" value="site_manager_code">';
            submit_button(__('Generate code', 'site-manager'), 'primary', 'submit', false);
            echo '</form>';
        }
        $log = SM_Auth::recent_log(20);
        echo '<h2>' . esc_html__('Recent API calls', 'site-manager') . '</h2>';
        if (!$log) {
            echo '<p class="description">' . esc_html__('None yet.', 'site-manager') . '</p>';
            return;
        }
        echo '<table class="widefat striped"><thead><tr><th>' . esc_html__('When', 'site-manager') . '</th><th>IP</th><th>' . esc_html__('Call', 'site-manager') . '</th><th>' . esc_html__('Status', 'site-manager') . '</th><th>ms</th></tr></thead><tbody>';
        foreach ($log as $e) {
            echo '<tr><td>' . esc_html(wp_date(get_option('date_format') . ' ' . get_option('time_format'), (int) $e['t'])) . '</td><td>' . esc_html((string) $e['ip']) . '</td><td><code>' . esc_html($e['m'] . ' ' . $e['r']) . '</code></td><td>' . (int) $e['s'] . '</td><td>' . (int) $e['ms'] . '</td></tr>';
        }
        echo '</tbody></table>';
    }
}
