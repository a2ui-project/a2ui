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
export type JsonSchema = Record<string, any>;

export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters: JsonSchema;
  returnType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';
}

export interface InlineCatalog {
  catalogId: string;
  components?: Record<string, JsonSchema>;
  functions?: FunctionDefinition[];
  theme?: Record<string, JsonSchema>;
}

export interface A2uiVersionCapabilities {
  supportedCatalogIds: string[];
  inlineCatalogs?: InlineCatalog[];
}

export type A2uiClientCapabilities =
  | {
      'v0.9': A2uiVersionCapabilities;
      'v0.9.1'?: A2uiVersionCapabilities;
    }
  | {
      'v0.9'?: A2uiVersionCapabilities;
      'v0.9.1': A2uiVersionCapabilities;
    };
