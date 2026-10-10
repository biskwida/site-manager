<?php
// Guest-facing labels in both languages, keyed like `site.*` in src/i18n/dicts.ts. Not tied to the WordPress locale:
// a block's `lang` attribute (or the venue's default language) decides.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Labels
{
    private const BG = [
        'menu' => 'Меню',
        'openUntil' => 'Отворено до {time}',
        'opensAt' => 'Отваря днес в {time}',
        'closedToday' => 'Днес е почивен ден',
        'closedUntil' => 'Затворено · отваря {when}',
        'specials' => 'Специални предложения днес',
        'specialUntil' => 'до {time}',
        'about' => 'За нас',
        'hours' => 'Работно време',
        'closedDay' => 'почивен ден',
        'holidays' => 'Предстоящи почивни дни',
        'findUs' => 'Къде сме',
        'map' => 'Отвори в картата',
        'call' => 'Обади се',
        'gallery' => 'Галерия',
        'soldOut' => 'Изчерпано',
        'soldOutUntil' => 'Изчерпано до {when}',
        'allergens' => 'Алергени',
        'allergenLegend' => 'Кодове на алергените (ЕС 1169/2011)',
        'noItems' => 'Менюто се подготвя.',
        'poweredBy' => 'Сайт от Site Manager',
        'unavailable' => 'Менюто не може да се зареди в момента.',
    ];
    private const EN = [
        'menu' => 'Menu',
        'openUntil' => 'Open until {time}',
        'opensAt' => 'Opens today at {time}',
        'closedToday' => 'Closed today',
        'closedUntil' => 'Closed · opens {when}',
        'specials' => "Today's specials",
        'specialUntil' => 'until {time}',
        'about' => 'About us',
        'hours' => 'Opening hours',
        'closedDay' => 'closed',
        'holidays' => 'Upcoming closures',
        'findUs' => 'Find us',
        'map' => 'Open in Maps',
        'call' => 'Call',
        'gallery' => 'Gallery',
        'soldOut' => 'Sold out',
        'soldOutUntil' => 'Sold out until {when}',
        'allergens' => 'Allergens',
        'allergenLegend' => 'Allergen codes (EU 1169/2011)',
        'noItems' => 'The menu is being prepared.',
        'poweredBy' => 'Site by Site Manager',
        'unavailable' => 'The menu cannot be loaded right now.',
    ];
    private const WEEKDAYS = [
        'mon' => ['bg' => 'пон', 'en' => 'Mon'],
        'tue' => ['bg' => 'вт', 'en' => 'Tue'],
        'wed' => ['bg' => 'ср', 'en' => 'Wed'],
        'thu' => ['bg' => 'четв', 'en' => 'Thu'],
        'fri' => ['bg' => 'пет', 'en' => 'Fri'],
        'sat' => ['bg' => 'съб', 'en' => 'Sat'],
        'sun' => ['bg' => 'нед', 'en' => 'Sun'],
    ];
    /** Regulation (EU) 1169/2011, Annex II. */
    private const ALLERGENS = [
        1 => ['bg' => 'Глутен', 'en' => 'Gluten'],
        2 => ['bg' => 'Ракообразни', 'en' => 'Crustaceans'],
        3 => ['bg' => 'Яйца', 'en' => 'Eggs'],
        4 => ['bg' => 'Риба', 'en' => 'Fish'],
        5 => ['bg' => 'Фъстъци', 'en' => 'Peanuts'],
        6 => ['bg' => 'Соя', 'en' => 'Soybeans'],
        7 => ['bg' => 'Мляко', 'en' => 'Milk'],
        8 => ['bg' => 'Ядки', 'en' => 'Nuts'],
        9 => ['bg' => 'Целина', 'en' => 'Celery'],
        10 => ['bg' => 'Горчица', 'en' => 'Mustard'],
        11 => ['bg' => 'Сусам', 'en' => 'Sesame'],
        12 => ['bg' => 'Сулфити', 'en' => 'Sulphites'],
        13 => ['bg' => 'Лупина', 'en' => 'Lupin'],
        14 => ['bg' => 'Мекотели', 'en' => 'Molluscs'],
    ];

    public static function get(string $key, string $lang, array $vars = []): string
    {
        $table = $lang === 'en' ? self::EN : self::BG;
        $s = $table[$key] ?? $key;
        foreach ($vars as $k => $v) {
            $s = str_replace('{' . $k . '}', (string) $v, $s);
        }
        return $s;
    }

    /** "bg" or "en": the requested one when valid, otherwise the venue's default language, otherwise "bg". */
    public static function lang(string $requested, array $state): string
    {
        $r = strtolower(trim($requested));
        if ($r === 'bg' || $r === 'en') {
            return $r;
        }
        $d = $state['venue']['default_lang'] ?? 'bg';
        return $d === 'en' ? 'en' : 'bg';
    }

    /** "2,90 €" (bg) / "€2.90" (en), like formatPrice in src/domain/format.ts. */
    public static function price(float $eur, string $lang): string
    {
        return $lang === 'en' ? '€' . number_format($eur, 2, '.', '') : number_format($eur, 2, ',', '') . ' €';
    }

    public static function weekday(string $day, string $lang): string
    {
        return self::WEEKDAYS[$day][$lang === 'en' ? 'en' : 'bg'] ?? $day;
    }

    public static function allergen(int $code, string $lang): string
    {
        return self::ALLERGENS[$code][$lang === 'en' ? 'en' : 'bg'] ?? (string) $code;
    }

    /** Picks the field in the reader's language, falling back to the other one (itemName/categoryName in format.ts). */
    public static function pick(array $row, string $field, string $lang): string
    {
        $mine = (string) ($row[$field . '_' . $lang] ?? '');
        if ($mine !== '') {
            return $mine;
        }
        return (string) ($row[$field . '_bg'] ?? '') ?: (string) ($row[$field . '_en'] ?? '');
    }
}
