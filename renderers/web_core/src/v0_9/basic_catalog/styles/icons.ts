/*
 * Copyright 2026 Google LLC
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
 * A handful of `Icon` names don't have a Material Symbols ligature that
 * matches their camelCase-to-snake_case conversion, so they need an explicit
 * override instead (e.g. "play" is the ligature "play_arrow", not "play").
 */
const ICON_NAME_OVERRIDES: Record<string, string> = {
  play: 'play_arrow',
  rewind: 'fast_rewind',
  favoriteOff: 'favorite_border',
  starOff: 'star_border',
};

/**
 * Converts an `Icon` component's `name` (e.g. "shoppingCart") to the
 * corresponding Material Symbols font ligature (e.g. "shopping_cart"),
 * applying the overrides above where the ligature name diverges.
 */
export function toMaterialSymbol(name: string): string {
  if (ICON_NAME_OVERRIDES[name]) {
    return ICON_NAME_OVERRIDES[name];
  }
  return name
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}
