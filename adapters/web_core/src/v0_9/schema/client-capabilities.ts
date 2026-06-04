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
 * Represents a JSON Schema definition.
 * Typed as Record<string, any> to allow standard JSON schema properties
 * without importing heavy schema types.
 */
export type JsonSchema = Record<string, any>;

/**
 * Describes a function's interface within an inline catalog.
 */
export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters: JsonSchema;
  returnType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any' | 'void';
}

/**
 * Defines a catalog inline for the a2uiClientCapabilities object.
 */
export interface InlineCatalog {
  catalogId: string;
  components?: Record<string, JsonSchema>;
  functions?: FunctionDefinition[];
  theme?: Record<string, JsonSchema>;
}

/**
 * The capabilities structure sent from the client to the server as part of transport metadata.
 */
export interface A2uiClientCapabilities {
  'v0.9': {
    supportedCatalogIds: string[];
    inlineCatalogs?: InlineCatalog[];
  };
}
