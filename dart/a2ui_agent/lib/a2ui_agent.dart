// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/// The A2UI agent SDK: catalogs, capability negotiation, prompting, response
/// parsing and payload validation for agents that generate A2UI.
///
/// Implements protocol v0.9 only; any other version, or none, is rejected.
library;

// Catalog transformers.
export 'src/catalog_transformers/base.dart';
export 'src/catalog_transformers/pruning.dart';
// Inference format contracts.
export 'src/inference_format.dart';
// DIRECT_JSON format.
export 'src/inference_formats/direct_json/constants.dart';
export 'src/inference_formats/direct_json/format.dart';
export 'src/inference_formats/direct_json/parser.dart';
export 'src/inference_formats/direct_json/prompt_generator.dart';
export 'src/inference_formats/direct_json/streaming.dart';
// EXPRESS format.
export 'src/inference_formats/express/compiler.dart';
export 'src/inference_formats/express/constants.dart';
export 'src/inference_formats/express/decompiler.dart';
export 'src/inference_formats/express/format.dart';
export 'src/inference_formats/express/parser.dart';
export 'src/inference_formats/express/prompt_generator.dart';
// Parser contracts.
export 'src/parser/parser.dart';
export 'src/parser/response_part.dart';
// High-level application facade.
export 'src/processor/catalog_config.dart';
export 'src/processor/catalog_providers.dart';
export 'src/processor/generator.dart';
export 'src/processor/processor.dart';
// Prompt generation contracts.
export 'src/prompt/generator.dart';
// Capability negotiation helpers.
export 'src/utils/catalog_resolver.dart';
