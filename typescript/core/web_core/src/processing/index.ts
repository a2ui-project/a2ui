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

export {
  type ProcessableMessage,
  type ProcessableMessagePayload,
  type RendererCapabilities,
  type ClientCapabilities,
  type ValidationConfig,
  type OutboundMessageListener,
  type CallOptions,
  STRICT_VALIDATION,
  RELAXED_VALIDATION,
  A2uiRpcError,
  RpcErrorCode,
  type ExecutionContext,
  type CapabilitiesOptions,
  type MessageProcessorOptions,
  formatZodIssue,
  MessageProcessor,
} from './message-processor.js';
export {
  mapErrorToRendererMessage,
  extractEnvelopeErrorContext,
  normalizeJsonPointer,
  type RendererErrorMessage,
  type A2uiRendererError,
  type ValidationFailedErrorBody,
  type GenericErrorBody,
  type ErrorEnvelopeContext,
} from './message-error-mapper.js';
export {VersionAdapterFactory, defaultVersionAdapterFactory} from './adapters/factory.js';
export {
  isCatalogVersionCompatible,
  registerKnownActionsProvider,
  type ProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS,
  DEFAULT_CATALOG_COMPATIBILITY,
  type VersionAdapterResolver,
  type VersionAdapter,
  type KnownActionsProvider,
  BaseVersionAdapter,
} from './adapters/base.js';
export {
  type A2uiErrorDetail,
  type A2uiErrorContext,
  A2uiError,
  A2uiValidationError,
  A2uiDataError,
  A2uiExpressionError,
  A2uiStateError,
  A2uiCatalogError,
  A2uiIntegrityError,
  A2uiRecursionError,
} from '../errors.js';
