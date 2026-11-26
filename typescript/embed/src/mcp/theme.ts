/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';

/** The class of the element the app renders into. */
export const EMBED_ROOT_CLASS = 'a2ui-embed';

/**
 * The app's stylesheet.
 *
 * It maps the MCP Apps host style variables onto the A2UI basic catalog theme, so the surfaces
 * follow the host theme. Every mapping falls back to the basic catalog default, because hosts
 * may omit any variable. The document text uses the host's `--font-sans` and
 * `--color-text-primary`. All rules use `:where()`, so any rule on `.a2ui-embed` overrides them.
 */
export const EMBED_STYLES = `
:where(html, body) {
  margin: 0;
  background: var(--color-background-primary, transparent);
  color: var(--color-text-primary, light-dark(#333, #eee));
  font-family: var(--font-sans, system-ui, sans-serif);
}

:where(.${EMBED_ROOT_CLASS}) {
  --a2ui-color-background: var(--color-background-primary, light-dark(#eee, #111));
  --a2ui-color-on-background: var(--color-text-primary, light-dark(#333, #eee));
  --a2ui-color-surface: var(--color-background-secondary, light-dark(#f7f7f7, #1c1c1c));
  --a2ui-color-on-surface: var(--color-text-primary, light-dark(#333, #eee));
  --a2ui-color-primary: var(--color-ring-primary, #17e);
  --a2ui-color-secondary: var(--color-background-tertiary, light-dark(#ddd, #333));
  --a2ui-color-on-secondary: var(--color-text-primary, light-dark(#333, #eee));
  --a2ui-color-border: var(--color-border-primary, light-dark(#ccc, #444));
  --a2ui-color-input: var(--color-background-primary, light-dark(#fff, #2a2a2a));
  --a2ui-color-on-input: var(--color-text-primary, light-dark(#333, #eee));
  --a2ui-text-caption-color: var(--color-text-secondary, light-dark(#666, #aaa));
  --a2ui-border-radius: var(--border-radius-md, 0.25rem);
  --a2ui-border-width: var(--border-width-regular, 1px);
  --a2ui-font-family-monospace: var(--font-mono, monospace);

  display: block;
  box-sizing: border-box;
  max-width: var(--a2ui-embed-max-width, 960px);
  margin-inline: auto;
  padding: var(--a2ui-embed-padding, 0);
  color: var(--a2ui-color-on-background);
}

:where(.${EMBED_ROOT_CLASS}) :where(a2ui-surface) {
  display: block;
}

:where(.${EMBED_ROOT_CLASS}) :where(a2ui-surface + a2ui-surface) {
  margin-block-start: var(--a2ui-spacing-l, 1rem);
}

:where(.${EMBED_ROOT_CLASS}__status) {
  padding: var(--a2ui-spacing-m, 0.5rem);
  color: var(--a2ui-text-caption-color);
}

:where(.${EMBED_ROOT_CLASS}__error) {
  padding: var(--a2ui-spacing-l, 1rem);
  border: var(--a2ui-border-width) solid var(--a2ui-embed-error-border-color, var(--color-border-danger, light-dark(#e8a7a2, #8c1d18)));
  border-radius: var(--a2ui-border-radius);
  background: var(--a2ui-embed-error-background, var(--color-background-danger, light-dark(#fcecea, #410e0b)));
  color: var(--a2ui-embed-error-color, var(--color-text-danger, light-dark(#8c1d18, #f2b8b5)));
}

:where(.${EMBED_ROOT_CLASS}__error-title) {
  margin: 0 0 var(--a2ui-spacing-s, 0.25rem);
  font-size: inherit;
  font-weight: var(--font-weight-semibold, 600);
}

:where(.${EMBED_ROOT_CLASS}__error-message) {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

:where(.${EMBED_ROOT_CLASS}__notice) {
  display: flex;
  align-items: center;
  gap: var(--a2ui-spacing-m, 0.5rem);
  margin-block-end: var(--a2ui-spacing-m, 0.5rem);
  padding: var(--a2ui-spacing-s, 0.25rem) var(--a2ui-spacing-m, 0.5rem);
  border-radius: var(--a2ui-border-radius);
  background: var(--a2ui-embed-error-background, var(--color-background-danger, light-dark(#fcecea, #410e0b)));
  color: var(--a2ui-embed-error-color, var(--color-text-danger, light-dark(#8c1d18, #f2b8b5)));
}

:where(.${EMBED_ROOT_CLASS}__notice-text) {
  flex: 1;
  overflow-wrap: anywhere;
}

:where(.${EMBED_ROOT_CLASS}__notice-dismiss) {
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
`;

/** Adds {@link EMBED_STYLES} to the document once. */
export function injectEmbedStyles(document: Document): void {
  const id = `${EMBED_ROOT_CLASS}-styles`;
  if (document.getElementById(id)) {
    return;
  }
  const style = document.createElement('style');
  style.id = id;
  style.textContent = EMBED_STYLES;
  document.head.append(style);
}

/**
 * Applies the theme, style variables and fonts of a host context, or of the changed part of
 * one, to the document.
 */
export function applyHostContext(context: McpUiHostContext | undefined): void {
  if (context?.theme) {
    applyDocumentTheme(context.theme);
  }
  if (context?.styles?.variables) {
    applyHostStyleVariables(context.styles.variables);
  }
  if (context?.styles?.css?.fonts) {
    applyHostFonts(context.styles.css.fonts);
  }
}
