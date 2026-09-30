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
import '../parser/response_part.dart';
import 'validation.dart';

/// The per-request facade: the catalogs negotiated with one renderer, the
/// prompt snippet describing them, and parsing of the LLM's response.
///
/// Usually obtained from `A2uiGenerator.createProcessor`.
class A2uiRequestProcessor {
  /// The catalogs negotiated for this request, in the renderer's preference
  /// order.
  final List<SchemaCatalog> activeCatalogs;

  /// Example turns the prompt shows the model, in order. Each is the list of
  /// messages making up one turn.
  final List<List<AgentToRendererMessage>> examples;

  /// The format the LLM writes payloads in.
  final InferenceFormatFactory formatFactory;

  final InferenceFormat _format;

  /// Checks each of [examples] on its own, as a renderer holding
  /// [activeCatalogs] would check it on surfaces that start empty.
  ///
  /// Throws the [A2uiError] that renderer would report for the first message
  /// it rejects, such as an [A2uiValidationError] for a component the
  /// catalogs do not declare.
  A2uiRequestProcessor({
    required this.activeCatalogs,
    this.examples = const [],
    this.formatFactory = const DirectJsonFormatFactory(),
  }) : _format = formatFactory.createFormat(
         activeCatalogs,
         examples: examples,
       ) {
    for (final List<AgentToRendererMessage> example in examples) {
      validatePayloads(activeCatalogs, [example]);
    }
  }

  /// The system prompt snippet teaching the LLM the format, the components
  /// and functions of [activeCatalogs], and [examples].
  ///
  /// The agent adds its own role and workflow instructions around it.
  String get promptSnippet => _format.promptGenerator.generate();

  /// Parses a complete LLM response into text and v0.9 A2UI messages, in the
  /// order the LLM emitted them.
  ///
  /// Each payload block becomes one [A2uiPart], checked as a renderer holding
  /// [activeCatalogs] would check it.
  ///
  /// Throws [A2uiParseError] if a block cannot be read or [content] carries a
  /// payload in another format, [A2uiValidationError] if a block uses
  /// anything the catalogs do not declare, and another [A2uiError] if a
  /// renderer would reject the messages, such as an [A2uiIntegrityError] for
  /// a component nothing reaches from `root`.
  List<ResponsePart> parseResponse(String content) {
    final List<ResponsePart> parts = _format.createParser().parseResponse(
      content,
    );
    validatePayloads(activeCatalogs, [
      for (final A2uiPart part in parts.whereType<A2uiPart>()) part.a2ui,
    ]);
    return parts;
  }
}
