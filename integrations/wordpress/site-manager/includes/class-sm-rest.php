<?php
// REST namespace site-manager/v1: the write channel. Routes, bodies and errors follow the plan's "Plugin REST contract".
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Rest
{
    public const NS = 'site-manager/v1';
    private const OPTION_KEYS = ['blogname', 'blogdescription', 'custom_logo', 'site_icon'];

    private static float $started = 0.0;

    public static function register_routes(): void
    {
        // Every call to the namespace is logged, including the ones the permission callback refuses (401, 403, 429):
        // the timer starts before the permission check and the entry is appended to the final response.
        add_filter('rest_request_before_callbacks', [self::class, 'start_timer'], 10, 3);
        add_filter('rest_post_dispatch', [self::class, 'log_response'], 10, 3);
        $auth = [SM_Auth::class, 'permission'];
        $route = static function (string $path, string $methods, callable $cb, $permission): void {
            register_rest_route(self::NS, $path, ['methods' => $methods, 'callback' => $cb, 'permission_callback' => $permission]);
        };
        $route('/handshake', 'POST', [self::class, 'handshake'], [SM_Auth::class, 'handshake_permission']);
        $route('/site', 'GET', [self::class, 'site'], $auth);
        $route('/page/(?P<id>\d+)', 'GET', [self::class, 'page'], $auth);
        $route('/page/(?P<id>\d+)/preview', 'POST', [self::class, 'preview'], $auth);
        $route('/page/(?P<id>\d+)/preview', 'DELETE', [self::class, 'cancel_preview'], $auth);
        $route('/page/(?P<id>\d+)/apply', 'POST', [self::class, 'apply'], $auth);
        $route('/revert/(?P<page_id>\d+)/(?P<revision_id>\d+)', 'POST', [self::class, 'revert'], $auth);
        $route('/media', 'POST', [self::class, 'upload_media'], $auth);
        $route('/media', 'DELETE', [self::class, 'delete_media_by_source'], $auth);
        $route('/media/(?P<id>\d+)', 'PUT', [self::class, 'update_media'], $auth);
        $route('/media/(?P<id>\d+)', 'DELETE', [self::class, 'delete_media'], $auth);
        $route('/option', 'GET', [self::class, 'options'], $auth);
        $route('/option', 'PUT', [self::class, 'set_option'], $auth);
        $route('/menu/(?P<id>\d+)', 'GET', [self::class, 'menu'], $auth);
        $route('/menu/(?P<id>\d+)', 'PUT', [self::class, 'set_menu'], $auth);
        $route('/product/(?P<id>\d+)', 'GET', [self::class, 'product'], $auth);
        $route('/product/(?P<id>\d+)', 'PUT', [self::class, 'set_product'], $auth);
    }

    private static function ours(WP_REST_Request $r): bool
    {
        return str_starts_with((string) $r->get_route(), '/' . self::NS . '/');
    }

    /** @param mixed $response @param mixed $handler @return mixed */
    public static function start_timer($response, $handler, WP_REST_Request $r)
    {
        if (self::ours($r)) {
            self::$started = microtime(true);
        }
        return $response;
    }

    /** Appends the ring-buffer entry for every response of the namespace (status of the WP_Error or 200). */
    public static function log_response(WP_HTTP_Response $result, WP_REST_Server $server, WP_REST_Request $r): WP_HTTP_Response
    {
        if (self::ours($r)) {
            $ms = self::$started > 0 ? (microtime(true) - self::$started) * 1000 : 0.0;
            SM_Auth::log($r->get_method(), (string) $r->get_route(), (int) $result->get_status(), $ms);
            self::$started = 0.0;
        }
        return $result;
    }

    private static function error(int $status, string $code, string $message, array $extra = []): WP_Error
    {
        return new WP_Error($code, $message, ['status' => $status] + $extra);
    }

    private static function page_or_error(int $id): WP_Post|WP_Error
    {
        $p = get_post($id);
        if (!$p || !in_array($p->post_type, ['page', 'post'], true) || $p->post_status === 'trash') {
            return self::error(404, 'sm_not_found', 'No such page.');
        }
        return $p;
    }

    private static function body(WP_REST_Request $r): array
    {
        $b = $r->get_json_params();
        return is_array($b) ? $b : [];
    }

    // ---- handshake and site ----------------------------------------------------------------------

    public static function handshake(WP_REST_Request $r): array|WP_Error
    {
        $b = self::body($r);
        $token = SM_Auth::redeem_code((string) ($b['code'] ?? ''), sanitize_key((string) ($b['slug'] ?? '')));
        if (is_wp_error($token)) {
            return $token;
        }
        $conn = SM_Auth::connection();
        if ($conn) {
            wp_set_current_user($conn['user_id']);
        }
        return ['token' => $token, 'site' => self::site_info()];
    }

    public static function site(WP_REST_Request $r): array
    {
        return self::site_info();
    }

    private static function site_info(): array
    {
        $pages = get_posts(['post_type' => 'page', 'post_status' => ['publish', 'draft', 'private'], 'posts_per_page' => 200, 'orderby' => ['menu_order' => 'ASC', 'title' => 'ASC']]);
        $menus = [];
        $locations = get_nav_menu_locations();
        foreach (wp_get_nav_menus() as $m) {
            $menus[] = ['id' => (int) $m->term_id, 'name' => (string) $m->name, 'locations' => array_keys(array_filter($locations, static fn($id): bool => (int) $id === (int) $m->term_id)), 'count' => (int) $m->count];
        }
        $theme = wp_get_theme();
        $conn = SM_Auth::connection();
        $user = $conn ? get_user_by('id', $conn['user_id']) : null;
        $woo = function_exists('wc_get_products');
        $products = [];
        if ($woo) {
            foreach (wc_get_products(['limit' => 100, 'status' => 'publish']) as $p) {
                $products[] = ['id' => $p->get_id(), 'name' => $p->get_name(), 'regular_price' => (string) $p->get_regular_price(), 'sale_price' => (string) $p->get_sale_price(), 'stock_status' => (string) $p->get_stock_status()];
            }
        }
        $options = self::option_values();
        return [
            'name' => $options['blogname'],
            'description' => $options['blogdescription'],
            'url' => (string) site_url(),
            'home_url' => (string) home_url(),
            'wp_version' => (string) get_bloginfo('version'),
            'plugin_version' => SITE_MANAGER_VERSION,
            'locale' => (string) get_locale(),
            'timezone' => (string) wp_timezone_string(),
            'theme' => ['name' => (string) $theme->get('Name'), 'slug' => (string) $theme->get_stylesheet()],
            'pages' => array_map([SM_Pages::class, 'summary'], $pages),
            'menus' => $menus,
            'options' => $options,
            'woocommerce' => $woo,
            'products' => $products,
            'connected_user' => $user ? ['id' => (int) $user->ID, 'login' => (string) $user->user_login] : null,
        ];
    }

    // ---- pages -------------------------------------------------------------------------------------

    public static function page(WP_REST_Request $r): array|WP_Error
    {
        $p = self::page_or_error((int) $r['id']);
        if (is_wp_error($p)) {
            return $p;
        }
        $f = SM_Pages::fields($p);
        $builder = SM_Pages::builder_of($p);
        return SM_Pages::summary($p) + $f + ['text' => SM_Pages::text_of($p), 'texts' => SM_Pages::elementor_texts($f['elementor_data']), 'editable' => $builder !== 'unknown'];
    }

    public static function preview(WP_REST_Request $r): array|WP_Error
    {
        $p = self::page_or_error((int) $r['id']);
        if (is_wp_error($p)) {
            return $p;
        }
        $b = self::body($r);
        $before = SM_Pages::fields($p);
        $builder = SM_Pages::builder_of($p);
        $after = SM_Pages::compute_after($before, $b, $builder, (array) ($b['placeholders'] ?? []), false);
        if (is_wp_error($after)) {
            return $after;
        }
        $key = bin2hex(random_bytes(8));
        update_post_meta($p->ID, SM_Pages::PENDING_META, wp_slash(['key' => $key, 'after' => $after, 'expires' => time() + 86400]));
        return ['before' => $before, 'after' => $after, 'preview_url' => $builder === 'elementor' ? null : add_query_arg('sm_preview', $key, get_permalink($p)), 'pending_key' => $key];
    }

    public static function cancel_preview(WP_REST_Request $r): array|WP_Error
    {
        $p = self::page_or_error((int) $r['id']);
        if (is_wp_error($p)) {
            return $p;
        }
        delete_post_meta($p->ID, SM_Pages::PENDING_META);
        return ['ok' => true];
    }

    public static function apply(WP_REST_Request $r): array|WP_Error
    {
        $p = self::page_or_error((int) $r['id']);
        if (is_wp_error($p)) {
            return $p;
        }
        $b = self::body($r);
        $res = SM_Pages::apply($p, $b, (array) ($b['placeholders'] ?? []));
        if (is_wp_error($res)) {
            return $res;
        }
        return ['id' => (int) $p->ID, 'url' => (string) get_permalink($p->ID)] + $res;
    }

    public static function revert(WP_REST_Request $r): array|WP_Error
    {
        $p = self::page_or_error((int) $r['page_id']);
        if (is_wp_error($p)) {
            return $p;
        }
        $revision_id = (int) $r['revision_id']; // wp_get_post_revision() takes its argument by reference
        $rev = wp_get_post_revision($revision_id);
        if (!$rev || (int) $rev->post_parent !== (int) $p->ID) {
            return self::error(404, 'sm_not_found', 'No such revision for this page.');
        }
        $restored = wp_restore_post_revision($rev->ID);
        if (!$restored) {
            return self::error(500, 'sm_write_failed', 'Could not restore the revision.');
        }
        return ['id' => (int) $p->ID, 'restored_revision' => (int) $rev->ID];
    }

    // ---- media -------------------------------------------------------------------------------------

    private static function media_row(int $id, bool $existed): array
    {
        return ['id' => $id, 'url' => (string) wp_get_attachment_url($id), 'alt' => (string) get_post_meta($id, '_wp_attachment_image_alt', true), 'existed' => $existed];
    }

    public static function upload_media(WP_REST_Request $r): array|WP_Error
    {
        $b = self::body($r);
        $url = (string) ($b['url'] ?? '');
        $source = sanitize_text_field((string) ($b['source_id'] ?? ''));
        if ($source === '') {
            return self::error(400, 'sm_invalid', 'source_id is required.');
        }
        if (!wp_http_validate_url($url)) {
            // Core refuses private hosts and any external port other than 80, 443 and 8080.
            return self::error(400, 'sm_invalid', 'url must be a public http(s) URL on port 80, 443 or 8080.');
        }
        $existing = SM_Pages::find_attachment($source);
        if ($existing) {
            return self::media_row($existing['id'], true);
        }
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $tmp = download_url($url, 30);
        if (is_wp_error($tmp)) {
            return self::error(502, 'sm_upload_failed', 'Could not download the photo: ' . $tmp->get_error_message());
        }
        $name = sanitize_file_name((string) ($b['filename'] ?? basename((string) parse_url($url, PHP_URL_PATH))));
        if ($name === '' || !preg_match('/\.(jpe?g|png|webp|gif)$/i', $name)) {
            $name = 'site-manager-' . substr(md5($source), 0, 8) . '.jpg';
        }
        $title = sanitize_text_field((string) ($b['title'] ?? ''));
        $id = media_handle_sideload(['name' => $name, 'tmp_name' => $tmp], 0, $title !== '' ? $title : null); // null: core titles it after the file
        if (is_wp_error($id)) {
            @unlink($tmp);
            return self::error(502, 'sm_upload_failed', $id->get_error_message());
        }
        update_post_meta($id, SM_Pages::SOURCE_META, $source);
        if (isset($b['alt'])) {
            update_post_meta($id, '_wp_attachment_image_alt', sanitize_text_field((string) $b['alt']));
        }
        return self::media_row((int) $id, false);
    }

    public static function update_media(WP_REST_Request $r): array|WP_Error
    {
        $id = (int) $r['id'];
        if (get_post_type($id) !== 'attachment') {
            return self::error(404, 'sm_not_found', 'No such attachment.');
        }
        $b = self::body($r);
        if (isset($b['alt'])) {
            update_post_meta($id, '_wp_attachment_image_alt', sanitize_text_field((string) $b['alt']));
        }
        $update = ['ID' => $id];
        if (isset($b['title'])) {
            $update['post_title'] = sanitize_text_field((string) $b['title']);
        }
        if (isset($b['caption'])) {
            $update['post_excerpt'] = sanitize_text_field((string) $b['caption']);
        }
        if (count($update) > 1) {
            wp_update_post(wp_slash($update));
        }
        return self::media_row($id, true);
    }

    public static function delete_media(WP_REST_Request $r): array
    {
        $id = (int) $r['id'];
        $deleted = get_post_type($id) === 'attachment' && wp_delete_attachment($id, true) !== false;
        return ['ok' => true, 'deleted' => $deleted];
    }

    public static function delete_media_by_source(WP_REST_Request $r): array|WP_Error
    {
        $source = sanitize_text_field((string) $r->get_param('source_id'));
        if ($source === '') {
            return self::error(400, 'sm_invalid', 'source_id is required.');
        }
        $found = SM_Pages::find_attachment($source);
        $deleted = $found ? wp_delete_attachment($found['id'], true) !== false : false;
        return ['ok' => true, 'deleted' => $deleted];
    }

    // ---- options -----------------------------------------------------------------------------------

    private static function option_values(): array
    {
        $logo = (int) get_theme_mod('custom_logo', 0);
        $icon = (int) get_option('site_icon', 0);
        // Core stores "&amp;" for "&"; hand back the raw text the agent sent and compares against.
        return ['blogname' => wp_specialchars_decode((string) get_option('blogname'), ENT_QUOTES), 'blogdescription' => wp_specialchars_decode((string) get_option('blogdescription'), ENT_QUOTES), 'custom_logo' => $logo > 0 ? $logo : null, 'site_icon' => $icon > 0 ? $icon : null];
    }

    public static function options(WP_REST_Request $r): array
    {
        return self::option_values();
    }

    public static function set_option(WP_REST_Request $r): array|WP_Error
    {
        $b = self::body($r);
        $key = (string) ($b['key'] ?? '');
        if (!in_array($key, self::OPTION_KEYS, true)) {
            return self::error(400, 'sm_invalid', sprintf('Option "%s" is not editable.', $key));
        }
        $before = self::option_values()[$key];
        $value = $b['value'] ?? null;
        if ($key === 'custom_logo' || $key === 'site_icon') {
            if (is_string($value) && str_starts_with($value, '{{')) {
                $resolved = SM_Pages::resolve_placeholders($value, (array) ($b['placeholders'] ?? []), true);
                if (is_wp_error($resolved)) {
                    return $resolved;
                }
                $value = $resolved;
            }
            if ($value !== null && $value !== '' && !is_int($value) && !(is_string($value) && preg_match('/^\d+$/', $value))) {
                return self::error(400, 'sm_invalid', 'value must be an attachment id or null.');
            }
            $id = $value === null || $value === '' ? 0 : (int) $value;
            if ($id > 0 && get_post_type($id) !== 'attachment') {
                return self::error(400, 'sm_invalid', 'value must be an attachment id or null.');
            }
            if ($key === 'custom_logo') {
                $id > 0 ? set_theme_mod('custom_logo', $id) : remove_theme_mod('custom_logo');
            } else {
                update_option('site_icon', $id);
            }
        } else {
            update_option($key, sanitize_text_field((string) $value));
        }
        return ['key' => $key, 'before' => $before, 'after' => self::option_values()[$key]];
    }

    // ---- menus -------------------------------------------------------------------------------------

    private static function menu_items(int $menu_id): array
    {
        $items = wp_get_nav_menu_items($menu_id, ['post_status' => 'publish,draft']) ?: [];
        $ids = array_map(static fn($i): int => (int) $i->ID, $items);
        $out = [];
        foreach ($items as $i) {
            $parent = (int) $i->menu_item_parent;
            $pi = $parent > 0 ? array_search($parent, $ids, true) : false;
            $out[] = ['id' => (int) $i->ID, 'title' => (string) $i->title, 'url' => (string) $i->url, 'parent_index' => $pi === false ? null : (int) $pi, 'position' => (int) $i->menu_order, 'type' => $i->type === 'post_type' ? 'post_type' : 'custom', 'object_id' => $i->type === 'post_type' ? (int) $i->object_id : null];
        }
        return $out;
    }

    public static function menu(WP_REST_Request $r): array|WP_Error
    {
        $menu = wp_get_nav_menu_object((int) $r['id']);
        if (!$menu) {
            return self::error(404, 'sm_not_found', 'No such menu.');
        }
        $locations = get_nav_menu_locations();
        return ['id' => (int) $menu->term_id, 'name' => (string) $menu->name, 'locations' => array_keys(array_filter($locations, static fn($id): bool => (int) $id === (int) $menu->term_id)), 'items' => self::menu_items((int) $menu->term_id)];
    }

    public static function set_menu(WP_REST_Request $r): array|WP_Error
    {
        $menu = wp_get_nav_menu_object((int) $r['id']);
        if (!$menu) {
            return self::error(404, 'sm_not_found', 'No such menu.');
        }
        $items = self::body($r)['items'] ?? null;
        if (!is_array($items)) {
            return self::error(400, 'sm_invalid', 'items must be a list.');
        }
        $before = self::menu_items((int) $menu->term_id);
        foreach ($before as $old) {
            wp_delete_post($old['id'], true);
        }
        $newIds = [];
        foreach (array_values($items) as $i => $it) {
            $it = is_array($it) ? $it : [];
            $parentIdx = $it['parent_index'] ?? null;
            $type = ($it['type'] ?? 'custom') === 'post_type' && !empty($it['object_id']) ? 'post_type' : 'custom';
            $args = [
                'menu-item-title' => sanitize_text_field((string) ($it['title'] ?? '')),
                'menu-item-url' => esc_url_raw((string) ($it['url'] ?? '')),
                'menu-item-status' => 'publish',
                'menu-item-position' => $i + 1,
                'menu-item-type' => $type,
                'menu-item-parent-id' => $parentIdx !== null && isset($newIds[(int) $parentIdx]) ? $newIds[(int) $parentIdx] : 0,
            ];
            if ($type === 'post_type') {
                $args['menu-item-object'] = get_post_type((int) $it['object_id']) ?: 'page';
                $args['menu-item-object-id'] = (int) $it['object_id'];
            }
            $id = wp_update_nav_menu_item((int) $menu->term_id, 0, $args);
            $newIds[$i] = is_wp_error($id) ? 0 : (int) $id;
        }
        return ['id' => (int) $menu->term_id, 'before' => $before, 'after' => self::menu_items((int) $menu->term_id)];
    }

    // ---- WooCommerce products ------------------------------------------------------------------------

    private static function product_row(object $p): array
    {
        return ['id' => $p->get_id(), 'name' => $p->get_name(), 'regular_price' => (string) $p->get_regular_price(), 'sale_price' => (string) $p->get_sale_price(), 'stock_status' => (string) $p->get_stock_status(), 'description' => (string) $p->get_description(), 'short_description' => (string) $p->get_short_description(), 'url' => (string) $p->get_permalink()];
    }

    /** @return WC_Product|WP_Error (PHP forbids `object|WP_Error`, so the union lives here) */
    private static function product_or_error(int $id): object
    {
        if (!function_exists('wc_get_product')) {
            return self::error(404, 'sm_no_woocommerce', 'WooCommerce is not active on this site.');
        }
        $p = wc_get_product($id);
        return $p ? $p : self::error(404, 'sm_not_found', 'No such product.');
    }

    public static function product(WP_REST_Request $r): array|WP_Error
    {
        $p = self::product_or_error((int) $r['id']);
        return is_wp_error($p) ? $p : self::product_row($p);
    }

    public static function set_product(WP_REST_Request $r): array|WP_Error
    {
        $p = self::product_or_error((int) $r['id']);
        if (is_wp_error($p)) {
            return $p;
        }
        $before = self::product_row($p);
        $b = self::body($r);
        if (isset($b['name'])) {
            $p->set_name(sanitize_text_field((string) $b['name']));
        }
        if (isset($b['regular_price'])) {
            $p->set_regular_price(wc_format_decimal((string) $b['regular_price']));
        }
        if (array_key_exists('sale_price', $b)) {
            $p->set_sale_price($b['sale_price'] === '' || $b['sale_price'] === null ? '' : wc_format_decimal((string) $b['sale_price']));
        }
        if (isset($b['stock_status']) && in_array($b['stock_status'], ['instock', 'outofstock', 'onbackorder'], true)) {
            $p->set_stock_status((string) $b['stock_status']);
        }
        if (isset($b['description'])) {
            $p->set_description(wp_kses_post((string) $b['description']));
        }
        if (isset($b['short_description'])) {
            $p->set_short_description(wp_kses_post((string) $b['short_description']));
        }
        $p->save();
        return ['id' => $p->get_id(), 'before' => $before, 'after' => self::product_row(wc_get_product($p->get_id()))];
    }
}
