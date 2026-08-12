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

/** JSON Schema representation type. */
export type JsonSchema = Record<string, any>;

/** Function interface definition inside an inline catalog. */
export interface FunctionDefinition {
  /** Name of the function. */
  name: string;
  /** Human-readable description of function purpose. */
  description?: string;
  /** JSON Schema of expected parameters object. */
  parameters: JsonSchema;
  /** Expected return type of function. */
  returnType:
    | 'string'
    | 'number'
    | 'boolean'
    | 'array'
    | 'object'
    | 'any'
    | 'void'
    | 'validationResult';
}

/** Inline catalog definition structure. */
export interface InlineCatalog {
  /** Unique string identifier for catalog. */
  catalogId: string;
  /** Record of component definitions. */
  components?: Record<string, JsonSchema>;
  /** Array of function definitions. */
  functions?: FunctionDefinition[];
  /** Theme schema definitions. */
  theme?: Record<string, JsonSchema>;
}

/** Schema for version 1.0 renderer capabilities structure. */
export const RendererV10CapabilitiesSchema = z
  .object({
    supportedCatalogIds: z.array(z.string()).describe('Catalog IDs supported by renderer.'),
    inlineCatalogs: z.array(z.any()).optional().describe('Inline catalog definitions.'),
  })
  .strict()
  .describe('Capabilities structure for version 1.0 protocol.');

/** Renderer v1.0 capabilities type. */
export type RendererV10Capabilities = z.infer<typeof RendererV10CapabilitiesSchema>;

/** Schema for overall renderer capabilities metadata envelope. */
export const RendererCapabilitiesSchema = z
  .object({
    'v1.0': RendererV10CapabilitiesSchema,
  })
  .describe('Capabilities payload sent from renderer describing UI rendering capabilities.');

/** Renderer capabilities payload type. */
export type RendererCapabilities = z.infer<typeof RendererCapabilitiesSchema>;
