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
import '../utils/renderer_state.dart';
import '../utils/validation.dart';

/// The per-request facade: the catalogs negotiated with one renderer, the
/// prompt snippet describing them, and parsing of the LLM's response.
///
/// Usually obtained from `A2uiGenerator.createProcessor`.
///
/// Every message is written against the protocol version the active catalogs
/// target.
class A2uiRequestProcessor {
  /// The catalogs negotiated for this request, in the renderer's preference
  /// order.
  final List<CatalogApi> activeCatalogs;

  /// Example turns the prompt shows the model, in order. Each is the list of
  /// messages making up one turn.
  final List<List<AgentToRendererMessage>> examples;

  /// The format the LLM writes payloads in.
  final InferenceFormatFactory formatFactory;

  final InferenceFormat _format;

  /// Checks each of [examples] on its own with [validatePayload], and then
  /// renders [promptSnippet], which writes each example in the format.
  ///
  /// An example may update a surface it does not create, which is assumed
  /// to exist.
  ///
  /// Throws the [A2uiValidationError] a renderer would report for the first
  /// message it rejects, such as one for a component the catalogs do not
  /// declare, and the [A2uiValidationError] the format reports for an
  /// example it cannot write.
  A2uiRequestProcessor({
    required this.activeCatalogs,
    this.examples = const [],
    this.formatFactory = const DirectJsonFormatFactory(),
  }) : _format = formatFactory.createFormat(
         activeCatalogs,
         examples: examples,
       ) {
    for (final List<AgentToRendererMessage> example in examples) {
      validatePayload(activeCatalogs, example);
    }
    // Writing the examples in the format can fail too, so it happens here.
    if (examples.isNotEmpty) {
      _promptSnippet = _format.promptGenerator.generate();
    }
  }

  String? _promptSnippet;

  /// The system prompt snippet teaching the LLM the format, the components
  /// and functions of [activeCatalogs], and [examples].
  ///
  /// The agent adds its own role and workflow instructions around it.
  String get promptSnippet =>
      _promptSnippet ??= _format.promptGenerator.generate();

  /// Parses a complete LLM response into text and A2UI messages of the
  /// active catalogs' protocol version, in the order the LLM emitted them.
  ///
  /// Each payload block becomes one [A2uiPart]. The response is checked as
  /// a whole against a new [RendererState] holding [activeCatalogs], as a
  /// chat turn that shows new UI: a block may refer to components an earlier
  /// block added, and the trees of the surfaces the response touches are
  /// checked once every block is applied.
  ///
  /// Throws [A2uiParseError] if a block cannot be read, and
  /// [A2uiValidationError] if a renderer would reject the messages, such as
  /// one for a component the catalogs do not declare, or an
  /// [A2uiIntegrityError] for an update to a surface the response does not
  /// create or a component nothing reaches from `root`.
  List<ResponsePart> parseResponse(String content) {
    final List<ResponsePart> parts = _format.createParser().parseResponse(
      content,
    );
    final List<A2uiPart> blocks = parts.whereType<A2uiPart>().toList();
    if (blocks.every((A2uiPart block) => block.a2ui.isEmpty)) return parts;
    final state = RendererState(activeCatalogs);
    try {
      state.transaction(() {
        final touched = <String>{
          for (final A2uiPart block in blocks) ...state.apply(block.a2ui),
        };
        state.checkTopology(touched);
      });
    } finally {
      state.dispose();
    }
    return parts;
  }
}
