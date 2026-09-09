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

import 'package:a2ui_core/a2ui_core.dart';

import '../inference_format.dart';
import '../parser/parser.dart';
import '../parser/response_part.dart';
import '../validation/catalog_validators.dart';

/// The per-request facade: negotiated catalogs, prompt snippet, parsers and
/// validation for one renderer.
///
/// Usually obtained from `A2uiGenerator.createProcessor`.
class A2uiRequestProcessor {
  /// The negotiated catalogs active for this request.
  final List<SchemaCatalog> activeCatalogs;

  /// Few-shot example turns to include in the system prompt.
  final Map<String, List<A2uiMessage>>? examples;

  /// The inference format strategy used for prompting and parsing.
  final InferenceFormat format;

  /// The validators applied to parsed payloads, one per active catalog.
  final CatalogValidators validators;

  /// [formatFactory] has no default: the format decides the token cost of
  /// every turn, so the caller chooses it explicitly rather than inheriting
  /// one that would be breaking to change later.
  A2uiRequestProcessor({
    required this.activeCatalogs,
    required InferenceFormatFactory formatFactory,
    this.examples,
    CatalogValidators? validators,
  }) : format = formatFactory.createFormat(activeCatalogs, examples: examples),
       validators = validators ?? CatalogValidators(catalogs: activeCatalogs);

  /// The format-specific prompt snippet; the agent prepends its own
  /// preamble.
  String get promptSnippet => format.promptGenerator.generate();

  /// Creates a parser scoped to a single LLM turn.
  Parser createParser() => format.createParser();

  /// Parses and validates a complete LLM response.
  ///
  /// Throws [A2uiParseError] if it holds no well-formed payload block,
  /// [A2uiCompileError] if a block cannot be compiled, and
  /// [A2uiValidationError] if the payload is invalid for [activeCatalogs] or
  /// declares an unsupported version.
  List<ResponsePart> parseResponse(String content) {
    throw UnimplementedError('A2uiRequestProcessor.parseResponse');
  }

  /// Validates few-shot [examples] against [activeCatalogs].
  ///
  /// Throws [A2uiValidationError] if an example uses anything they do not
  /// support.
  Future<void> validateExamples() {
    throw UnimplementedError('A2uiRequestProcessor.validateExamples');
  }
}
