## Unreleased

- **BREAKING CHANGE**: `renderMarkdown` follows the A2UI Markdown subset: links render as their text and images as their alt text, instead of `<a>` and `<img>` elements. Recommended migration: to keep links or images, register `createMarkdownRenderer({allowLinks: true, allowImages: true})` instead; their URLs then go through `MarkdownRendererOptions.sanitizeUrl` (`navigation` for links, `media` for images), which A2UI `Text` components fill in with the surface's URL security policy. [#4115](https://github.com/a2ui-project/a2ui/pull/4115)
- Add `createMarkdownRenderer(options?)` and `MarkdownItRendererOptions` (`allowLinks`, `allowImages`). A blocked link renders as its text and a blocked image as its alt text; without a `sanitizeUrl`, the built-in URL baseline checks apply. [#4115](https://github.com/a2ui-project/a2ui/pull/4115)

## 0.2.2

- Bump dependencies for compatibility with `@a2ui/web_core: ^0.14.0`.
- Relocate package directory from `renderers/markdown/markdown-it` to `typescript/renderers/markdown-it`.

## 0.2.1

- Bump dependencies for compatibility with `@a2ui/web_core: ^0.13.0`.
- Enforce `noImplicitOverride: true` and forbid self-package imports ([#2878](https://github.com/a2ui-project/a2ui/pull/2878)).

## 0.2.0

- Re-export `MarkdownRenderer`, `MarkdownRendererOptions`, and `MarkdownRendererTagClassMap` directly from `@a2ui/web_core`.
- Bump dependencies for compatibility with `@a2ui/web_core: ^0.12.0`.

## 0.1.2

- Bump dependencies so the package is compatible with `@a2ui/web_core: ^0.11.0`.

## 0.1.1

- Enable `inlineSources` in `tsconfig.json` to populate `sourcesContent` in sourcemaps.

## 0.1.0

- Bump dependencies so the package is compatible with `@a2ui/web_core: ^0.10.3`.

## 0.0.2

- Made the markdown renderer async to support async markdown renderers.

## 0.0.1

- Initial release
