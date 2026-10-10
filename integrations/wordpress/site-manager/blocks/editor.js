/* Site Manager blocks for the WordPress editor. Plain script, no build step: uses the wp.* globals. */
(function (wp) {
  'use strict';
  var registerBlockType = wp.blocks.registerBlockType;
  var el = wp.element.createElement;
  var Fragment = wp.element.Fragment;
  var InspectorControls = wp.blockEditor.InspectorControls;
  var PanelBody = wp.components.PanelBody;
  var SelectControl = wp.components.SelectControl;
  var ServerSideRender = wp.serverSideRender;
  var __ = wp.i18n.__;

  var LANGS = [
    { label: __('Venue default', 'site-manager'), value: 'auto' },
    { label: 'Български', value: 'bg' },
    { label: 'English', value: 'en' }
  ];
  var TEXT_KEYS = [
    { label: 'welcome', value: 'welcome' },
    { label: 'footer_note', value: 'footer_note' },
    { label: 'tagline', value: 'tagline' },
    { label: 'about', value: 'about' },
    { label: 'address', value: 'address' },
    { label: 'phone', value: 'phone' },
    { label: 'instagram', value: 'instagram' },
    { label: 'name', value: 'name' }
  ];
  var NAMES = ['menu', 'specials', 'hours', 'announcements', 'photos', 'text'];
  /* registers: 'site-manager/menu' 'site-manager/specials' 'site-manager/hours' 'site-manager/announcements' 'site-manager/photos' 'site-manager/text' */

  function edit(name) {
    return function (props) {
      var controls = [
        el(SelectControl, {
          key: 'lang',
          label: __('Language', 'site-manager'),
          value: props.attributes.lang,
          options: LANGS,
          onChange: function (lang) { props.setAttributes({ lang: lang }); }
        })
      ];
      if (name === 'text') {
        controls.push(el(SelectControl, {
          key: 'key',
          label: __('Text', 'site-manager'),
          value: props.attributes.key,
          options: TEXT_KEYS,
          onChange: function (key) { props.setAttributes({ key: key }); }
        }));
      }
      return el(Fragment, null,
        el(InspectorControls, null, el(PanelBody, { title: __('Site Manager', 'site-manager') }, controls)),
        el('div', wp.blockEditor.useBlockProps(), el(ServerSideRender, { block: 'site-manager/' + name, attributes: props.attributes }))
      );
    };
  }

  NAMES.forEach(function (name) {
    registerBlockType('site-manager/' + name, { edit: edit(name), save: function () { return null; } });
  });
})(window.wp);
