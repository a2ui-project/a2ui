/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Theme registry for visual parity tests.
 * Maps theme names to theme objects for URL-based theme selection.
 */

import {litTheme} from '@a2ui/react';
import {visualParityTheme} from './visualParityTheme';
import {minimalTheme} from './minimalTheme';
import type {Types} from '@a2ui/lit/0.8';

/**
 * Registry of themes available for visual parity testing.
 *
 * - `default`: No theme (undefined) - tests fallback/default styling
 * - `lit`: The litTheme from @a2ui/react - default A2UI styling
 * - `visualParity`: Alternate theme with different styling choices
 * - `minimal`: Stripped-down neutral theme for structural testing
 */
export const testThemes: Record<string, Types.Theme | undefined> = {
  default: undefined, // No theme - tests fallback styling
  lit: litTheme,
  visualParity: visualParityTheme,
  minimal: minimalTheme,
};

export type ThemeName = keyof typeof testThemes;
export const themeNames = Object.keys(testThemes) as ThemeName[];

/**
 * Get a theme by name from the registry.
 * Returns undefined for 'default' or unknown theme names.
 */
export function getTheme(name: string | null): Types.Theme | undefined {
  if (!name || !(name in testThemes)) {
    return testThemes.default;
  }
  return testThemes[name];
}

// Re-export individual themes
export {litTheme} from '@a2ui/react';
export {visualParityTheme} from './visualParityTheme';
export {minimalTheme} from './minimalTheme';
