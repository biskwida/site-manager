<?php
// Gutenberg wrappers around the shortcode renderers; the editor shows the server-rendered HTML.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Blocks
{
    public static function register(): void
    {
        wp_register_script('site-manager-blocks', SITE_MANAGER_URL . 'blocks/editor.js', ['wp-blocks', 'wp-element', 'wp-components', 'wp-block-editor', 'wp-server-side-render', 'wp-i18n'], SITE_MANAGER_VERSION, true);
        wp_set_script_translations('site-manager-blocks', 'site-manager', SITE_MANAGER_DIR . 'languages');
        foreach (SM_Shortcodes::BLOCKS as $block) {
            register_block_type(SITE_MANAGER_DIR . 'blocks/' . $block, [
                'render_callback' => static function (array $attributes) use ($block): string {
                    $atts = ['lang' => (string) ($attributes['lang'] ?? 'auto')];
                    if ($block === 'text') {
                        $atts['key'] = (string) ($attributes['key'] ?? 'welcome');
                    }
                    $html = SM_Shortcodes::render($block, $atts);
                    if ($html === '' && defined('REST_REQUEST') && REST_REQUEST) {
                        // Editor preview of an empty block (no specials today): say so instead of showing nothing.
                        return '<p class="sm sm-empty">' . esc_html__('Nothing to show right now; the block is hidden on the site.', 'site-manager') . '</p>';
                    }
                    return $html;
                },
            ]);
        }
        add_filter('block_categories_all', static function (array $categories): array {
            return $categories; // the blocks live in "widgets"; a custom category is not worth a translation entry
        });
    }
}
