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
import 'json_reader.dart';
import 'message_reader.dart';

// The open tag may carry attributes, such as `<a2ui-json version="v0.9">`.
final RegExp _openTag = RegExp(
  r'<a2ui-json(?:\s[^>]*)?>',
  caseSensitive: false,
);
final RegExp _closeTag = RegExp(r'</a2ui-json\s*>', caseSensitive: false);

/// The start of an open tag whose end has not arrived: `<a2ui-json` cut
/// anywhere, or followed by attributes.
final RegExp _openTagStart = RegExp(
  r'^<a2ui-json\s[^>]*$',
  caseSensitive: false,
);

final RegExp _leadingFence = RegExp(r'^```[a-zA-Z-]*\s*');
final RegExp _trailingFence = RegExp(r'\s*```[a-zA-Z-]*$');

/// Reads A2UI messages written as JSON inside `<a2ui-json>` tags, from a
/// complete response or as it streams.
///
/// A parser holds the state of one streamed response, so it reads one
/// response through [parseChunk]; [parseResponse] and the other members keep
/// no state.
class DirectJsonParser extends Parser {
  DirectJsonParser(
    List<CatalogApi> catalogs, {
    Set<String> progressiveKeys = const {},
    this.bufferIncompleteComponents = false,
  }) : catalogs = List.unmodifiable(catalogs),
       progressiveKeys = Set.unmodifiable(progressiveKeys);

  /// The catalogs payloads are validated against.
  final List<CatalogApi> catalogs;

  /// The string properties whose value a streamed payload may show before
  /// the value is complete, such as the text of a `Text` component.
  ///
  /// Which properties hold prose depends on the catalog, so there is no
  /// built-in set. Empty turns healing off.
  final Set<String> progressiveKeys;

  /// Whether a streamed component is held back until its JSON object closes,
  /// rather than healed and shown while it arrives.
  ///
  /// From v1.0 a component may name its own `catalogId`, and the key can
  /// arrive after its type and properties, so a component shown early may be
  /// checked and rendered against the wrong catalog. A v1.0 agent turns this
  /// on; [progressiveKeys] then only heal values outside components, such as
  /// a data model.
  final bool bufferIncompleteComponents;

  late final MessageReader _reader = MessageReader(catalogs);

  /// Direct JSON can be read before a block closes, by healing the unfinished
  /// JSON.
  @override
  bool get supportsStreaming => true;

  /// Whether [content] carries an `<a2ui-json>` block, closed when [complete]
  /// is true.
  @override
  bool hasFormatContent(String content, {bool complete = false}) {
    final Match? open = _openTag.firstMatch(content);
    if (open == null) return false;
    return !complete || _scanBlock(content, open.end).closeStart != null;
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
  /// and dropped when empty, and markdown fences a model wraps around a
  /// block are removed. Tags of another format are text. See
  /// `conformance/agent/direct_json/response_parser.yaml`.
  @override
  List<RawResponsePart> unwrap(String content) {
    final parts = <RawResponsePart>[];
    var i = 0;
    while (true) {
      final Match? open = _openTag.allMatches(content, i).firstOrNull;
      if (open == null) break;
      _addText(parts, content.substring(i, open.start));
      final int? end = _scanBlock(content, open.end).closeStart;
      if (end == null) {
        parts.add(
          RawA2uiPart(_clean(content.substring(open.end)), isFinal: false),
        );
        return parts;
      }
      parts.add(RawA2uiPart(_clean(content.substring(open.end, end))));
      i = _closeTag.matchAsPrefix(content, end)!.end;
    }
    _addText(parts, content.substring(i));
    return parts;
  }

  /// Reads a list of messages, or a single message, into v0.9 messages.
  ///
  /// A trailing comma, a curly quote used as a JSON quote and a markdown
  /// fence around the payload are repaired before reading.
  ///
  /// A payload may update a surface an earlier response created, so each
  /// message is checked against the surfaces the payload itself creates:
  /// its fields, its components against the schemas of their catalog, and
  /// the functions they call against the catalog's signatures. A component
  /// of a surface the payload does not create is checked against the first
  /// catalog declaring it. The checks that need a whole surface, such as a
  /// reachable root, are `A2uiRequestProcessor.parseResponse`'s.
  ///
  /// Throws [A2uiParseError] if [formatContent] is empty or not JSON, and
  /// [A2uiValidationError] if a message is not a v0.9 message, declares a
  /// version other than v0.9 or none, or names or uses anything the
  /// catalogs do not declare.
  @override
  List<AgentToRendererMessage> compile(String formatContent) {
    final String content = _clean(formatContent);
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
    if (catalogs.isEmpty) {
      throw A2uiCatalogError(
        'Compiling direct JSON needs at least one catalog.',
      );
    }
    final surfaces = <String, String>{};
    return [
      for (final Object? envelope in decoded is List ? decoded : [decoded])
        _reader.read(envelope, surfaces),
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

  // The state of the response read through parseChunk.
  bool? _wrapped;
  bool _inBlock = false;
  String _held = '';
  String _block = '';
  bool _runStarted = false;
  String _heldSpace = '';

  /// The messages of the current block emitted so far, as JSON.
  final List<String> _emitted = [];

  /// Values of [progressiveKeys] are shown while they grow; any other
  /// unfinished value is held back until it is complete.
  ///
  /// Text outside a block is emitted as it arrives, less trailing whitespace
  /// and any tail that could be the start of a tag, which wait for the next
  /// chunk. A message is emitted once it reads and satisfies the catalogs,
  /// and again whenever a later chunk changes it; each [A2uiPart] carries the
  /// messages of one block that are new or changed. See
  /// `conformance/agent/direct_json/response_streaming.yaml`.
  ///
  /// Throws [ArgumentError] if [wrapped] differs from the first call's,
  /// [A2uiParseError] if a block closes on text that is not JSON, and what
  /// [compile] throws for a block that closes.
  @override
  List<ResponsePart> parseChunk(String chunk, {bool wrapped = true}) {
    if (_wrapped == null) {
      _wrapped = wrapped;
      _inBlock = !wrapped;
    } else if (_wrapped != wrapped) {
      throw ArgumentError.value(
        wrapped,
        'wrapped',
        'A response is either wrapped or not; the first chunk said '
            '$_wrapped',
      );
    }
    final parts = <ResponsePart>[];
    if (!wrapped) {
      _block += chunk;
      _emitReady(parts, _block);
      return parts;
    }
    String input = _held + chunk;
    _held = '';
    while (input.isNotEmpty) {
      if (_inBlock) {
        _block += input;
        input = '';
        final _BlockScan scan = _scanBlock(_block, 0);
        final int? closeStart = scan.closeStart;
        if (closeStart == null) {
          _emitReady(parts, _block.substring(0, scan.readableEnd));
          break;
        }
        input = _block.substring(
          _closeTag.matchAsPrefix(_block, closeStart)!.end,
        );
        _emitChanged(parts, compile(_block.substring(0, closeStart)));
        _inBlock = false;
        _block = '';
        _emitted.clear();
        continue;
      }
      final Match? open = _openTag.firstMatch(input);
      if (open != null) {
        _emitText(parts, input.substring(0, open.start));
        _runStarted = false;
        _heldSpace = '';
        _inBlock = true;
        input = input.substring(open.end);
        continue;
      }
      final int hold = _possibleTagStart(input);
      _emitText(parts, input.substring(0, hold));
      _held = input.substring(hold);
      input = '';
    }
    return parts;
  }

  /// Emits the text of a run, less leading whitespace at the start of the
  /// run and trailing whitespace, which is held until more text arrives.
  void _emitText(List<ResponsePart> parts, String text) {
    final String body = (_runStarted ? text : text.trimLeft()).trimRight();
    if (body.isEmpty) {
      if (_runStarted) _heldSpace += text;
      return;
    }
    final int start = _runStarted ? 0 : text.indexOf(body);
    parts.add(TextPart('$_heldSpace$body'));
    _heldSpace = text.substring(start + body.length);
    _runStarted = true;
  }

  /// Emits the messages of [block], the start of a block, that read and are
  /// new or changed.
  void _emitReady(List<ResponsePart> parts, String block) {
    final String content = _cleanStart(block);
    final surfaces = <String, String>{};
    final ready = <AgentToRendererMessage>[];
    for (final Object? envelope in readPartialMessages(
      content,
      progressiveKeys,
      wholeItemKeys: bufferIncompleteComponents
          ? const {'components'}
          : const {},
    )) {
      try {
        ready.add(_reader.read(envelope, surfaces));
      } on A2uiError {
        // Not ready, and nothing after it is emitted ahead of it.
        break;
      }
    }
    _emitChanged(parts, ready);
  }

  void _emitChanged(
    List<ResponsePart> parts,
    List<AgentToRendererMessage> messages,
  ) {
    final changed = <AgentToRendererMessage>[];
    for (final (int i, AgentToRendererMessage message) in messages.indexed) {
      final String json = jsonEncode(message.toJson());
      if (i < _emitted.length) {
        if (_emitted[i] == json) continue;
        _emitted[i] = json;
      } else {
        _emitted.add(json);
      }
      changed.add(message);
    }
    if (changed.isNotEmpty) parts.add(A2uiPart(changed));
  }
}

/// The index in [text] from which the rest could still become an open tag,
/// or the length of [text].
int _possibleTagStart(String text) {
  for (int i = text.indexOf('<'); i >= 0; i = text.indexOf('<', i + 1)) {
    final String rest = text.substring(i);
    if ('<a2ui-json'.startsWith(rest.toLowerCase()) ||
        _openTagStart.hasMatch(rest)) {
      return i;
    }
  }
  return text.length;
}

void _addText(List<RawResponsePart> parts, String text) {
  final String cleaned = _clean(text);
  if (cleaned.isNotEmpty) parts.add(TextPart(cleaned));
}

String _clean(String text) => text
    .trim()
    .replaceFirst(_leadingFence, '')
    .replaceFirst(_trailingFence, '')
    .trim();

/// The start of a block, with a leading markdown fence removed once its line
/// is complete, and a trailing one removed.
String _cleanStart(String block) {
  String text = block.trimLeft();
  if (text.startsWith('`')) {
    final int newline = text.indexOf('\n');
    if (newline < 0) return '';
    text = text.substring(newline + 1);
  }
  return text.replaceFirst(RegExp(r'\s*`{1,3}[a-zA-Z-]*\s*$'), '');
}

/// Where a block ends, as [_scanBlock] finds it.
class _BlockScan {
  const _BlockScan(this.closeStart, this.readableEnd);

  /// The index of the close tag ending the block, or null if the block is
  /// not closed.
  final int? closeStart;

  /// The end of the block text that is payload rather than the start of a
  /// close tag, relative to where the block starts. Only meaningful for an
  /// open block.
  final int readableEnd;
}

/// Finds the close tag of the block starting at [start], outside JSON
/// strings.
_BlockScan _scanBlock(String content, int start) {
  var i = start;
  var inString = false;
  while (i < content.length) {
    final String c = content[i];
    if (inString) {
      if (c == r'\') {
        i += 2;
        continue;
      }
      if (c == '"') inString = false;
    } else if (c == '"') {
      inString = true;
    } else if (c == '<') {
      if (_closeTag.matchAsPrefix(content, i) != null) {
        return _BlockScan(i, i - start);
      }
      final String rest = content.substring(i).toLowerCase();
      if ('</a2ui-json>'.startsWith(rest) ||
          RegExp(r'^</a2ui-json\s*$').hasMatch(rest)) {
        return _BlockScan(null, i - start);
      }
    }
    i++;
  }
  return _BlockScan(null, content.length - start);
}
