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

/**
 * Single dependency seam for @a2ui/web_core.
 *
 * Every @a2ui/web_core import in the SDK must funnel through this module.
 * This ensures that when the framework-agnostic pieces of web_core are moved to a
 * separate package (e.g., @a2ui/a2ui_core), the migration requires touching only this file.
 */

// Core umbrella exports
export {
  Catalog,
  MessageProcessor,
  validateRecursionAndPaths,
  STRICT_VALIDATION,
  getComponentReferences,
  buildComponentRefMap,
  V10_CHILD_REF_OPTIONS,
  V10_STANDARD_DEFS,
  CreateSurfaceMessageSchema as V10CreateSurfaceMessageSchema,
  UpdateComponentsMessageSchema as V10UpdateComponentsMessageSchema,
  UpdateDataModelMessageSchema as V10UpdateDataModelMessageSchema,
  DeleteSurfaceMessageSchema as V10DeleteSurfaceMessageSchema,
  CallRendererFunctionMessageSchema as V10CallRendererFunctionMessageSchema,
  AgentFunctionResponseMessageSchema as V10AgentFunctionResponseMessageSchema,
  AgentToRendererMessageSchema,
  RendererToAgentMessageSchema,
  V10RendererCapabilitiesSchema,
  A2uiCatalogError,
  A2uiError,
  A2uiValidationError,
  A2uiDataError,
  A2uiExpressionError,
  A2uiStateError,
  A2uiIntegrityError,
  A2uiRecursionError,
  normalizeVersionString,
} from '@a2ui/web_core';

export type {
  CatalogApi,
  CatalogInterface,
  ComponentApi,
  FunctionApi,
  FunctionImplementation,
  ValidationConfig,
  ComponentRefMap,
  MessageProcessorOptions,
  ProtocolVersion,
  V10RendererCapabilities,
  RendererCapabilities,
  RendererToAgentMessage,
  V10AgentToRendererMessage as AgentToRendererMessage,
} from '@a2ui/web_core';

// ./v0_9
export {
  CreateSurfaceMessageSchema as V09CreateSurfaceMessageSchema,
  UpdateComponentsMessageSchema as V09UpdateComponentsMessageSchema,
  UpdateDataModelMessageSchema as V09UpdateDataModelMessageSchema,
  DeleteSurfaceMessageSchema as V09DeleteSurfaceMessageSchema,
  V09_STANDARD_DEFS,
} from '@a2ui/web_core/v0_9';
