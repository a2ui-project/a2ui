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

import '../utils/renderer_state.dart';
import 'response_part.dart';
import 'response_stream.dart';

/// Reads an LLM response written in one inference format.
///
/// Obtained from `InferenceFormat.createParser`, bound to the catalogs of one
/// request. A format implements [compile] and [decompile], which translate
/// between its notation and A2UI messages, and the tag handling around them.
/// The base class reads model responses: [parseResponse] reads a whole one
/// and [openStream] a streamed one, and both check every message they
/// compile against a [RendererState], the one a call is given or a new one.
/// A chat agent passes none, so every turn shows new UI. A canvas agent
/// passes the same state every turn, so each turn is checked against the
/// surfaces earlier turns built.
///
/// A parser holds no state, so one parser can be reused across turns and
/// responses.
abstract class Parser {
  const Parser();

  /// The active catalogs, in priority order. A call that is given no
  /// [RendererState] checks the response against a new one holding them.
  List<CatalogApi> get catalogs;

  /// Whether [content] carries a payload block in this format.
  ///
  /// Tokenizes blocks through [unwrap] without compiling, so a caller can
  /// decide whether a response is this format's business without paying for a
  /// compile. Counts a block recovered by [unwrap] when its opening sentinel
  /// tag was omitted. When [complete] is false an opening tag is enough, which
  /// tells a streaming caller that a payload has started.
  bool hasFormatContent(String content, {bool complete = false});

  /// Writes [parts] out as one response: text as it is, and each raw payload
  /// inside this format's sentinel tags, in order.
  ///
  /// The inverse of [unwrap].
  String wrap(List<RawResponsePart> parts);

  /// Splits [content] into text and raw payload blocks, in the order the LLM
  /// wrote them.
  ///
  /// In one-shot parsing, also recovers at most one payload block whose opening
  /// sentinel tag was omitted when closed by this format's closing tag
  /// ([openStream] requires the opening sentinel tag).
  List<RawResponsePart> unwrap(String content);

  /// Translates the content of one payload block, without its sentinel tags,
  /// into A2UI messages.
  ///
  /// Compiling translates the notation and reports what the notation itself
  /// gets wrong. It does not check the messages against a renderer state:
  /// [parseResponse] and [openStream] do, and
  /// `parseResponse(block, wrapped: false)` compiles and checks one block.
  ///
  /// Throws [A2uiParseError] if [formatContent] cannot be read, and
  /// [A2uiValidationError] if it cannot be translated into messages.
  List<AgentToRendererMessage> compile(String formatContent);

  /// Writes [a2uiPayload] in this format's notation, without sentinel tags.
  ///
  /// The inverse of [compile].
  String decompile(List<AgentToRendererMessage> a2uiPayload);

  /// Parses a complete LLM response into text and A2UI messages, in the order
  /// the LLM emitted them.
  ///
  /// Nothing has been sent when a whole response is parsed, so it is checked
  /// as a whole: a component may name a child that a later block adds, and
  /// the trees of the surfaces the response touches are checked once every
  /// block is applied, unless a block was cut off by the end of the response.
  /// The messages are applied to [state] all or nothing: if any check fails,
  /// the state is left as it was. Without a [state], the response is checked
  /// against a new, empty one holding [catalogs], so an update to a surface
  /// the response does not create is rejected.
  ///
  /// A block cut off at the end of the response, which formats other than
  /// direct JSON compile as far as it goes, is applied too, but the trees of
  /// the surfaces it touches are not checked, and the components it added
  /// are marked checked ([RendererState.markChecked]), so a later turn is not
  /// required to make them reachable.
  ///
  /// When [wrapped] is false, [content] is a single payload without sentinel
  /// tags.
  ///
  /// Throws what [unwrap] and [compile] throw, [A2uiValidationError] if a
  /// renderer in the state would reject a message, and [A2uiCatalogError] if
  /// a new state cannot be created for [catalogs].
  List<ResponsePart> parseResponse(
    String content, {
    bool wrapped = true,
    RendererState? state,
  }) {
    RendererState? owned;
    RendererState target() => state ?? (owned ??= RendererState(catalogs));
    List<ResponsePart> parse() {
      final parts = <ResponsePart>[];
      final touched = <String>{};
      final incomplete = <String>{};
      final List<RawResponsePart> rawParts = wrapped
          ? unwrap(content)
          : [RawA2uiPart(content)];
      for (final part in rawParts) {
        switch (part) {
          case TextPart():
            parts.add(part);
          case RawA2uiPart(:final String a2uiRaw, :final bool isFinal):
            final List<AgentToRendererMessage> messages = compile(a2uiRaw);
            final List<String> blockTouched = target().apply(messages);
            touched.addAll(blockTouched);
            if (!isFinal) incomplete.addAll(blockTouched);
            parts.add(A2uiPart(messages));
        }
      }
      final Set<String> complete = touched.difference(incomplete);
      if (complete.isNotEmpty) target().checkTopology(complete);
      // A truncated block's messages are kept, as the renderer the caller
      // sends them to will hold them, but its trees are not checked: a
      // cut-off block is missing what it would have added. Its components are
      // marked checked, so a later turn is not required to make them
      // reachable; its dangling references and a missing root are still
      // reported when a later turn checks the surface.
      if (incomplete.isNotEmpty) target().markChecked(incomplete);
      return parts;
    }

    try {
      // A new state is thrown away if the response fails, so only a state
      // the caller keeps needs a transaction.
      return state == null ? parse() : state.transaction(parse);
    } finally {
      owned?.dispose();
    }
  }

  /// Whether [openStream] can read a response from this format chunk by
  /// chunk.
  ///
  /// A format can stream only if a partial block already means something. A
  /// parser that returns false is given the whole response through
  /// [parseResponse].
  bool get supportsStreaming => false;

  /// Opens a stream that reads one response chunk by chunk.
  ///
  /// Each message the stream emits is checked against [state] and applied to
  /// it as it is emitted. Without a [state], the response is checked against
  /// a new, empty one holding [catalogs]. When [wrapped] is false, the stream
  /// is a single payload without sentinel tags.
  ///
  /// Throws [UnsupportedError] unless [supportsStreaming] is true.
  ResponseStream openStream({bool wrapped = true, RendererState? state}) =>
      throw UnsupportedError('$runtimeType does not support streaming.');
}
