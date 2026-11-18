/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * CSS overrides and Light DOM surface styling for the A2UI Format Playground.
 */
export const playgroundThemeSheet = new CSSStyleSheet();
playgroundThemeSheet.replaceSync(`
:root,
:host {
  --_pg-shadow-1: light-dark(rgba(15, 23, 42, 0.06), rgba(0, 0, 0, 0.32));
  --_pg-shadow-2: light-dark(rgba(15, 23, 42, 0.04), rgba(0, 0, 0, 0.24));

  /* Typography */
  --a2ui-font-family-title: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --a2ui-line-height-headings: 1.25;
  --a2ui-line-height-body: 1.5;
  --a2ui-text-caption-color: light-dark(#64748b, #94a3b8);

  /* Surface & Border Tokens */
  --a2ui-color-surface: light-dark(#ffffff, rgba(30, 41, 59, 0.85));
  --a2ui-color-on-surface: light-dark(#0f172a, #f1f5f9);
  --a2ui-color-on-background: light-dark(#0f172a, #f1f5f9);
  --a2ui-color-border: light-dark(#e2e8f0, rgba(148, 163, 184, 0.2));

  /* Card Overrides */
  --a2ui-card-background: light-dark(#ffffff, rgba(30, 41, 59, 0.85));
  --a2ui-card-border: 1px solid light-dark(#e2e8f0, rgba(148, 163, 184, 0.2));
  --a2ui-card-box-shadow: 0 1px 3px var(--_pg-shadow-1), 0 4px 12px var(--_pg-shadow-2);
  --a2ui-card-border-radius: 14px;
  --a2ui-card-padding: 18px 20px;
  --a2ui-card-margin: 0;

  /* Spacing Tokens */
  --a2ui-column-gap: 16px;
  --a2ui-row-gap: 12px;
  --a2ui-list-gap: 10px;
  --a2ui-list-padding: 0;

  /* Divider Overrides */
  --a2ui-divider-spacing: 8px;
  --a2ui-divider-border: 1px solid light-dark(#e2e8f0, rgba(148, 163, 184, 0.2));

  /* Button Overrides */
  --a2ui-color-primary: #2563eb;
  --a2ui-color-primary-hover: light-dark(#1d4ed8, #3b82f6);
  --a2ui-color-on-primary: #ffffff;
  --a2ui-color-on-secondary: light-dark(#0f172a, #f1f5f9);
  --a2ui-color-secondary-hover: light-dark(#e2e8f0, rgba(51, 65, 85, 0.9));
  --a2ui-button-background: light-dark(#f8fafc, rgba(30, 41, 59, 0.9));
  --a2ui-button-border: 1px solid light-dark(#cbd5e1, rgba(148, 163, 184, 0.3));
  --a2ui-button-border-radius: 10px;
  --a2ui-button-margin: 0;
  --a2ui-button-font-weight: 500;
  --a2ui-button-padding: 0.5rem 1rem;
}

a2ui-surface {
  font-variant-numeric: tabular-nums;
}

/* Equal-height card stretching inside rows (keep height: auto so align-items: stretch works) */
a2ui-surface a2ui-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

a2ui-surface a2ui-card > .a2ui-card {
  flex: 1;
  box-sizing: border-box;
}

/* Keep ordered and unordered lists indented while unbulleted facts/steps lists stay flush */
a2ui-surface a2ui-list > ol.a2ui-list,
a2ui-surface a2ui-list > ul.a2ui-list {
  padding-inline-start: 1.25rem;
}

/* Non-italic crisp muted captions */
a2ui-surface .a2ui-text-caption {
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--a2ui-text-caption-color, light-dark(#64748b, #94a3b8));
}

a2ui-surface .a2ui-text-caption em {
  font-style: normal;
}

/* Subtle row hairline dividers between facts rows inside cards */
a2ui-surface a2ui-card .a2ui-list.a2ui-list-vertical > .a2ui-list-item-none + .a2ui-list-item-none {
  border-top: 1px solid light-dark(#f1f5f9, rgba(148, 163, 184, 0.14));
  padding-top: var(--a2ui-list-gap, 10px);
}

a2ui-surface .a2ui-button {
  font-family: inherit;
  font-size: 0.875rem;
  transition: background-color 0.15s ease;
}

/* Clip unmapped icon ligature fallback text inside the 24px icon box */
a2ui-surface .a2ui-icon {
  overflow: hidden;
}
`);
