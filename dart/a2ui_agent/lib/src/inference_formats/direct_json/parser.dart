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

import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';

import '../../parser/parser.dart';
import '../../parser/response_part.dart';
import '../../parser/response_stream.dart';
import '../../utils/renderer_state.dart';
import 'blocks.dart';
import 'json_reader.dart';
import 'message_reader.dart';

part 'response_stream.dart';

/// Reads A2UI messages written as JSON inside `<a2ui-json>` tags, from a
/// complete response or as it streams.
///
/// A parser holds no state: [openStream] returns a [DirectJsonResponseStream]
/// that holds the state of one streamed response.
///
/// Messages are read as the protocol version the catalogs target.
class DirectJsonParser extends Parser {
  DirectJsonParser(
    List<CatalogApi> catalogs, {
    Set<String> progressiveKeys = const {},
    this.bufferIncompleteComponents = false,
  }) : catalogs = List.unmodifiable(catalogs),
       progressiveKeys = Set.unmodifiable(progressiveKeys);

  /// The catalogs payloads are read and checked against.
  @override
  final List<CatalogApi> catalogs;

  /// The string properties whose value a streamed payload may show before
  /// the value is complete, such as the text of a `Text` component.
  ///
  /// Which properties hold prose depends on the catalog, so there is no
  /// built-in set. Empty turns healing off.
  final Set<String> progressiveKeys;

  /// Whether a streamed component is held back until its JSON object closes,
  /// rather than healed and shown while it arrives, for catalogs before
  /// v1.0.
  ///
  /// From v1.0 a component may name its own `catalogId`, and the key can
  /// arrive after its type and properties, so a component shown early may be
  /// checked and rendered against the wrong catalog. The components of v1.0
  /// catalogs are therefore always held back, whatever this says, and
  /// [progressiveKeys] then only heal values outside components, such as a
  /// data model.
  final bool bufferIncompleteComponents;

  /// Whether a streamed component is held back until its JSON object closes:
  /// for v1.0 catalogs always, and otherwise as [bufferIncompleteComponents]
  /// says.
  ///
  /// Read from the catalogs without checking them, so that a parser of
  /// catalogs it cannot read still reads text.
  bool get _buffersComponents =>
      bufferIncompleteComponents ||
      catalogs.any(
        (CatalogApi c) =>
            c.protocolVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false,
      );

  /// Built on first use, since building it checks the catalogs: a parser of
  /// catalogs it cannot read still wraps, unwraps and reads text.
  late final MessageReader _reader = MessageReader(catalogs);

  /// The reader of this parser's messages.
  ///
  /// Throws [A2uiCatalogError] if there are no catalogs or they target
  /// different versions.
  MessageReader _readerFor() {
    if (catalogs.isEmpty) {
      throw A2uiCatalogError(
        'Compiling direct JSON needs at least one catalog.',
      );
    }
    return _reader;
  }

  /// Direct JSON can be read before a block closes, by healing the unfinished
  /// JSON.
  @override
  bool get supportsStreaming => true;

  /// Whether [content] carries an `<a2ui-json>` block, closed when [complete]
  /// is true.
  @override
  bool hasFormatContent(String content, {bool complete = false}) {
    if (!complete && openTag.hasMatch(content)) return true;
    return unwrap(
      content,
    ).any((RawResponsePart p) => p is RawA2uiPart && (!complete || p.isFinal));
  }

  /// Writes each part on its own line, with the `<a2ui-json>` and
  /// `</a2ui-json>` tags on lines of their own.
  @override
  String wrap(List<RawResponsePart> parts) => [
    for (final RawResponsePart part in parts)
      switch (part) {
        TextPart(:final String text) => text,
        RawA2uiPart(:final String a2uiRaw) =>
          '<a2ui-json>\n$a2uiRaw\n</a2ui-json>',
      },
  ].join('\n');

  /// Splits [content] into text and direct JSON blocks, in the order the
  /// model wrote them.
  ///
  /// A close tag inside a JSON string does not end a block. Text is trimmed
  /// and dropped when empty, and markdown fences or inline-code backticks a
  /// model wraps around a block are removed. At most one block whose
  /// `<a2ui-json>` open tag was omitted before `</a2ui-json>` is recovered in
  /// one-shot parsing. Tags of another format are text. See
  /// `conformance/agent/direct_json/response_parser.yaml`.
  @override
  List<RawResponsePart> unwrap(String content) {
    final parts = <RawResponsePart>[];
    var i = 0;
    var recoveredUnmatched = false;
    while (i < content.length) {
      final Match? open = openTag.allMatches(content, i).firstOrNull;
      final int searchEnd = open?.start ?? content.length;
      if (!recoveredUnmatched && searchEnd > i) {
        final int? nextI = tryRecoverUnmatchedClose(
          parts,
          content,
          i,
          searchEnd,
        );
        if (nextI != null) {
          recoveredUnmatched = true;
          i = nextI;
          continue;
        }
      }
      if (open == null) break;
      String textBefore = content.substring(i, open.start);
      if (textBefore.endsWith('`')) {
        textBefore = textBefore.replaceAll(RegExp(r'`+$'), '');
      }
      addText(parts, textBefore);
      final int? end = scanBlock(content, open.end).closeStart;
      if (end == null) {
        parts.add(
          RawA2uiPart(cleanRaw(content.substring(open.end)), isFinal: false),
        );
        return parts;
      }
      parts.add(RawA2uiPart(cleanRaw(content.substring(open.end, end))));
      i = closeTag.matchAsPrefix(content, end)!.end;
      while (i < content.length && content[i] == '`') {
        i++;
      }
    }
    addText(parts, content.substring(i));
    return parts;
  }

  /// Reads a list of messages, or a single message, into messages of the
  /// catalogs' protocol version.
  ///
  /// A trailing comma, a curly quote used as a JSON quote and a markdown
  /// fence around the payload are repaired before reading.
  ///
  /// Compiling only reads the messages. Checking them against the catalogs
  /// and the surfaces a renderer holds is [parseResponse]'s and
  /// [openStream]'s.
  ///
  /// Throws [A2uiParseError] if [formatContent] is empty or not JSON,
  /// [A2uiCatalogError] if there are no catalogs or they target different
  /// versions, and [A2uiValidationError] if a message is not a message of
  /// the catalogs' version, declares another version or none, or carries a
  /// field the message does not define.
  @override
  List<AgentToRendererMessage> compile(String formatContent) {
    final String content = cleanRaw(formatContent);
    if (content.isEmpty) {
      throw A2uiParseError(
        'The direct JSON block is empty.',
        rawContent: formatContent,
      );
    }
    final Object? decoded;
    try {
      decoded = readJson(content);
    } on FormatException catch (e) {
      throw A2uiParseError(
        'The direct JSON block is not JSON: ${e.message} at offset '
        '${e.offset}.',
        rawContent: formatContent,
      );
    }
    // Read before the loop, so that an empty list checks the catalogs too.
    final MessageReader reader = _readerFor();
    return [
      for (final Object? envelope in decoded is List ? decoded : [decoded])
        reader.read(envelope),
    ];
  }

  /// Writes [a2uiPayload] as a JSON list, one message per line.
  @override
  String decompile(List<AgentToRendererMessage> a2uiPayload) {
    if (a2uiPayload.isEmpty) return '[]';
    final String messages = a2uiPayload
        .map((AgentToRendererMessage m) => '  ${jsonEncode(m.toJson())}')
        .join(',\n');
    return '[\n$messages\n]';
  }

  /// Opens a [DirectJsonResponseStream] for one response.
  ///
  /// Values of [progressiveKeys] are shown while they grow; any other
  /// unfinished value is held back until it is complete. See
  /// [DirectJsonResponseStream] for what the stream emits and checks.
  ///
  /// Throws [A2uiCatalogError] if no [state] is given and a new one cannot be
  /// created for [catalogs].
  @override
  DirectJsonResponseStream openStream({
    bool wrapped = true,
    RendererState? state,
  }) => DirectJsonResponseStream._(
    this,
    wrapped: wrapped,
    state: state ?? RendererState(catalogs),
  );

  /// Opens a [DirectJsonResponseStream] for one response that reads past a
  /// rejected block. See [Parser.openContinuingStream] and [openStream].
  @override
  DirectJsonContinuingResponseStream openContinuingStream({
    bool wrapped = true,
    RendererState? state,
  }) => DirectJsonContinuingResponseStream._(
    this,
    wrapped: wrapped,
    state: state ?? RendererState(catalogs),
  );
}
