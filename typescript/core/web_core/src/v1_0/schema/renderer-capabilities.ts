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

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/v1.0/json/ via src/v1_0/scripts/generate-schemas.mjs
import {z} from 'zod';

/** Zod schema validating the strict v1.0 protocol renderer capabilities payload. */
export const V10RendererCapabilitiesSchema = z
  .object({
    'supportedCatalogIds': z
      .array(z.string())
      .describe(
        'An array of string identifiers for each of the component and function catalogs supported by the renderer. Multiple catalogs can be mixed in a single surface.',
      ),
    'inlineCatalogs': z
      .array(z.record(z.string(), z.any()))
      .describe(
        "An array of inline catalog definitions, which can contain both components and functions. This should only be provided if the agent declares 'acceptsInlineCatalogs: true' in its capabilities.",
      )
      .optional(),
  })
  .describe('The capabilities structure for version 1.0 of the A2UI protocol.');
export type V10RendererCapabilities = z.infer<typeof V10RendererCapabilitiesSchema>;
