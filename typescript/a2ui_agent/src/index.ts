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
export {type SchemaCatalog, type ProtocolVersion, basicCatalog} from './types.js';

// The v1.0 agent-to-renderer protocol message. Re-exported because it appears in public
// signatures -- notably the `examples` parameter of `A2uiGenerator` -- so callers must be
// able to name it.
export type {AgentToRendererMessage} from './internal/web_core.js';

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
  A2uiCatalogError,
} from './errors.js';

// Phase 1A: Parser, prompt, and format contracts
export {
  type TextPart,
  type RawA2uiPart,
  type RawResponsePart,
  type A2uiPart,
  type ResponsePart,
} from './parser/response_part.js';

export {Parser} from './parser/parser.js';

export {type PromptOptions, PromptGenerator} from './prompt/generator.js';

export {type InferenceFormat, type InferenceFormatFactory} from './inference_format/base.js';

// Phase 1B: Catalog layer
export {type CatalogTransformer} from './catalog_transformers/base.js';

export {
  ComponentPruningTransformer,
  FunctionPruningTransformer,
} from './catalog_transformers/pruning.js';

export {
  type CatalogProvider,
  FileSystemCatalogProvider,
  InMemoryCatalogProvider,
} from './processor/catalog_providers.js';

export {CatalogConfig} from './processor/catalog_config.js';

export {resolveCatalogs} from './utils/catalog_resolver.js';

// Direct JSON inference format
export {DirectJsonFormat, DirectJsonFormatFactory} from './inference_formats/direct_json/format.js';
export {DirectJsonParser} from './inference_formats/direct_json/parser.js';
export type {
  DirectJsonStreamProcessorFactory,
  DirectJsonStreamProcessorOptions,
  DirectJsonStreamProcessor,
} from './inference_formats/direct_json/streaming_types.js';
export {DirectJsonStreamProcessorImpl} from './inference_formats/direct_json/streaming.js';
export {DirectJsonPromptGenerator} from './inference_formats/direct_json/prompt_generator.js';
export {DirectJsonDecompiler} from './inference_formats/direct_json/decompiler.js';

// Facades
export {A2uiGenerator} from './processor/generator.js';
export {A2uiRequestProcessor} from './processor/processor.js';
