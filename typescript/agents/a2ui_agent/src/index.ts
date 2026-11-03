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

// Phase 0: Foundations
export {type ProtocolVersion} from './types.js';

// The v1.0 agent-to-renderer and renderer-to-agent protocol messages. Re-exported because
// they appear in public signatures -- notably `A2uiGenerator`, `AgentFunctionRegistry`,
// `RendererFunctionCalls`, and `RendererMessageRouter`.
export type {
  ActionMessage,
  AgentFunctionResponseMessage,
  AgentToRendererMessage,
  CallAgentFunctionMessage,
  CallRendererFunctionMessage,
  ErrorMessage,
  RendererFunctionResponseMessage,
  RendererToAgentMessage,
} from './internal/web-core.js';

// The renderer capabilities a request is negotiated against. Re-exported because
// `A2uiGenerator.createProcessor` and `resolveCatalogs` take it.
export type {RendererCapabilities} from './internal/web-core.js';

export {
  AgentFunction,
  type AgentFunctionContext,
  type AgentFunctionHandler,
  type AgentFunctionInit,
  type AgentFunctionOptions,
  Catalog,
  type CatalogApi,
  type CatalogInterface,
  type CopyWithCatalogOptions,
  createAgentFunction,
  isAgentFunction,
} from './internal/web-core.js';

export {
  A2uiError,
  A2uiValidationError,
  A2uiDataError,
  A2uiExpressionError,
  A2uiStateError,
  A2uiIntegrityError,
  A2uiRecursionError,
  A2uiRpcError,
  RpcErrorCode,
  ParseError,
  A2uiCompilationError,
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  A2uiCatalogError,
} from './errors.js';

// Phase 1A: Parser, prompt, and format contracts
export {
  type TextPart,
  type RawA2uiPart,
  type RawResponsePart,
  type A2uiPart,
  type ResponsePart,
  type ErrorPart,
  type StreamPart,
} from './parser/response-part.js';

export {
  type ContinuingStreamOptions,
  type ParseOptions,
  type StreamOptions,
  Parser,
} from './parser/parser.js';
export {type ResponseStream} from './parser/response-stream.js';

export {PromptGenerator} from './prompt/generator.js';

export {type InferenceFormat, type InferenceFormatFactory} from './inference-format.js';

// Phase 1B: Catalog layer
export {type CatalogTransformer} from './catalog-transformers/base.js';

export {
  ComponentPruningTransformer,
  FunctionPruningTransformer,
} from './catalog-transformers/pruning.js';

export {
  type CatalogProvider,
  FileSystemCatalogProvider,
  InMemoryCatalogProvider,
} from './processor/catalog-providers.js';

export {CatalogConfig} from './processor/catalog-config.js';

export {
  A2UI_CLIENT_CAPABILITIES_KEY,
  A2UI_RENDERER_CAPABILITIES_KEY,
  readRendererCapabilities,
} from './utils/renderer-capabilities.js';
export {resolveCatalogs} from './utils/catalog-resolver.js';

// Inbound renderer-to-agent messages
export {
  type InboundMessage,
  type InboundMessageKind,
  formatInboundForModel,
  getInboundMessageKind,
  parseInboundMessage,
} from './inbound/inbound-message.js';

// Renderer state and payload validation
export {
  type InboundResult,
  RendererState,
  type RendererStateOptions,
} from './utils/renderer-state.js';
export {validatePayload} from './utils/validation.js';

// The surface model of web_core. Re-exported because `RendererState.getSurface` returns it.
export type {SurfaceModel} from './internal/web-core.js';

// Direct JSON inference format
export {
  type DirectJsonFormatOptions,
  DirectJsonFormat,
  DirectJsonFormatFactory,
} from './inference-formats/direct-json/format.js';
export {
  type DirectJsonParserOptions,
  DirectJsonParser,
} from './inference-formats/direct-json/parser.js';
export {DirectJsonResponseStream} from './inference-formats/direct-json/response-stream.js';
export {DirectJsonPromptGenerator} from './inference-formats/direct-json/prompt-generator.js';
export type {DirectJsonExamples} from './inference-formats/direct-json/prompt-generator.js';
export {DirectJsonDecompiler} from './inference-formats/direct-json/decompiler.js';

// Express inference format
export {
  type ExpressFormatOptions,
  type ExpressFormatFactoryOptions,
  ExpressFormat,
  ExpressFormatFactory,
} from './inference-formats/express/format.js';
export {type ExpressParserOptions, ExpressParser} from './inference-formats/express/parser.js';
export {
  DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
  type ExpressStreamOptions,
  type ExpressStreamSource,
  ExpressResponseStream,
} from './inference-formats/express/response-stream.js';
export {ExpressPromptGenerator} from './inference-formats/express/prompt-generator.js';
export {ExpressDecompiler} from './inference-formats/express/decompiler.js';
export {
  ExpressCompilerError,
  ExpressParseError,
  ExpressSyntaxError,
  ExpressUndefinedRootError,
  ExpressUndefinedChildError,
  ExpressValidationError,
  ExpressUnknownComponentError,
  ExpressUnknownPropertyError,
  ExpressMissingRequiredPropertyError,
  ExpressDuplicatePropertyError,
  ExpressUnknownFunctionError,
  ExpressInvalidParamError,
  ExpressDuplicateParamError,
  ExpressForbiddenDatabindingError,
  ExpressIdCollisionError,
  ExpressUnknownCatalogError,
} from './inference-formats/express/errors.js';

// Facades
export {A2uiGenerator} from './processor/generator.js';
export {type A2uiRequestProcessorOptions, A2uiRequestProcessor} from './processor/processor.js';
export {
  type AnswerPart,
  type AnswerSurfacePart,
  type AnswerTextPart,
  type StreamedAnswerOptions,
  StreamedAnswer,
} from './processor/streamed-answer.js';

// Skill generator
export {
  type GenerateCatalogSkillOptions,
  type GenerateCoreSkillOptions,
  type GenerateSkillOptions,
  type GenerateSkillSetOptions,
  type SkillOptions,
  Skill,
  SkillGenerator,
  SkillSet,
} from './skill/index.js';

// Agent function & renderer RPC helpers
export {
  AgentFunctionRegistry,
  type AgentFunctionRegistryOptions,
  type HandleAgentFunctionOptions,
} from './rpc/agent-function-registry.js';
export {
  type CallRendererFunctionOptions,
  type CancellablePromise,
  DEFAULT_RENDERER_CALL_TIMEOUT,
  DEFAULT_RENDERER_CALL_TIMEOUT_MS,
  type PendingRendererCall,
  RendererFunctionCalls,
  type RendererFunctionCallsOptions,
} from './rpc/renderer-function-calls.js';
export {RendererMessageRouter, type RendererMessageRouterOptions} from './rpc/router.js';
