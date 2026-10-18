<?php
/**
 * Plugin Name:       Claudia
 * Plugin URI:        https://github.com/biskwida/site-manager
 * Description:       Shows your café's menu, specials, opening hours, announcements and photos from Claudia, and lets the Claudia agent edit this site once you connect it from Telegram.
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      8.1
 * Author:            Claudia
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       site-manager
 * Domain Path:       /languages
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

define('SITE_MANAGER_VERSION', '0.1.0');
define('SITE_MANAGER_FILE', __FILE__);
define('SITE_MANAGER_DIR', plugin_dir_path(__FILE__));
define('SITE_MANAGER_URL', plugin_dir_url(__FILE__));

require_once SITE_MANAGER_DIR . 'includes/class-sm-labels.php';
require_once SITE_MANAGER_DIR . 'includes/class-sm-client.php';
require_once SITE_MANAGER_DIR . 'includes/class-sm-render.php';
require_once SITE_MANAGER_DIR . 'includes/class-sm-shortcodes.php';
require_once SITE_MANAGER_DIR . 'includes/class-sm-settings.php';
foreach (['class-sm-blocks.php', 'class-sm-auth.php', 'class-sm-pages.php', 'class-sm-rest.php', 'class-sm-preview.php'] as $optional) {
    if (file_exists(SITE_MANAGER_DIR . 'includes/' . $optional)) {
        require_once SITE_MANAGER_DIR . 'includes/' . $optional; // Tasks 9 and 10 add these
    }
}

add_action('init', static function (): void {
    wp_register_style('site-manager', SITE_MANAGER_URL . 'assets/site-manager.css', [], SITE_MANAGER_VERSION);
    load_plugin_textdomain('site-manager', false, dirname(plugin_basename(SITE_MANAGER_FILE)) . '/languages');
    SM_Shortcodes::register();
    if (class_exists('SM_Blocks')) {
        SM_Blocks::register();
    }
    if (class_exists('SM_Preview')) {
        SM_Preview::register();
    }
});
add_action('admin_menu', ['SM_Settings', 'add_page']);
add_action('admin_init', ['SM_Settings', 'register']);
add_action('rest_api_init', static function (): void {
    if (class_exists('SM_Rest')) {
        SM_Rest::register_routes();
    }
});
add_filter('plugin_action_links_' . plugin_basename(SITE_MANAGER_FILE), static function (array $links): array {
    array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=site-manager')) . '">' . esc_html__('Settings', 'site-manager') . '</a>');
    return $links;
});
