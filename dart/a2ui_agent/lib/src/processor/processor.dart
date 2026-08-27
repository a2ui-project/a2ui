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
import '../inference_formats/direct_json/format.dart';
import '../parser/parser.dart';
import '../parser/response_part.dart';

/// The per-request facade: negotiated catalogs, prompt snippet, parsers and
/// validation for one renderer.
///
/// Usually obtained from `A2uiGenerator.createProcessor`.
class A2uiRequestProcessor<C extends ComponentApi, F extends FunctionApi> {
  /// The negotiated catalogs active for this request.
  final List<Catalog<C, F>> activeCatalogs;

  /// Few-shot example turns to include in the system prompt.
  final Map<String, List<A2uiMessage>>? examples;

  /// The inference format strategy used for prompting and parsing.
  final InferenceFormat<C, F> format;

  /// The validator applied to parsed payloads.
  final A2uiValidator<C, F> validator;

  A2uiRequestProcessor({
    required this.activeCatalogs,
    this.examples,
    InferenceFormatFactory<C, F>? formatFactory,
    A2uiValidator<C, F>? validator,
  }) : format = (formatFactory ?? DirectJsonFormatFactory<C, F>()).createFormat(
         activeCatalogs,
         examples: examples,
       ),
       validator = validator ?? A2uiValidator<C, F>(catalogs: activeCatalogs);

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
