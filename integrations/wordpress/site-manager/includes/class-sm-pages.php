<?php
// Page builders, before/after computation, placeholders and the actual write. Pure parts are testable without WordPress.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Pages
{
    public const PENDING_META = '_site_manager_pending';
    public const SOURCE_META = '_site_manager_source_id';
    private const PLACEHOLDER = '/\{\{sm_media_(url|id):([^}]+)\}\}/';
    /** @var callable(string): ?array{id: int, url: string} */
    public static $attachment_lookup = [self::class, 'find_attachment'];

    public static function builder_of(WP_Post $p): string
    {
        if (get_post_meta($p->ID, '_elementor_edit_mode', true) === 'builder' && get_post_meta($p->ID, '_elementor_data', true) !== '') {
            return 'elementor';
        }
        if (get_post_meta($p->ID, '_et_pb_use_builder', true) === 'on') {
            return 'divi';
        }
        // Bricks, Oxygen and Beaver Builder keep the page in meta this plugin cannot edit: read-only ("unknown").
        if (get_post_meta($p->ID, '_bricks_editor_mode', true) === 'bricks' || get_post_meta($p->ID, 'ct_builder_shortcodes', true) !== '' || get_post_meta($p->ID, '_fl_builder_enabled', true)) {
            return 'unknown';
        }
        return has_blocks((string) $p->post_content) ? 'gutenberg' : 'classic';
    }

    public static function fields(WP_Post $p): array
    {
        $el = get_post_meta($p->ID, '_elementor_data', true);
        $thumb = (int) get_post_thumbnail_id($p);
        return ['title' => (string) $p->post_title, 'content' => (string) $p->post_content, 'elementor_data' => is_string($el) && $el !== '' ? $el : null, 'featured_media' => $thumb > 0 ? $thumb : null];
    }

    public static function summary(WP_Post $p): array
    {
        $f = self::fields($p);
        return [
            'id' => (int) $p->ID,
            'title' => $f['title'],
            'slug' => (string) $p->post_name,
            'url' => (string) get_permalink($p),
            'status' => (string) $p->post_status,
            'builder' => self::builder_of($p),
            'modified' => (string) get_post_modified_time('c', true, $p),
            'featured_media' => $f['featured_media'],
            'is_front_page' => (int) get_option('page_on_front') === (int) $p->ID,
        ];
    }

    public static function text_from_content(string $content): string
    {
        $noBlocks = preg_replace('/<!--.*?-->/s', '', $content) ?? '';
        return trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($noBlocks), ENT_QUOTES | ENT_HTML5, 'UTF-8')) ?? '');
    }

    public static function text_of(WP_Post $p): string
    {
        $f = self::fields($p);
        if (self::builder_of($p) === 'elementor') {
            return trim(implode(' ', array_map([self::class, 'text_from_content'], self::elementor_texts($f['elementor_data']))));
        }
        return self::text_from_content($f['content']);
    }

    /** Non-empty string values under `settings`, depth first, in document order. */
    public static function elementor_texts(?string $data): array
    {
        if ($data === null || $data === '') {
            return [];
        }
        $tree = json_decode($data, true);
        $out = [];
        $walk = static function ($node) use (&$walk, &$out): void {
            if (!is_array($node)) {
                return;
            }
            if (isset($node['settings']) && is_array($node['settings'])) {
                foreach ($node['settings'] as $v) {
                    if (is_string($v) && trim($v) !== '') {
                        $out[] = $v;
                    }
                }
            }
            foreach ($node as $k => $child) {
                if (is_array($child) && $k !== 'settings') {
                    $walk($child);
                }
            }
        };
        $walk(is_array($tree) ? $tree : []);
        return $out;
    }

    /** @return array{data: string, count: int} */
    private static function replace_in_elementor(string $data, string $find, string $replace): array
    {
        $tree = json_decode($data, true);
        $count = 0;
        $walk = static function ($node) use (&$walk, &$count, $find, $replace) {
            if (!is_array($node)) {
                return $node;
            }
            foreach ($node as $k => $child) {
                if ($k === 'settings' && is_array($child)) {
                    foreach ($child as $sk => $sv) {
                        if (is_string($sv)) {
                            $count += substr_count($sv, $find);
                            $child[$sk] = str_replace($find, $replace, $sv);
                        }
                    }
                    $node[$k] = $child;
                } elseif (is_array($child)) {
                    $node[$k] = $walk($child);
                }
            }
            return $node;
        };
        $new = $walk(is_array($tree) ? $tree : []);
        return ['data' => (string) wp_json_encode($new, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'count' => $count];
    }

    private static function error(int $status, string $code, string $message, array $extra = []): WP_Error
    {
        return new WP_Error($code, $message, ['status' => $status] + $extra);
    }

    /**
     * Applies an edit ({title?, content?, replacements?, featured_media?, elementor_data?}) to the before-fields.
     * @return array{title: string, content: string, elementor_data: ?string, featured_media: ?int}|WP_Error
     */
    public static function compute_after(array $before, array $edit, string $builder, array $placeholders, bool $strict): array|WP_Error
    {
        $after = $before;
        if ($builder === 'unknown' && (isset($edit['content']) || isset($edit['replacements']))) {
            return self::error(422, 'sm_builder_unsupported', 'This page is built with an unsupported editor.', ['builder' => $builder]);
        }
        if (isset($edit['title']) && is_string($edit['title'])) {
            $after['title'] = $edit['title'];
        }
        if (isset($edit['content']) && is_string($edit['content'])) {
            // The adapter always sends all four fields; unchanged content on an Elementor page is not an edit.
            if ($builder === 'elementor' && $edit['content'] !== (string) $before['content']) {
                return self::error(422, 'sm_builder_unsupported', 'Elementor pages take replacements, not full content.', ['builder' => 'elementor']);
            }
            $after['content'] = $edit['content'];
        }
        if (array_key_exists('elementor_data', $edit) && ($edit['elementor_data'] === null || is_string($edit['elementor_data']))) {
            $after['elementor_data'] = $edit['elementor_data'];
        }
        foreach ((array) ($edit['replacements'] ?? []) as $r) {
            $find = (string) ($r['find'] ?? '');
            $replace = (string) ($r['replace'] ?? '');
            if ($find === '') {
                return self::error(400, 'sm_invalid', 'A replacement needs a non-empty find text.');
            }
            if ($builder === 'elementor') {
                $res = self::replace_in_elementor((string) ($after['elementor_data'] ?? '[]'), $find, $replace);
                if ($res['count'] !== 1) {
                    return self::error(422, 'sm_replace_failed', sprintf('"%s" occurs %d times; it must occur exactly once.', $find, $res['count']), ['find' => $find, 'count' => $res['count']]);
                }
                $after['elementor_data'] = $res['data'];
            } else {
                $count = substr_count((string) $after['content'], $find);
                if ($count !== 1) {
                    return self::error(422, 'sm_replace_failed', sprintf('"%s" occurs %d times; it must occur exactly once.', $find, $count), ['find' => $find, 'count' => $count]);
                }
                $pos = strpos((string) $after['content'], $find);
                $after['content'] = substr_replace((string) $after['content'], $replace, (int) $pos, strlen($find));
            }
        }
        if (array_key_exists('featured_media', $edit)) {
            $after['featured_media'] = $edit['featured_media'] === null || $edit['featured_media'] === '' ? null : (int) $edit['featured_media'];
        }
        foreach (['title', 'content', 'elementor_data'] as $k) {
            if (!is_string($after[$k] ?? null)) {
                continue;
            }
            $resolved = self::resolve_placeholders($after[$k], $placeholders, $strict);
            if (is_wp_error($resolved)) {
                return $resolved;
            }
            $after[$k] = $resolved;
        }
        return ['title' => (string) $after['title'], 'content' => (string) $after['content'], 'elementor_data' => $after['elementor_data'] ?? null, 'featured_media' => $after['featured_media'] ?? null];
    }

    /** Explicit map first, then the media library by source id; unresolved tokens error when $strict. */
    public static function resolve_placeholders(string $text, array $map, bool $strict): string|WP_Error
    {
        $failed = null;
        $out = preg_replace_callback(self::PLACEHOLDER, static function (array $m) use ($map, $strict, &$failed): string {
            $token = $m[0];
            if (isset($map[$token])) {
                return (string) $map[$token];
            }
            $found = call_user_func(self::$attachment_lookup, $m[2]);
            if (is_array($found)) {
                return $m[1] === 'url' ? (string) $found['url'] : (string) $found['id'];
            }
            if ($strict && $failed === null) {
                $failed = $token;
            }
            return $token;
        }, $text);
        if ($failed !== null) {
            return self::error(400, 'sm_invalid', 'Unresolved placeholder ' . $failed, ['placeholder' => $failed]);
        }
        return (string) $out;
    }

    /** @return ?array{id: int, url: string} */
    public static function find_attachment(string $source_id): ?array
    {
        $q = new WP_Query(['post_type' => 'attachment', 'post_status' => 'inherit', 'posts_per_page' => 1, 'fields' => 'ids', 'meta_key' => self::SOURCE_META, 'meta_value' => $source_id, 'no_found_rows' => true]);
        $id = $q->posts[0] ?? null;
        if (!$id) {
            return null;
        }
        return ['id' => (int) $id, 'url' => (string) wp_get_attachment_url((int) $id)];
    }

    /**
     * Writes the fields present in $fields (after placeholder resolution) and returns {before, after, revision_id}.
     * `revision_id` identifies the PRE-edit state (a revision saved before any write, or the latest existing one),
     * so POST /revert/{page}/{revision_id} undoes this apply; null when the page has no revisions.
     */
    public static function apply(WP_Post $p, array $fields, array $placeholders): array|WP_Error
    {
        $before = self::fields($p);
        $after = self::compute_after($before, array_intersect_key($fields, array_flip(['title', 'content', 'elementor_data', 'featured_media'])), self::builder_of($p), $placeholders, true);
        if (is_wp_error($after)) {
            return $after;
        }
        $pre = wp_save_post_revision($p->ID); // snapshot of the current state; nothing when it equals the latest revision
        $rev = is_int($pre) && $pre > 0 ? $pre : null;
        if ($rev === null) {
            $revisions = wp_get_post_revisions($p->ID, ['posts_per_page' => 1, 'fields' => 'ids']); // a plain list of ids
            $latest = $revisions ? (int) reset($revisions) : 0;
            $rev = $latest > 0 ? $latest : null;
        }
        $update = ['ID' => $p->ID];
        if ($after['title'] !== $before['title']) {
            $update['post_title'] = $after['title'];
        }
        if ($after['content'] !== $before['content']) {
            $update['post_content'] = $after['content'];
        }
        if (count($update) > 1) {
            $r = wp_update_post(wp_slash($update), true);
            if (is_wp_error($r)) {
                return self::error(500, 'sm_write_failed', $r->get_error_message());
            }
        }
        if ($after['elementor_data'] !== $before['elementor_data']) {
            if ($after['elementor_data'] === null) {
                delete_post_meta($p->ID, '_elementor_data');
            } else {
                update_post_meta($p->ID, '_elementor_data', wp_slash($after['elementor_data']));
            }
            delete_post_meta($p->ID, '_elementor_css');
            if (class_exists('\Elementor\Plugin') && isset(\Elementor\Plugin::$instance->files_manager)) {
                \Elementor\Plugin::$instance->files_manager->clear_cache();
            }
        }
        if ($after['featured_media'] !== $before['featured_media']) {
            if ($after['featured_media'] === null) {
                delete_post_thumbnail($p->ID);
            } else {
                set_post_thumbnail($p->ID, $after['featured_media']);
            }
        }
        delete_post_meta($p->ID, self::PENDING_META);
        clean_post_cache($p->ID);
        return ['before' => $before, 'after' => self::fields(get_post($p->ID)), 'revision_id' => $rev];
    }
}
