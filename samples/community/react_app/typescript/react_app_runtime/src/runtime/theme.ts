/*
 * Copyright 2026 Google LLC
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

import {useSyncExternalStore} from 'react';

import type {ThemeFontFace} from './fonts.js';

/** Theme tokens as the host sends them in `initialize` and `theme/changed`. */
export interface ThemeTokens {
  readonly colorScheme?: 'light' | 'dark';
  readonly cssVars?: Readonly<Record<string, string>>;
  /** Font faces of the theme fonts; see `loadFontFaces`. */
  readonly fontFaces?: readonly ThemeFontFace[];
}

/** The theme as the `a2ui` module exposes it (see `a2ui.d.ts`). */
export interface Theme {
  colorScheme: 'light' | 'dark';
  colors: {
    primary: string;
    onPrimary: string;
    secondary: string;
    background: string;
    onBackground: string;
    surface: string;
    onSurface: string;
    border: string;
  };
  fontFamily: string;
  cssVars: {[name: string]: string};
}

/** Values used when the host sends no variable for a color, close to the basic catalog defaults. */
const FALLBACK_COLORS: Theme['colors'] = {
  primary: '#1a73e8',
  onPrimary: '#ffffff',
  secondary: '#9aa0a6',
  background: '#ffffff',
  onBackground: '#1f1f1f',
  surface: '#ffffff',
  onSurface: '#1f1f1f',
  border: '#dadce0',
};

const FALLBACK_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** The CSS variable each theme color is read from. */
const COLOR_VARIABLES: Readonly<Record<keyof Theme['colors'], string>> = {
  primary: '--a2ui-color-primary',
  onPrimary: '--a2ui-color-on-primary',
  secondary: '--a2ui-color-secondary',
  background: '--a2ui-color-background',
  onBackground: '--a2ui-color-on-background',
  surface: '--a2ui-color-surface',
  onSurface: '--a2ui-color-on-surface',
  border: '--a2ui-color-border',
};

/**
 * The current theme. The object is updated in place, so code that reads `theme.colors.primary`
 * later sees the new value; `useTheme` re-renders on changes.
 */
export const theme: Theme = {
  colorScheme: 'light',
  colors: {...FALLBACK_COLORS},
  fontFamily: FALLBACK_FONT,
  cssVars: {},
};

const listeners = new Set<() => void>();
let version = 0;

function isSafeVariable(name: string, value: string): boolean {
  // Only custom properties, and no value that could close the declaration.
  return /^--a2ui-[a-z0-9-]+$/.test(name) && !/[;{}<>]/.test(value);
}

/**
 * Applies host theme tokens: sets every variable on `:root`, so `var(--a2ui-*)` updates without
 * a re-render, refreshes {@link theme} and notifies `useTheme`.
 */
export function applyTheme(
  tokens: ThemeTokens,
  root: HTMLElement = document.documentElement,
): void {
  const cssVars: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens.cssVars ?? {})) {
    if (typeof value === 'string' && isSafeVariable(name, value)) {
      cssVars[name] = value;
      root.style.setProperty(name, value);
    }
  }
  const colorScheme = tokens.colorScheme === 'dark' ? 'dark' : 'light';
  root.style.colorScheme = colorScheme;
  theme.colorScheme = colorScheme;
  theme.cssVars = cssVars;
  for (const key of Object.keys(COLOR_VARIABLES) as Array<keyof Theme['colors']>) {
    theme.colors[key] = cssVars[COLOR_VARIABLES[key]] || FALLBACK_COLORS[key];
  }
  theme.fontFamily = cssVars['--a2ui-font-family'] || FALLBACK_FONT;
  version++;
  for (const listener of [...listeners]) {
    listener();
  }
}

function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current theme; re-renders the component when the host theme changes. */
export function useTheme(): Theme {
  useSyncExternalStore(subscribeTheme, () => version);
  return theme;
}
