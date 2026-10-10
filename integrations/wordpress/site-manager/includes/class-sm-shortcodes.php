<?php
// [site_manager_menu|specials|hours|announcements|photos lang=bg|en|auto] and [site_manager_text key=welcome lang=…].
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Shortcodes
{
    public const BLOCKS = ['menu', 'specials', 'hours', 'announcements', 'photos', 'text'];

    public static function register(): void
    {
        foreach (self::BLOCKS as $block) {
            add_shortcode('site_manager_' . $block, static fn($atts): string => self::render($block, is_array($atts) ? $atts : []));
        }
    }

    /** Shared by shortcodes and the Gutenberg blocks' render callbacks. Never throws, never breaks the page. */
    public static function render(string $block, array $atts): string
    {
        if (!in_array($block, self::BLOCKS, true)) {
            return '';
        }
        $atts = shortcode_atts(['lang' => '', 'key' => 'welcome'], array_change_key_case($atts, CASE_LOWER), 'site_manager_' . $block);
        $feed = SM_Client::fetch();
        if (is_wp_error($feed)) {
            return SM_Render::unavailable($feed);
        }
        $settings = SM_Client::settings();
        $lang = SM_Labels::lang((string) $atts['lang'] ?: $settings['lang'], $feed['state']);
        wp_enqueue_style('site-manager');
        $html = $block === 'text'
            ? SM_Render::text($feed['state'], sanitize_key((string) $atts['key']), $lang)
            : SM_Render::{$block}($feed['state'], $feed['now'], $lang);
        if (!empty($feed['stale'])) {
            $html = '<!-- Site Manager: feed unavailable, showing the last good copy -->' . $html;
        }
        return $html;
    }
}
