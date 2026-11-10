Markdown renderer for A2UI using markdown-it and dompurify.

This is used across all JS renderers, so the configuration is consistent. This
package provides a pre-configured `renderMarkdown` function that is injected
into the respective Markdown Renderer service of each renderer.

(See the `samples` directory for examples and the README of each renderer on
how to use this package.)

## Links and images

`renderMarkdown` follows the A2UI Markdown subset: links render as their text,
images as their alt text, and raw HTML as text. To render links or images, create
a renderer with `createMarkdownRenderer` and register it in place of
`renderMarkdown`:

```ts
import {createMarkdownRenderer} from '@a2ui/markdown-it';

setMarkdownRenderer(createMarkdownRenderer({allowLinks: true, allowImages: true}));
```

Every link `href` is checked as a `navigation` URL and every image `src` as a
`media` URL through `MarkdownRendererOptions.sanitizeUrl`. A2UI `Text`
components fill it in with their surface's URL security policy, so the
`urlSecurityPolicy` set on the message processor decides which links and images
render. A blocked link renders as its text and a blocked image as its alt text.
Without a `sanitizeUrl`, the built-in URL baseline checks still apply.

## Development

### Build

Run `yarn build` to build the project. The build artifacts will be stored in the `dist/` directory.

### Running unit tests

Run `yarn test` to execute the unit tests.

> [!NOTE]
> This package uses `dompurify` which requires a Window object. For unit testing in a Node.js environment, `jsdom` must be provided globally before importing the renderer.

### Code Formatting

This project uses [Prettier](https://prettier.io/) for code formatting. The configuration is defined in `../.prettierrc`.

To format all files in the project:

```bash
yarn format
```

To check the format, run:

```bash
npx run format:check
```

Most IDEs (like VS Code) can be configured to **Format On Save** using the local Prettier version and configuration. This is the recommended workflow.
