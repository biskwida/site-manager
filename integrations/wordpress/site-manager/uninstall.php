<?php
// Runs when the plugin is deleted from the Plugins screen: removes every option and transient it created.
declare(strict_types=1);

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}
foreach (['site_manager_settings', 'site_manager_feed_last_good', 'site_manager_connect_code', 'site_manager_token', 'site_manager_api_log'] as $option) {
    delete_option($option);
}
global $wpdb;
$wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_site_manager_%' OR option_name LIKE '_transient_timeout_site_manager_%'");
