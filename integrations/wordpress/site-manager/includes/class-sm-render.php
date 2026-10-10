<?php
// Server-side HTML for the blocks. Pure functions of (state, now, lang). Read-time rules mirror
// src/domain/effective.ts and src/domain/hours.ts; everything is escaped here.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Render
{
    private const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    private const LOOKAHEAD_DAYS = 14;

    // ---- time helpers -------------------------------------------------------------------------

    private static function ms(string $iso): int
    {
        $t = strtotime($iso);
        return $t === false ? 0 : $t;
    }

    /** @return array{date: string, time: string, weekday: string} in the venue's zone */
    public static function local(string $iso, string $tz): array
    {
        $d = (new DateTimeImmutable($iso))->setTimezone(self::zone($tz));
        return ['date' => $d->format('Y-m-d'), 'time' => $d->format('H:i'), 'weekday' => strtolower($d->format('D'))];
    }

    private static function zone(string $tz): DateTimeZone
    {
        try {
            return new DateTimeZone($tz ?: 'Europe/Sofia');
        } catch (Exception) {
            return new DateTimeZone('Europe/Sofia');
        }
    }

    public static function format_datetime(string $iso, string $lang, string $tz): string
    {
        $d = (new DateTimeImmutable($iso))->setTimezone(self::zone($tz));
        return $lang === 'en' ? $d->format('j M Y, H:i') : $d->format('d.m.Y, H:i');
    }

    public static function format_date(string $date, string $lang): string
    {
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if ($d === false) {
            return $date;
        }
        return $lang === 'en' ? $d->format('j M Y') : $d->format('d.m.Y');
    }

    private static function is_holiday(string $date, array $holidays): ?array
    {
        foreach ($holidays as $h) {
            if (($h['date'] ?? '') === $date) {
                return $h;
            }
        }
        return null;
    }

    /** The first opening instant strictly after $now within 14 days (ISO 8601 with offset), or null. */
    public static function next_opening(array $hours, array $holidays, string $now, string $tz): ?string
    {
        $zone = self::zone($tz);
        $nowTs = self::ms($now);
        $start = (new DateTimeImmutable($now))->setTimezone($zone)->setTime(0, 0);
        for ($i = 0; $i < self::LOOKAHEAD_DAYS; $i++) {
            $day = $start->modify("+$i day");
            $date = $day->format('Y-m-d');
            $dh = $hours[strtolower($day->format('D'))] ?? null;
            if (!is_array($dh) || self::is_holiday($date, $holidays) !== null) {
                continue;
            }
            $open = new DateTimeImmutable($date . ' ' . $dh['open'], $zone);
            if ($open->getTimestamp() > $nowTs) {
                return $open->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:sP');
            }
        }
        return null;
    }

    /** @return array{state: string, until?: string, at?: string, next?: ?string, holiday: ?array} like todayStatus() in hours.ts */
    public static function today_status(array $hours, array $holidays, string $now, string $tz): array
    {
        $l = self::local($now, $tz);
        $holiday = self::is_holiday($l['date'], $holidays);
        $dh = $hours[$l['weekday']] ?? null;
        if (is_array($dh) && $holiday === null) {
            if ($l['time'] < $dh['open']) {
                return ['state' => 'opens_later', 'at' => $dh['open'], 'holiday' => null];
            }
            if ($l['time'] < $dh['close']) {
                return ['state' => 'open', 'until' => $dh['close'], 'holiday' => null];
            }
        }
        return ['state' => 'closed', 'next' => self::next_opening($hours, $holidays, $now, $tz), 'holiday' => $holiday];
    }

    // ---- read-time rules ------------------------------------------------------------------------

    private static function is_sold_out(array $item, int $nowTs): bool
    {
        return !empty($item['sold_out_until']) && self::ms((string) $item['sold_out_until']) > $nowTs;
    }

    private static function is_live_special(array $item, int $nowTs): bool
    {
        if (empty($item['is_special']) || empty($item['active'])) {
            return false;
        }
        return empty($item['special_expires_at']) || self::ms((string) $item['special_expires_at']) > $nowTs;
    }

    private static function visible_items(array $items, int $nowTs): array
    {
        return array_values(array_filter($items, static fn(array $i): bool => !empty($i['active']) && (empty($i['is_special']) || self::is_live_special($i, $nowTs))));
    }

    private static function by_position(array $rows): array
    {
        usort($rows, static fn(array $a, array $b): int => ((int) ($a['position'] ?? 0)) <=> ((int) ($b['position'] ?? 0)));
        return $rows;
    }

    private static function media_url(array $state, ?string $id): ?string
    {
        if (!$id) {
            return null;
        }
        foreach ($state['media'] ?? [] as $m) {
            if (($m['id'] ?? null) === $id) {
                return (string) ($m['public_url'] ?? '') ?: null;
            }
        }
        return null;
    }

    // ---- wrappers ---------------------------------------------------------------------------------

    public static function wrap(string $block, string $inner, array $state): string
    {
        $accent = (string) ($state['venue']['theme']['accent'] ?? '');
        if (!preg_match('/^#[0-9a-fA-F]{6}$/', $accent)) {
            $accent = '#2f6b4f';
        }
        return '<div class="sm sm-' . esc_attr($block) . '" style="--sm-accent:' . esc_attr(strtolower($accent)) . '">' . $inner . '</div>';
    }

    /** An HTML comment for guests plus a visible note for admins; never leaks a stack trace. */
    public static function unavailable(WP_Error $e): string
    {
        $msg = wp_strip_all_tags($e->get_error_message());
        $out = '<!-- Site Manager: ' . str_replace('--', '- -', esc_html($msg)) . ' -->';
        if (current_user_can('manage_options')) {
            $out .= '<p class="sm sm-notice">' . esc_html($msg) . '</p>';
        }
        return $out;
    }

    // ---- blocks -------------------------------------------------------------------------------------

    public static function menu(array $state, string $now, string $lang): string
    {
        $nowTs = self::ms($now);
        $tz = (string) ($state['venue']['tz'] ?? 'Europe/Sofia');
        $items = self::visible_items($state['items'] ?? [], $nowTs);
        $sections = [];
        foreach (self::by_position(array_filter($state['categories'] ?? [], static fn(array $c): bool => !empty($c['active']))) as $c) {
            $list = self::by_position(array_filter($items, static fn(array $i): bool => ($i['category_id'] ?? null) === ($c['id'] ?? '')));
            if ($list) {
                $sections[] = [$c, $list];
            }
        }
        if (!$sections) {
            return self::wrap('menu', '<p class="sm-empty">' . esc_html(SM_Labels::get('noItems', $lang)) . '</p>', $state);
        }
        $used = [];
        $html = '';
        foreach ($sections as [$c, $list]) {
            $html .= '<section class="sm-section"><h2 class="sm-heading">' . esc_html(SM_Labels::pick($c, 'name', $lang)) . '</h2><ul class="sm-items">';
            foreach ($list as $i) {
                $sold = self::is_sold_out($i, $nowTs);
                $img = self::media_url($state, $i['image_media_id'] ?? null);
                $desc = SM_Labels::pick($i, 'desc', $lang);
                $html .= '<li class="sm-item' . ($sold ? ' sm-sold-out' : '') . '">';
                if ($img !== null) {
                    $html .= '<img class="sm-thumb" src="' . esc_url($img) . '" alt="' . esc_attr(SM_Labels::pick($i, 'name', $lang)) . '" loading="lazy" width="64" height="64">';
                }
                $html .= '<div class="sm-item-body"><div class="sm-item-row"><h3 class="sm-item-name">' . esc_html(SM_Labels::pick($i, 'name', $lang)) . '</h3><span class="sm-price">' . esc_html(SM_Labels::price((float) ($i['price_eur'] ?? 0), $lang)) . '</span></div>';
                if ($desc !== '') {
                    $html .= '<p class="sm-desc">' . esc_html($desc) . '</p>';
                }
                $chips = '';
                if ($sold) {
                    $chips .= '<span class="sm-chip sm-chip-sold">' . esc_html(SM_Labels::get('soldOutUntil', $lang, ['when' => self::format_datetime((string) $i['sold_out_until'], $lang, $tz)])) . '</span>';
                }
                foreach ($i['allergens'] ?? [] as $a) {
                    $a = (int) $a;
                    $used[$a] = true;
                    $chips .= '<span class="sm-chip sm-chip-allergen" title="' . esc_attr(SM_Labels::allergen($a, $lang)) . '">' . $a . '<span class="sm-sr">' . esc_html(' ' . SM_Labels::allergen($a, $lang)) . '</span></span>';
                }
                if ($chips !== '') {
                    $html .= '<div class="sm-chips">' . $chips . '</div>';
                }
                $html .= '</div></li>';
            }
            $html .= '</ul></section>';
        }
        if ($used) {
            ksort($used);
            $html .= '<section class="sm-legend"><h2 class="sm-legend-title">' . esc_html(SM_Labels::get('allergenLegend', $lang)) . '</h2><dl>';
            foreach (array_keys($used) as $a) {
                $html .= '<div><dt>' . (int) $a . '</dt><dd>' . esc_html(SM_Labels::allergen((int) $a, $lang)) . '</dd></div>';
            }
            $html .= '</dl></section>';
        }
        return self::wrap('menu', $html, $state);
    }

    public static function specials(array $state, string $now, string $lang): string
    {
        $nowTs = self::ms($now);
        $tz = (string) ($state['venue']['tz'] ?? 'Europe/Sofia');
        $specials = self::by_position(array_filter(self::visible_items($state['items'] ?? [], $nowTs), static fn(array $i): bool => !empty($i['is_special'])));
        if (!$specials) {
            return '';
        }
        $html = '<h2 class="sm-heading">' . esc_html(SM_Labels::get('specials', $lang)) . '</h2><ul class="sm-cards">';
        foreach ($specials as $i) {
            $img = self::media_url($state, $i['image_media_id'] ?? null);
            $desc = SM_Labels::pick($i, 'desc', $lang);
            $html .= '<li class="sm-card">';
            if ($img !== null) {
                $html .= '<img class="sm-card-img" src="' . esc_url($img) . '" alt="' . esc_attr(SM_Labels::pick($i, 'name', $lang)) . '" loading="lazy">';
            }
            $html .= '<div class="sm-card-body"><div class="sm-item-row"><h3 class="sm-item-name">' . esc_html(SM_Labels::pick($i, 'name', $lang)) . '</h3><span class="sm-price">' . esc_html(SM_Labels::price((float) ($i['price_eur'] ?? 0), $lang)) . '</span></div>';
            if ($desc !== '') {
                $html .= '<p class="sm-desc">' . esc_html($desc) . '</p>';
            }
            if (!empty($i['special_expires_at'])) {
                $html .= '<span class="sm-chip sm-chip-until">' . esc_html(SM_Labels::get('specialUntil', $lang, ['time' => self::local((string) $i['special_expires_at'], $tz)['time']])) . '</span>';
            }
            $html .= '</div></li>';
        }
        return self::wrap('specials', $html . '</ul>', $state);
    }

    public static function hours(array $state, string $now, string $lang): string
    {
        $v = $state['venue'];
        $tz = (string) ($v['tz'] ?? 'Europe/Sofia');
        $hours = is_array($v['hours'] ?? null) ? $v['hours'] : [];
        $holidays = $state['holidays'] ?? [];
        $s = self::today_status($hours, $holidays, $now, $tz);
        $text = match ($s['state']) {
            'open' => SM_Labels::get('openUntil', $lang, ['time' => $s['until']]),
            'opens_later' => SM_Labels::get('opensAt', $lang, ['time' => $s['at']]),
            default => $s['next'] ? SM_Labels::get('closedUntil', $lang, ['when' => self::format_datetime((string) $s['next'], $lang, $tz)]) : SM_Labels::get('closedToday', $lang),
        };
        $cls = $s['state'] === 'open' ? 'open' : ($s['state'] === 'opens_later' ? 'later' : 'closed');
        $html = '<p class="sm-status sm-status-' . $cls . '"><span class="sm-dot" aria-hidden="true"></span>' . esc_html($text) . '</p>';
        if ($s['holiday'] !== null) {
            $note = SM_Labels::pick($s['holiday'], 'note', $lang);
            if ($note !== '') {
                $html .= '<p class="sm-note">' . esc_html($note) . '</p>';
            }
        }
        $today = self::local($now, $tz);
        $html .= '<h2 class="sm-heading">' . esc_html(SM_Labels::get('hours', $lang)) . '</h2><table class="sm-table"><tbody>';
        foreach (self::WEEKDAYS as $d) {
            $dh = $hours[$d] ?? null;
            $isToday = $d === $today['weekday'];
            $html .= '<tr' . ($isToday ? ' aria-current="date" class="sm-today"' : '') . '><th scope="row">' . esc_html(SM_Labels::weekday($d, $lang)) . '</th><td>' . esc_html(is_array($dh) ? substr((string) $dh['open'], 0, 5) . '–' . substr((string) $dh['close'], 0, 5) : SM_Labels::get('closedDay', $lang)) . '</td></tr>';
        }
        $html .= '</tbody></table>';
        $upcoming = array_values(array_filter($holidays, static fn(array $h): bool => ($h['date'] ?? '') >= $today['date']));
        usort($upcoming, static fn(array $a, array $b): int => strcmp((string) $a['date'], (string) $b['date']));
        if ($upcoming) {
            $html .= '<h3 class="sm-subheading">' . esc_html(SM_Labels::get('holidays', $lang)) . '</h3><ul class="sm-holidays">';
            foreach ($upcoming as $h) {
                $note = SM_Labels::pick($h, 'note', $lang);
                $html .= '<li><strong>' . esc_html(self::format_date((string) $h['date'], $lang)) . '</strong>' . ($note !== '' ? ' · ' . esc_html($note) : '') . '</li>';
            }
            $html .= '</ul>';
        }
        $find = '';
        if (!empty($v['address'])) {
            $find .= '<p class="sm-address">' . esc_html((string) $v['address']) . '</p>';
        }
        $links = '';
        if (!empty($v['maps_url'])) {
            $links .= '<li><a class="sm-btn sm-btn-primary" href="' . esc_url((string) $v['maps_url']) . '" target="_blank" rel="noopener noreferrer">' . esc_html(SM_Labels::get('map', $lang)) . '</a></li>';
        }
        if (!empty($v['phone'])) {
            $tel = preg_replace('/[^\d+]/', '', (string) $v['phone']) ?? '';
            $links .= '<li><a class="sm-btn" href="' . esc_url('tel:' . $tel) . '">' . esc_html(SM_Labels::get('call', $lang) . ' ' . $v['phone']) . '</a></li>';
        }
        if (!empty($v['instagram'])) {
            $handle = preg_replace('#^https?://(www\.)?instagram\.com/#', '', trim((string) $v['instagram'])) ?? '';
            $handle = preg_replace('#/.*$#', '', ltrim($handle, '@')) ?? '';
            $links .= '<li><a class="sm-btn" href="' . esc_url('https://instagram.com/' . rawurlencode($handle)) . '" target="_blank" rel="noopener noreferrer">Instagram @' . esc_html($handle) . '</a></li>';
        }
        if ($find !== '' || $links !== '') {
            $html .= '<h3 class="sm-subheading">' . esc_html(SM_Labels::get('findUs', $lang)) . '</h3>' . $find . ($links !== '' ? '<ul class="sm-links">' . $links . '</ul>' : '');
        }
        return self::wrap('hours', $html, $state);
    }

    public static function announcements(array $state, string $now, string $lang): string
    {
        $nowTs = self::ms($now);
        $live = array_values(array_filter($state['announcements'] ?? [], static fn(array $a): bool => empty($a['expires_at']) || self::ms((string) $a['expires_at']) > $nowTs));
        if (!$live) {
            return '';
        }
        $html = '<ul class="sm-announcements">';
        foreach ($live as $a) {
            $html .= '<li class="sm-announcement">' . esc_html(SM_Labels::pick($a, 'text', $lang)) . '</li>';
        }
        return self::wrap('announcements', $html . '</ul>', $state);
    }

    public static function photos(array $state, string $now, string $lang): string
    {
        $gallery = self::by_position(array_filter($state['media'] ?? [], static fn(array $m): bool => !empty($m['is_gallery']) && (string) ($m['public_url'] ?? '') !== ''));
        if (!$gallery) {
            return '';
        }
        $name = (string) ($state['venue']['name'] ?? '');
        $html = '<ul class="sm-grid">';
        foreach ($gallery as $n => $m) {
            $html .= '<li><figure class="sm-photo"><img src="' . esc_url((string) $m['public_url']) . '" alt="' . esc_attr(trim($name . ', ' . ($n + 1))) . '" loading="lazy"></figure></li>';
        }
        return self::wrap('photos', $html . '</ul>', $state);
    }

    /** One text: welcome, footer_note, tagline, about, address, phone, instagram, name. Empty string for unknown keys. */
    public static function text(array $state, string $key, string $lang): string
    {
        $v = $state['venue'];
        $value = match ($key) {
            'welcome', 'footer_note' => (static function () use ($state, $key, $lang): string {
                foreach ($state['texts'] ?? [] as $t) {
                    if (($t['key'] ?? '') === $key) {
                        return SM_Labels::pick($t, 'text', $lang);
                    }
                }
                return '';
            })(),
            'tagline', 'about' => SM_Labels::pick($v, $key, $lang),
            'address', 'phone', 'instagram' => (string) ($v[$key] ?? ''),
            'name' => (string) ($v['name'] ?? ''),
            default => null,
        };
        if ($value === null || $value === '') {
            return '';
        }
        return '<span class="sm sm-text sm-text-' . esc_attr($key) . '">' . esc_html($value) . '</span>';
    }
}
