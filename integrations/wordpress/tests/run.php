<?php
// Runs the plugin's pure PHP classes against tests/fixtures/feed.json. Usage (from the repo root):
//   npm run wp:test   (php:8.3-cli in Docker)   or   php integrations/wordpress/tests/run.php
declare(strict_types=1);

require __DIR__ . '/shim.php';
$plugin = dirname(__DIR__) . '/site-manager';
require $plugin . '/includes/class-sm-labels.php';
require $plugin . '/includes/class-sm-client.php';
require $plugin . '/includes/class-sm-render.php';
require $plugin . '/includes/class-sm-shortcodes.php';
require $plugin . '/includes/class-sm-pages.php';

$feed = json_decode((string) file_get_contents(__DIR__ . '/fixtures/feed.json'), true, 512, JSON_THROW_ON_ERROR);
$state = $feed['state'];
$now = $feed['now'];
$fails = 0;

function check(string $name, bool $ok, string $detail = ''): void
{
    global $fails;
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " ($detail)" : '') . "\n";
    if (!$ok) {
        $fails++;
    }
}
function has(string $hay, string $needle): bool
{
    return str_contains($hay, $needle);
}
function before(string $hay, string $a, string $b): bool
{
    $pa = strpos($hay, $a);
    $pb = strpos($hay, $b);
    return $pa !== false && $pb !== false && $pa < $pb;
}

// Labels
check('bg price', SM_Labels::price(2.9, 'bg') === '2,90 €', SM_Labels::price(2.9, 'bg'));
check('en price', SM_Labels::price(2.9, 'en') === '€2.90', SM_Labels::price(2.9, 'en'));
check('auto lang = venue default', SM_Labels::lang('auto', $state) === 'bg');
check('explicit lang wins', SM_Labels::lang('en', $state) === 'en');
check('bad lang falls back', SM_Labels::lang('de', $state) === 'bg');
check('allergen name', SM_Labels::allergen(7, 'en') === 'Milk' && SM_Labels::allergen(7, 'bg') === 'Мляко');

// Time helpers
$local = SM_Render::local($now, 'Europe/Sofia');
check('local parts', $local === ['date' => '2026-10-09', 'time' => '12:00', 'weekday' => 'fri'], json_encode($local));
check('format_datetime bg', SM_Render::format_datetime('2026-12-24T06:00:00.000Z', 'bg', 'Europe/Sofia') === '24.12.2026, 08:00');
check('format_datetime en', SM_Render::format_datetime('2026-12-24T06:00:00.000Z', 'en', 'Europe/Sofia') === '24 Dec 2026, 08:00');
check('format_date', SM_Render::format_date('2026-12-24', 'bg') === '24.12.2026' && SM_Render::format_date('2026-12-24', 'en') === '24 Dec 2026');
$status = SM_Render::today_status($state['venue']['hours'], $state['holidays'], $now, 'Europe/Sofia');
check('open now until 18:00', $status['state'] === 'open' && $status['until'] === '18:00', json_encode($status));
$sunday = SM_Render::today_status($state['venue']['hours'], $state['holidays'], '2026-10-11T10:00:00.000Z', 'Europe/Sofia');
check('closed on Sunday, opens Monday 08:00', $sunday['state'] === 'closed' && $sunday['next'] === '2026-10-12T05:00:00+00:00', json_encode($sunday));
$early = SM_Render::today_status($state['venue']['hours'], $state['holidays'], '2026-10-09T04:30:00.000Z', 'Europe/Sofia');
check('opens later today', $early['state'] === 'opens_later' && $early['at'] === '08:00', json_encode($early));
$xmas = SM_Render::today_status($state['venue']['hours'], $state['holidays'], '2026-12-24T10:00:00.000Z', 'Europe/Sofia');
check('holiday closes the day and names it', $xmas['state'] === 'closed' && $xmas['holiday']['note_bg'] === 'Весели празници!', json_encode($xmas));

// Menu
$menu = SM_Render::menu($state, $now, 'bg');
check('menu wraps with the accent', has($menu, 'class="sm sm-menu"') && has($menu, '--sm-accent:#2f6b4f'));
check('menu lists categories in order', before($menu, 'Кафе', 'Закуски'));
check('menu hides the inactive category', !has($menu, 'Стара категория'));
check('menu hides removed and expired items', !has($menu, 'Премахнато') && !has($menu, 'Стара специалност'));
check('menu shows the live special', has($menu, 'Тиквеник'));
check('sold-out item is marked until 18:00', has($menu, 'sm-sold-out') && has($menu, 'Изчерпано до 09.10.2026, 18:00'));
check('elapsed sold-out is available', substr_count($menu, 'sm-sold-out') === 1);
check('bg price in menu', has($menu, '2,90 €'));
check('en price in menu', has(SM_Render::menu($state, $now, 'en'), '€2.90'));
$legend = substr($menu, (int) strpos($menu, 'sm-legend'));
check('allergen chips and legend', has($menu, 'title="Мляко"') && has($legend, 'Кодове на алергените (ЕС 1169/2011)') && before($legend, 'Глутен', 'Мляко'));
check('item photo is rendered', has($menu, 'https://cdn.example/v1/cap.jpg'));
check('escapes html in names', !has(SM_Render::menu(array_replace_recursive($state, ['items' => [0 => ['name_bg' => '<b>x</b>']]]), $now, 'bg'), '<b>x</b>'));
$empty = SM_Render::menu(['venue' => $state['venue'], 'categories' => [], 'items' => [], 'holidays' => [], 'announcements' => [], 'media' => [], 'texts' => []], $now, 'en');
check('empty menu says so', has($empty, 'The menu is being prepared.'));

// Specials
$specials = SM_Render::specials($state, $now, 'bg');
check('specials show the live one until 18:00', has($specials, 'Тиквеник') && has($specials, 'до 18:00'));
check('specials hide the expired one', !has($specials, 'Стара специалност'));
check('no specials renders nothing', SM_Render::specials(array_replace($state, ['items' => []]), $now, 'bg') === '');

// Hours
$hours = SM_Render::hours($state, $now, 'bg');
check('hours status line', has($hours, 'Отворено до 18:00') && has($hours, 'sm-status-open'));
check('hours table marks today', has($hours, 'aria-current="date"') && has($hours, 'пет'));
check('closed day label', has($hours, 'почивен ден'));
check('upcoming holiday only', has($hours, '24.12.2026') && !has($hours, '01.10.2026'));
check('find us links', has($hours, 'tel:+35920000000') && has($hours, 'https://instagram.com/agala.cafe') && has($hours, 'https://maps.example/agala'));
$hoursEn = SM_Render::hours($state, '2026-10-11T10:00:00.000Z', 'en');
check('closed status in English', has($hoursEn, 'Closed · opens 12 Oct 2026, 08:00'));

// Announcements
$ann = SM_Render::announcements($state, $now, 'en');
check('live announcement shown, expired hidden', has($ann, 'Live jazz tonight from 19:00') && !has($ann, 'Old announcement'));
check('no announcements renders nothing', SM_Render::announcements(array_replace($state, ['announcements' => []]), $now, 'en') === '');

// Photos
$photos = SM_Render::photos($state, $now, 'bg');
check('gallery in position order, non-gallery excluded', before($photos, 'g1.jpg', 'g2.jpg') && !has($photos, 'cover.jpg') && substr_count($photos, '<figure') === 2);
$noUrl = $state;
$noUrl['media'][] = ['id' => 'm-x', 'venue_id' => 'v1', 'storage_path' => 'x', 'is_gallery' => true, 'position' => 3];
check('gallery skips rows without a URL', substr_count(SM_Render::photos($noUrl, $now, 'bg'), '<figure') === 2);

// Text
check('text welcome bg', SM_Render::text($state, 'welcome', 'bg') === '<span class="sm sm-text sm-text-welcome">Добре дошли!</span>');
check('text tagline en', has(SM_Render::text($state, 'tagline', 'en'), 'Coffee on the corner'));
check('text falls back to the other language', has(SM_Render::text(array_replace_recursive($state, ['venue' => ['tagline_en' => '']]), 'tagline', 'en'), 'Кафе на ъгъла'));
check('text name', has(SM_Render::text($state, 'name', 'en'), 'Кафене „Ъгъла“'));
check('unknown text key renders nothing', SM_Render::text($state, 'nope', 'bg') === '');

// Client (pure parts)
update_option('site_manager_settings', ['base_url' => 'https://site-manager.example/', 'slug' => 'agala', 'cache_seconds' => 30, 'lang' => 'auto']);
check('feed url', SM_Client::feed_url() === 'https://site-manager.example/api/site/agala', (string) SM_Client::feed_url());
$GLOBALS['sm_test_remote'] = ['response' => ['code' => 200], 'body' => json_encode($feed)];
$fetched = SM_Client::fetch();
check('fetch parses the feed', is_array($fetched) && $fetched['now'] === $now && $fetched['stale'] === false);
$cachedKey = 'site_manager_feed_' . md5((string) SM_Client::feed_url());
SM_Client::reset_memo(); // each page view is a new request
$cachedAgain = SM_Client::fetch();
check('cached copy keeps the clock moving', is_array($cachedAgain) && $cachedAgain['stale'] === false && strtotime($cachedAgain['now']) >= strtotime($now));
$GLOBALS['sm_test_transients'][$cachedKey]['fetched_at'] -= 120;
SM_Client::reset_memo();
$cachedOld = SM_Client::fetch();
check('cached copy is advanced by its age', is_array($cachedOld) && strtotime($cachedOld['now']) - strtotime($now) >= 120 && strtotime($cachedOld['now']) - strtotime($now) < 130, is_array($cachedOld) ? $cachedOld['now'] : '');
$GLOBALS['sm_test_remote'] = new WP_Error('http_request_failed', 'down');
SM_Client::clear_cache();
$stale = SM_Client::fetch();
check('fetch serves the last good copy when the feed is down', is_array($stale) && $stale['stale'] === true);
$GLOBALS['sm_test_options']['site_manager_feed_last_good']['fetched_at'] -= 3600;
SM_Client::clear_cache();
$staleOld = SM_Client::fetch();
check('stale copy is advanced by its age', is_array($staleOld) && $staleOld['stale'] === true && strtotime($staleOld['now']) > strtotime($now) && strtotime($staleOld['now']) - strtotime($now) >= 3600, is_array($staleOld) ? $staleOld['now'] : '');
delete_option('site_manager_feed_last_good');
SM_Client::clear_cache();
$err = SM_Client::fetch();
check('fetch returns WP_Error without any copy', is_wp_error($err) && $err->get_error_code() === 'site_manager_unavailable');
$GLOBALS['sm_test_remote'] = ['response' => ['code' => 404], 'body' => '{"error":"not found"}'];
SM_Client::clear_cache(); // also ends the failure window of the previous case
$err404 = SM_Client::fetch();
check('404 is an error that names the slug', is_wp_error($err404) && has($err404->get_error_message(), 'agala'));
check('unavailable comment is safe', has(SM_Render::unavailable($err404), '<!-- Site Manager:') && !has(SM_Render::unavailable($err404), '<script'));

// Outage protection: one remote call per request for the same URL
$failKey = 'site_manager_feed_fail_' . md5((string) SM_Client::feed_url());
$GLOBALS['sm_test_remote'] = new WP_Error('http_request_failed', 'down');
SM_Client::clear_cache();
$GLOBALS['sm_test_remote_calls'] = 0;
SM_Client::fetch();
delete_transient($failKey); // only the per-request memo may stop the second call
$memoAgain = SM_Client::fetch();
check('a second fetch in the same request does not call the remote', $GLOBALS['sm_test_remote_calls'] === 1 && is_wp_error($memoAgain), (string) $GLOBALS['sm_test_remote_calls']);
// ... and for 60 s after a failure no page view calls out: it gets the last good copy (aged, stale) or the error
$GLOBALS['sm_test_remote'] = ['response' => ['code' => 200], 'body' => json_encode($feed)];
SM_Client::clear_cache();
SM_Client::reset_memo();
SM_Client::fetch(); // a good copy exists
SM_Client::clear_cache();
SM_Client::reset_memo();
$GLOBALS['sm_test_remote'] = new WP_Error('http_request_failed', 'down');
$GLOBALS['sm_test_remote_calls'] = 0;
$down = SM_Client::fetch();
SM_Client::reset_memo(); // the next page view
$windowed = SM_Client::fetch();
check('a failure sets the 60-second window', is_array(get_transient($failKey)) && is_array($down) && $down['stale'] === true);
check('within the window a fetch serves the stale copy without calling the remote', $GLOBALS['sm_test_remote_calls'] === 1 && is_array($windowed) && $windowed['stale'] === true && strtotime($windowed['now']) >= strtotime($now), (string) $GLOBALS['sm_test_remote_calls']);
delete_option('site_manager_feed_last_good');
SM_Client::reset_memo();
$windowedErr = SM_Client::fetch();
check('within the window and without a copy the error comes back directly', $GLOBALS['sm_test_remote_calls'] === 1 && is_wp_error($windowedErr) && $windowedErr->get_error_code() === 'site_manager_unavailable' && has($windowedErr->get_error_message(), 'down'));
$GLOBALS['sm_test_remote'] = ['response' => ['code' => 200], 'body' => json_encode($feed)];
$checked = SM_Client::fetch(true);
check('"Check connection" (bypass) ignores the window and ends it on success', $GLOBALS['sm_test_remote_calls'] === 2 && is_array($checked) && $checked['stale'] === false && get_transient($failKey) === false);
$GLOBALS['sm_test_remote'] = new WP_Error('http_request_failed', 'down');
SM_Client::clear_cache();
SM_Client::reset_memo();
SM_Client::fetch();
$windowSet = is_array(get_transient($failKey));
SM_Client::clear_cache();
check('clear_cache drops the failure window', $windowSet && get_transient($failKey) === false);
SM_Client::reset_memo();

// Shortcodes never break the page
$broken = $feed;
$broken['now'] = 'not a date';
$GLOBALS['sm_test_remote'] = ['response' => ['code' => 200], 'body' => json_encode($broken)];
SM_Client::clear_cache();
$rendered = SM_Shortcodes::render('hours', []);
check('a malformed feed date yields the safe comment, not an exception', has($rendered, '<!-- Site Manager: Site Manager could not render this block. -->'), $rendered);

// Write-channel cases (Task 10) run after the helpers and the counter exist, so their failures count.
foreach (glob(__DIR__ . '/cases/*.php') ?: [] as $extra) {
    require $extra;
}

echo ($fails ? "\n$fails FAILED\n" : "\nALL PASSED\n");
exit($fails ? 1 : 0);
