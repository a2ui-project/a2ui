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
export {
  AgentFunction,
  bindCatalogValidator,
  Catalog,
  isAgentFunction,
} from '@a2ui/web_core/catalog';
export type {
  AgentFunctionContext,
  AgentFunctionHandler,
  AgentFunctionInit,
  CatalogApi,
  CatalogInterface,
  ComponentApi,
  CopyWithCatalogOptions,
  FunctionApi,
  FunctionImplementation,
} from '@a2ui/web_core/catalog';

// ./v0_8
export {Schemas as V08Schemas} from '@a2ui/web_core/v0_8';

// ./v0_9
export {Schemas as V09Schemas, V09_STANDARD_DEFS} from '@a2ui/web_core/v0_9';

// ./v1_0
export {Schemas as V10Schemas, V10_STANDARD_DEFS} from '@a2ui/web_core/v1_0';
import type {
  ActionMessage,
  AgentFunctionResponseMessage,
  AgentToRendererMessage,
  CallAgentFunctionMessage,
  CallRendererFunctionMessage,
  ErrorMessage,
  RendererFunctionResponseMessage,
  RendererToAgentMessage,
  V10RendererCapabilities,
} from '@a2ui/web_core/v1_0';
export type {
  ActionMessage,
  AgentFunctionResponseMessage,
  AgentToRendererMessage,
  CallAgentFunctionMessage,
  CallRendererFunctionMessage,
  ErrorMessage,
  RendererFunctionResponseMessage,
  RendererToAgentMessage,
  V10RendererCapabilities,
};

/**
 * Version-neutral alias for renderer capabilities across protocol versions.
 */
export type RendererCapabilities = V10RendererCapabilities;

// ./validating
export {
  validateRecursionAndPaths,
  STRICT_VALIDATION,
  getComponentReferences,
  buildComponentRefMap,
  isValidUax31Identifier,
  V10_CHILD_REF_OPTIONS,
} from '@a2ui/web_core/validating';
export type {ValidationConfig} from '@a2ui/web_core/validating';
// Sourced from ./validating rather than ./catalog: catalog/index.ts re-exports only what
// types.ts declares, and types.ts imports this type without re-exporting it, so it is not
// reachable through the ./catalog subpath.
export type {ComponentRefMap} from '@a2ui/web_core/validating';

// ./resolution
export {validateReservedDirectives} from '@a2ui/web_core/resolution';

// ./state
export {ComponentModel, DataModel, SurfaceModel} from '@a2ui/web_core/state';

// ./processing
export {MessageProcessor} from '@a2ui/web_core/processing';
export type {MessageProcessorOptions} from '@a2ui/web_core/processing';

// ./validation
export {PayloadValidator} from '@a2ui/web_core/validation';

// ./errors
export {
  A2uiCatalogError,
  A2uiConfigurationError,
  A2uiError,
  A2uiValidationError,
  A2uiDataError,
  A2uiExpressionError,
  A2uiStateError,
  A2uiIntegrityError,
  A2uiRecursionError,
  A2uiRpcError,
  RpcErrorCode,
  noValidatorError,
} from '@a2ui/web_core/errors';
export type {A2uiErrorDetail} from '@a2ui/web_core/errors';

// ./adapters
export {
  V0_9_MESSAGE_SPEC,
  V1_0_MESSAGE_SPEC,
  compileMessageSpec,
  validateProtocolMessage,
} from '@a2ui/web_core/adapters';
export type {ProtocolMessageSpec, ProtocolVersion} from '@a2ui/web_core/adapters';

// ./schema-engine
export {commonTypesDocument, messageForIssue, pickIssue} from '@a2ui/web_core/schema-engine';
export type {A2uiIssue, JsonSchema, JsonSchemaValidator} from '@a2ui/web_core/schema-engine';

// ./semver
export {
  compareSemVer,
  isAtLeastVersion,
  normalizeVersionString,
  toCanonicalVersion,
} from '@a2ui/web_core/semver';
