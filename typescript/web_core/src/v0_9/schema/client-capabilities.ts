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
// Generated from specification/v0_9/json/ via scripts/generate-zod-schemas.mjs
import {z} from 'zod';

export type JsonSchema = Record<string, any>;

export const FunctionDefinitionSchema = z
  .object({
    'name': z.string().describe('The unique name of the function.'),
    'description': z
      .string()
      .describe('A human-readable description of what the function does and how to use it.')
      .optional(),
    'parameters': z.record(z.string(), z.any()),
    'returnType': z
      .enum(['string', 'number', 'boolean', 'array', 'object', 'any', 'void'])
      .describe('The type of value this function returns.'),
  })
  .strict()
  .describe("Describes a function's interface.");
export type FunctionDefinition = z.infer<typeof FunctionDefinitionSchema>;

export const InlineCatalogSchema = z
  .object({
    'catalogId': z.string().describe('Unique identifier for this catalog.'),
    'components': z
      .record(z.string(), z.record(z.string(), z.any()))
      .describe('Definitions for UI components supported by this catalog.')
      .optional(),
    'functions': z
      .array(FunctionDefinitionSchema)
      .describe('Definitions for functions supported by this catalog.')
      .optional(),
    'theme': z
      .record(z.string(), z.record(z.string(), z.any()))
      .describe(
        "A schema that defines a catalog of A2UI theme properties. Each key is a theme property name (e.g. 'primaryColor'), and each value is the JSON schema for that property.",
      )
      .optional(),
  })
  .strict()
  .describe('A collection of component and function definitions.');
export type InlineCatalog = z.infer<typeof InlineCatalogSchema>;

export const A2uiVersionCapabilitiesSchema = z
  .object({
    'supportedCatalogIds': z
      .array(z.string())
      .describe(
        'An array of string identifiers for each of the component and function catalogs supported by the client.',
      ),
    'inlineCatalogs': z
      .array(InlineCatalogSchema)
      .describe(
        "An array of inline catalog definitions, which can contain both components and functions. This should only be provided if the agent declares 'acceptsInlineCatalogs: true' in its capabilities.",
      )
      .optional(),
  })
  .describe('The capabilities structure for version 0.9 of the A2UI protocol.');
export type A2uiVersionCapabilities = z.infer<typeof A2uiVersionCapabilitiesSchema>;

export type A2uiClientCapabilities =
  | {
      'v0.9': A2uiVersionCapabilities;
      'v0.9.1'?: A2uiVersionCapabilities;
    }
  | {
      'v0.9'?: A2uiVersionCapabilities;
      'v0.9.1': A2uiVersionCapabilities;
    };
