<?php
// Write-channel pure logic: compute_after, placeholders, Elementor replacements, text extraction.
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/site-manager/includes/class-sm-pages.php';
SM_Pages::$attachment_lookup = 'sm_test_find_attachment';

$before = ['title' => 'About', 'content' => '<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->', 'elementor_data' => null, 'featured_media' => null];

$ok = SM_Pages::compute_after($before, ['replacements' => [['find' => 'banitsa every morning', 'replace' => 'banitsa and kozunak every morning']]], 'gutenberg', [], false);
check('replace once', is_array($ok) && $ok['content'] === '<!-- wp:paragraph --><p>We bake banitsa and kozunak every morning.</p><!-- /wp:paragraph -->' && $ok['title'] === 'About');
$twice = SM_Pages::compute_after($before, ['replacements' => [['find' => 'e', 'replace' => 'x']]], 'gutenberg', [], false);
check('replace refuses two matches', is_wp_error($twice) && $twice->get_error_code() === 'sm_replace_failed' && $twice->get_error_data()['count'] > 1);
$none = SM_Pages::compute_after($before, ['replacements' => [['find' => 'croissant', 'replace' => 'x']]], 'gutenberg', [], false);
check('replace refuses zero matches', is_wp_error($none) && $none->get_error_data()['count'] === 0 && $none->get_error_data()['find'] === 'croissant');
$title = SM_Pages::compute_after($before, ['title' => 'About us', 'featured_media' => 12], 'classic', [], false);
check('title and featured', is_array($title) && $title['title'] === 'About us' && $title['featured_media'] === 12 && $title['content'] === $before['content']);
$unknown = SM_Pages::compute_after($before, ['content' => 'x'], 'unknown', [], false);
check('unknown builder refused', is_wp_error($unknown) && $unknown->get_error_code() === 'sm_builder_unsupported');

$el = ['title' => 'Events', 'content' => '', 'elementor_data' => json_encode([['id' => 'a1', 'elType' => 'widget', 'settings' => ['title' => 'Live jazz on Fridays']], ['id' => 'a2', 'elType' => 'section', 'settings' => [], 'elements' => [['id' => 'a3', 'elType' => 'widget', 'settings' => ['editor' => '<p>Doors open at 19:00.</p>']]]]]), 'featured_media' => null];
$elOk = SM_Pages::compute_after($el, ['replacements' => [['find' => '19:00', 'replace' => '20:00']]], 'elementor', [], false);
check('elementor nested replacement', is_array($elOk) && json_decode((string) $elOk['elementor_data'], true)[1]['elements'][0]['settings']['editor'] === '<p>Doors open at 20:00.</p>');
$elFull = SM_Pages::compute_after($el, ['content' => '<p>x</p>'], 'elementor', [], false);
check('elementor refuses full content', is_wp_error($elFull) && $elFull->get_error_data()['builder'] === 'elementor');
check('elementor texts', SM_Pages::elementor_texts($el['elementor_data']) === ['Live jazz on Fridays', '<p>Doors open at 19:00.</p>']);
check('elementor unicode survives', has((string) $elOk['elementor_data'], 'Live jazz') && !has((string) $elOk['elementor_data'], '\u'));

$GLOBALS['sm_test_attachments']['m-1'] = ['id' => 101, 'url' => 'https://cafe.example/wp-content/uploads/m-1.jpg'];
$ph = SM_Pages::resolve_placeholders('<img src="{{sm_media_url:m-1}}" data-id="{{sm_media_id:m-1}}"> {{sm_media_url:m-2}}', ['{{sm_media_url:m-2}}' => 'https://cdn.example/m-2.jpg'], true);
check('placeholders from the map and the library', $ph === '<img src="https://cafe.example/wp-content/uploads/m-1.jpg" data-id="101"> https://cdn.example/m-2.jpg', is_string($ph) ? $ph : $ph->get_error_message());
$bad = SM_Pages::resolve_placeholders('{{sm_media_url:nope}}', [], true);
check('strict placeholder error', is_wp_error($bad) && $bad->get_error_code() === 'sm_invalid' && $bad->get_error_data()['placeholder'] === '{{sm_media_url:nope}}');
check('lenient keeps unknown placeholders', SM_Pages::resolve_placeholders('{{sm_media_url:nope}}', [], false) === '{{sm_media_url:nope}}');
check('text extraction strips blocks and tags', SM_Pages::text_from_content($before['content']) === 'We bake banitsa every morning.');
