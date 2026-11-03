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
import '../inference_formats/express/format.dart';
import '../parser/parser.dart';
import '../parser/response_part.dart';
import '../parser/response_stream.dart';
import '../utils/renderer_state.dart';
import '../utils/validation.dart';

/// The per-request facade: the catalogs negotiated with one renderer, the
/// prompt snippet describing them, and parsing of the LLM's response.
///
/// Usually obtained from `A2uiGenerator.createProcessor`.
///
/// Each response is checked against a [RendererState]. A chat agent, whose
/// turns each show new UI, passes none, and each call checks the response
/// against a new, empty state. A canvas agent, whose turns update the
/// surfaces earlier turns built, keeps one state for the conversation:
/// [createState] creates it, and a processor given a [state] uses it for
/// every call that passes none.
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

  /// The renderer state bound to this processor, if any.
  final RendererState? state;

  final InferenceFormat _format;

  /// Checks each of [examples] on its own with [validatePayload], and then
  /// renders [promptSnippet], which writes each example in the format.
  ///
  /// An example may update a surface it does not create, which is assumed
  /// to exist.
  ///
  /// [state] is the renderer state a canvas agent keeps for the
  /// conversation, which [parseResponse] and [openStream] use when a call
  /// passes none. A processor bound to a state serves only that
  /// conversation.
  ///
  /// Throws the [A2uiValidationError] a renderer would report for the first
  /// message it rejects, such as one for a component the catalogs do not
  /// declare, the [A2uiValidationError] the format reports for an example it
  /// cannot write, and [A2uiCatalogError] if [state] holds other catalogs
  /// than [activeCatalogs].
  A2uiRequestProcessor({
    required this.activeCatalogs,
    this.examples = const [],
    this.formatFactory = const ExpressFormatFactory(),
    this.state,
  }) : _format = formatFactory.createFormat(
         activeCatalogs,
         examples: examples,
       ) {
    _checkState(state);
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

  /// The parser for the format, bound to [activeCatalogs].
  ///
  /// A parser holds no state, so the processor creates one and reuses it.
  late final Parser parser = _format.createParser();

  /// Creates an empty renderer state that holds [activeCatalogs].
  ///
  /// A canvas agent keeps the state for the whole conversation and passes it
  /// to [parseResponse] or [openStream] on every turn, or binds it to the
  /// processor.
  RendererState createState() => RendererState(activeCatalogs);

  /// Parses a complete LLM response into text and A2UI messages of the
  /// active catalogs' protocol version, in the order the LLM emitted them.
  ///
  /// Each payload block becomes one [A2uiPart]. The response is checked as a
  /// whole against [state], or the state bound to the processor, and applied
  /// to it all or nothing; with neither, it is checked against a new, empty
  /// state, so an update to a surface the response does not create is
  /// rejected. See [Parser.parseResponse]. When [wrapped] is false,
  /// [content] is a single payload without sentinel tags.
  ///
  /// Throws [A2uiParseError] if a block cannot be read,
  /// [A2uiValidationError] if a renderer would reject the messages, such as
  /// one for a component the catalogs do not declare, or an
  /// [A2uiIntegrityError] for a component nothing reaches from `root`, and
  /// [A2uiCatalogError] if [state] holds other catalogs than the processor.
  List<ResponsePart> parseResponse(
    String content, {
    bool wrapped = true,
    RendererState? state,
  }) => parser.parseResponse(
    content,
    wrapped: wrapped,
    state: _resolveState(state),
  );

  /// Opens a stream that reads one LLM response chunk by chunk.
  ///
  /// Messages are checked against [state], or the state bound to the
  /// processor, and applied to it as the stream emits them; with neither,
  /// against a new, empty state. See [Parser.openStream].
  ///
  /// Throws [A2uiCatalogError] if [state] holds other catalogs than the
  /// processor, and [UnsupportedError] if the format cannot be read chunk by
  /// chunk.
  ResponseStream openStream({bool wrapped = true, RendererState? state}) =>
      parser.openStream(wrapped: wrapped, state: _resolveState(state));

  /// Opens a stream that reads one LLM response chunk by chunk, and reads
  /// past a rejected block, returning an [ErrorPart] in its place. [wrapped]
  /// and [state] are as for [openStream]. See [Parser.openContinuingStream].
  ContinuingResponseStream openContinuingStream({
    bool wrapped = true,
    RendererState? state,
  }) => parser.openContinuingStream(
    wrapped: wrapped,
    state: _resolveState(state),
  );

  RendererState? _resolveState(RendererState? state) {
    if (state == null) return this.state;
    _checkState(state);
    return state;
  }

  /// Whether the processor can check responses against [state].
  ///
  /// A state is accepted when it holds [activeCatalogs], in the same order,
  /// since the order decides which catalog a surface resolves to. A state
  /// made with [createState] is always accepted. An agent that keeps a state
  /// per conversation calls this to tell whether the state still fits the
  /// request's catalogs, and makes a new one with [createState] when it
  /// doesn't.
  bool acceptsState(RendererState state) =>
      _catalogKeys(state.catalogs).join('\n') ==
      _catalogKeys(activeCatalogs).join('\n');

  void _checkState(RendererState? state) {
    if (state == null || acceptsState(state)) return;
    throw A2uiCatalogError(
      'The renderer state holds catalogs ${_catalogKeys(state.catalogs)}, '
      'but the processor\'s active catalogs are '
      '${_catalogKeys(activeCatalogs)}.',
    );
  }
}

/// The id and protocol version of each of [catalogs], in order.
List<String> _catalogKeys(List<CatalogApi> catalogs) => [
  for (final CatalogApi catalog in catalogs)
    '${catalog.id} (${catalog.protocolVersion?.jsonValue})',
];
