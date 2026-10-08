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

// The v1.0 agent-to-renderer protocol message. Re-exported because it appears in public
// signatures -- notably the `examples` parameter of `A2uiGenerator` -- so callers must be
// able to name it.
export type {AgentToRendererMessage} from './internal/web-core.js';

// The renderer capabilities a request is negotiated against. Re-exported because
// `A2uiGenerator.createProcessor` and `resolveCatalogs` take it.
export type {RendererCapabilities} from './internal/web-core.js';

export {
  A2uiError,
  A2uiValidationError,
  A2uiDataError,
  A2uiExpressionError,
  A2uiStateError,
  A2uiIntegrityError,
  A2uiRecursionError,
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
} from './parser/response-part.js';

export {Parser} from './parser/parser.js';

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

export {resolveCatalogs} from './utils/catalog-resolver.js';

// Direct JSON inference format
export {DirectJsonFormat, DirectJsonFormatFactory} from './inference-formats/direct-json/format.js';
export {DirectJsonParser} from './inference-formats/direct-json/parser.js';
export type {
  DirectJsonStreamProcessorFactory,
  DirectJsonStreamProcessorOptions,
  DirectJsonStreamProcessor,
} from './inference-formats/direct-json/streaming-types.js';
export {DirectJsonStreamProcessorImpl} from './inference-formats/direct-json/streaming.js';
export {DirectJsonPromptGenerator} from './inference-formats/direct-json/prompt-generator.js';
export {DirectJsonDecompiler} from './inference-formats/direct-json/decompiler.js';

// Express inference format
export {
  type ExpressFormatOptions,
  ExpressFormat,
  ExpressFormatFactory,
} from './inference-formats/express/format.js';
export {ExpressParser} from './inference-formats/express/parser.js';
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
  ExpressInvalidIdentifierError,
  ExpressUnknownCatalogError,
} from './inference-formats/express/errors.js';

// Facades
export {A2uiGenerator} from './processor/generator.js';
export {A2uiRequestProcessor} from './processor/processor.js';
