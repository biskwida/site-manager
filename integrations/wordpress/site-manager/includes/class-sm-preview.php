<?php
// Renders a page with its pending Site Manager edit when ?sm_preview=<key> matches; never affects normal visitors.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Preview
{
    private static ?array $pending = null;
    private static int $post_id = 0;

    public static function register(): void
    {
        if (!isset($_GET['sm_preview'])) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- the key is the credential
            return;
        }
        add_action('wp', [self::class, 'arm']);
    }

    public static function arm(): void
    {
        $post = get_queried_object();
        if (!$post instanceof WP_Post) {
            return;
        }
        $pending = get_post_meta($post->ID, SM_Pages::PENDING_META, true);
        $key = (string) sanitize_text_field(wp_unslash((string) ($_GET['sm_preview'] ?? ''))); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
        if (!is_array($pending) || (int) ($pending['expires'] ?? 0) < time() || !hash_equals((string) ($pending['key'] ?? ''), $key)) {
            return;
        }
        self::$pending = $pending['after'];
        self::$post_id = (int) $post->ID;
        nocache_headers();
        add_filter('the_title', [self::class, 'title'], 10, 2);
        add_filter('the_content', [self::class, 'content'], 1);
        add_filter('post_thumbnail_id', [self::class, 'thumbnail'], 10, 2);
        add_action('wp_head', static function (): void {
            echo '<meta name="robots" content="noindex,nofollow">' . "\n";
        });
        add_action('wp_body_open', static function (): void {
            wp_enqueue_style('site-manager');
            echo '<div class="sm-preview-banner">' . esc_html('Предварителен преглед от Site Manager · Preview from Site Manager, not published') . '</div>';
        });
    }

    public static function title(string $title, int $id = 0): string
    {
        return $id === self::$post_id && self::$pending !== null ? (string) self::$pending['title'] : $title;
    }

    public static function content(string $content): string
    {
        if (self::$pending === null || (int) get_the_ID() !== self::$post_id) {
            return $content;
        }
        return (string) self::$pending['content'];
    }

    public static function thumbnail($id, $post)
    {
        $pid = $post instanceof WP_Post ? (int) $post->ID : (int) $post;
        if (self::$pending === null || $pid !== self::$post_id || !array_key_exists('featured_media', self::$pending)) {
            return $id;
        }
        return self::$pending['featured_media'] ?? 0;
    }
}
