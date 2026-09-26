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

// ./catalog
export {Catalog} from '@a2ui/web_core/catalog';
export type {
  CatalogInterface,
  ComponentApi,
  FunctionApi,
  FunctionImplementation,
} from '@a2ui/web_core/catalog';

// ./v0_9
export {
  CreateSurfaceMessageSchema as V09CreateSurfaceMessageSchema,
  UpdateComponentsMessageSchema as V09UpdateComponentsMessageSchema,
  UpdateDataModelMessageSchema as V09UpdateDataModelMessageSchema,
  DeleteSurfaceMessageSchema as V09DeleteSurfaceMessageSchema,
} from '@a2ui/web_core/v0_9';

// ./v1_0
export {
  CreateSurfaceMessageSchema as V10CreateSurfaceMessageSchema,
  UpdateComponentsMessageSchema as V10UpdateComponentsMessageSchema,
  UpdateDataModelMessageSchema as V10UpdateDataModelMessageSchema,
  DeleteSurfaceMessageSchema as V10DeleteSurfaceMessageSchema,
  CallRendererFunctionMessageSchema as V10CallRendererFunctionMessageSchema,
  AgentFunctionResponseMessageSchema as V10AgentFunctionResponseMessageSchema,
  AgentToRendererMessageSchema,
  RendererToAgentMessageSchema,
  V10RendererCapabilitiesSchema,
} from '@a2ui/web_core/v1_0';
import type {
  AgentToRendererMessage,
  RendererToAgentMessage,
  V10RendererCapabilities,
} from '@a2ui/web_core/v1_0';
export type {AgentToRendererMessage, RendererToAgentMessage, V10RendererCapabilities};

/**
 * Version-neutral alias for renderer capabilities across protocol versions.
 */
export type RendererCapabilities = V10RendererCapabilities;

// ./v1_0/basic_catalog
export {BASIC_COMPONENTS, BASIC_FUNCTION_APIS} from '@a2ui/web_core/v1_0/basic_catalog';

// ./validating
export {
  validateRecursionAndPaths,
  STRICT_VALIDATION,
  getComponentReferences,
  buildComponentRefMap,
  V10_CHILD_REF_OPTIONS,
} from '@a2ui/web_core/validating';
// Sourced from ./validating rather than ./catalog: catalog/index.ts re-exports only what
// types.ts declares, and types.ts imports this type without re-exporting it, so it is not
// reachable through the ./catalog subpath.
export type {ComponentRefMap} from '@a2ui/web_core/validating';

// ./processing
export {MessageProcessor} from '@a2ui/web_core/processing';
export type {MessageProcessorOptions} from '@a2ui/web_core/processing';

// ./errors
export {
  A2uiError,
  A2uiValidationError,
  A2uiDataError,
  A2uiExpressionError,
  A2uiStateError,
  A2uiIntegrityError,
  A2uiRecursionError,
} from '@a2ui/web_core/errors';

// ./adapters
export type {ProtocolVersion} from '@a2ui/web_core/adapters';

// ./semver
export {normalizeVersionString} from '@a2ui/web_core/semver';
