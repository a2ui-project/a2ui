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
/**
 * Catalog interfaces and component/function registration utilities.
 */

export {
  createFunctionImplementation,
  type ComponentChildRefs,
  AgentFunction,
  isAgentFunction,
  type AgentFunctionContext,
  type AgentFunctionHandler,
  type AgentFunctionInit,
  type A2uiReturnTypeMap,
  type A2uiReturnType,
  type InferA2uiReturnType,
  type FunctionApi,
  type JsonSchemaObject,
  type FunctionImplementation,
  type ResolvedDynamic,
  type ResolvedFunctionArgs,
  type ComponentApi,
  type InferredComponentApiSchemaType,
  type CatalogUnions,
  type CatalogDocumentOptions,
  type CatalogOptions,
  type CopyWithCatalogOptions,
  type DeriveCatalogOptions,
  type CatalogInterface,
  Catalog,
  type CatalogApi,
} from './types.js';
export type {FunctionInvoker} from './function_invoker.js';
export {JsonComponentApi, JsonFunctionApi} from './json_entries.js';
export {spec, specDef, type SpecAnnotation, type SpecMixin} from './spec_annotations.js';
