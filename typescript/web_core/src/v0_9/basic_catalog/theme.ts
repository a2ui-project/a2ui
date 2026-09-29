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

import {z} from 'zod';
import validateColor from 'validate-color';

export const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Validates whether a given string is a valid CSS color.
 *
 * Uses the web platform `CSS.supports('color', color)` API when available in
 * browser environments, and falls back to standard CSS color syntax validation
 * (via validate-color) in server-side / Node.js environments.
 */
export function isValidCssColor(color: unknown): boolean {
  if (typeof color !== 'string' || !color.trim()) {
    return false;
  }
  const trimmed = color.trim();
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    return CSS.supports('color', trimmed);
  }
  const fn = typeof validateColor === 'function' ? validateColor : (validateColor as any)?.default;
  return typeof fn === 'function' ? fn(trimmed) : false;
}

/**
 * Zod schema defining the theme configuration for the basic catalog.
 * Conforms to `specification/v0_9/catalogs/basic/catalog.json#/$defs/theme`.
 */
export const BasicCatalogThemeSchema = z
  .object({
    primaryColor: z
      .string()
      .refine(
        val => isValidCssColor(val),
        "primaryColor must be a valid CSS color (e.g. '#00BFFF', '#17e', 'red', 'rgb(255, 0, 0)')",
      )
      .optional()
      .describe(
        "The primary brand color used for highlights (e.g., primary buttons, active borders). Renderers may generate variants of this color for different contexts. Format: Hexadecimal code, named color, or functional notation (e.g., '#00BFFF', 'red', 'rgb(255, 0, 0)').",
      ),
    iconUrl: z
      .string()
      .optional()
      .describe(
        'A URL for an image that identifies the agent or tool associated with the surface.',
      ),
    agentDisplayName: z
      .string()
      .optional()
      .describe(
        'Text to be displayed next to the surface to identify the agent or tool that created it.',
      ),
  })
  .passthrough();

export type BasicCatalogTheme = z.infer<typeof BasicCatalogThemeSchema>;
