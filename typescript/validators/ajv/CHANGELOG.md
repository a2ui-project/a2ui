# Changelog

## Unreleased

- Check `format: 'uri'` by default, as web_core's `Catalog.fromJson` and basic catalogs did before they used JSON Schema: a `uri` string must be non-empty and hold no whitespace inside it, so `openUrl` still takes a relative URL. Other formats stay annotations unless `{formats: true}` is passed ([#4173](https://github.com/a2ui-project/a2ui/issues/4173), [#4187](https://github.com/a2ui-project/a2ui/pull/4187)).

## 0.1.0

- Initial release.
