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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';

final RegExp _openTag = RegExp(
  r'<a2ui-json(?:\s[^>]*)?>',
  caseSensitive: false,
);
final RegExp _closeTag = RegExp(r'</a2ui-json\s*>', caseSensitive: false);
final RegExp _tagWithAttributes = RegExp(
  r'^</?a2ui-json\s[^>]*$',
  caseSensitive: false,
);

/// Reads a model's reply in the direct JSON format as it streams.
///
/// Text outside the `<a2ui-json>` blocks goes to [onText], and each message
/// to [onMessage]. The parser reads each `updateComponents` message as it
/// streams, and every other message only once its object closes: given part
/// of one, the parser would send a `createSurface` again as it grows, and a
/// partial `updateDataModel` that replaces or deletes data
/// (https://github.com/a2ui-project/a2ui/issues/NNNN).
///
/// What the parser throws goes to [onError], with the id of the surface
/// whose message a block that closes is rejected for, or else an empty id.
/// The messages ahead of that message stay delivered, and reading goes on
/// after the block.
class ReplyReader {
  ReplyReader(
    this.format, {
    required this.onText,
    required this.onMessage,
    required this.onError,
  });

  /// The format whose parsers read the reply.
  final InferenceFormat format;

  final void Function(String text) onText;
  final void Function(AgentToRendererMessage message) onMessage;
  final void Function(Object error, String surfaceId) onError;

  /// The parser reading the reply, or null while the rest of a block it
  /// failed on is skipped.
  late Parser? _parser = format.createParser();

  String _reply = '';

  /// The length of [_reply] the parser has read.
  int _read = 0;

  final _MessageScan _scan = _MessageScan();

  /// Reads [chunk], the next chunk of the reply.
  void add(String chunk) {
    _reply += chunk;
    final int end = _scan.readableEnd(_reply);
    if (end > _read) _readTo(end);
  }

  /// Ends the reply. When it ends inside an `<a2ui-json>` block, reports
  /// that to [onError] with no surface id: the messages in the block that had
  /// not closed are never passed on.
  void close() {
    if (_scan._inBlock) {
      onError(
        A2uiParseError('The reply ended inside an <a2ui-json> block.'),
        '',
      );
    }
  }

  /// Gives the parser the reply up to [end], in pieces cut before each tag
  /// and after each close tag.
  void _readTo(int end) {
    final int start = _read;
    _read = end;
    final Set<int> cuts = {
      for (final int cut in _scan.cuts)
        if (cut > start && cut < end) cut,
      end,
    };
    var from = start;
    for (final cut in cuts) {
      _readPiece(from, cut, closes: _scan.closeEnds.contains(cut));
      from = cut;
    }
  }

  /// Reads the piece of the reply from [from] to [to], which ends a block
  /// when [closes].
  void _readPiece(int from, int to, {required bool closes}) {
    final Parser? parser = _parser;
    if (parser == null) {
      if (closes) _parser = format.createParser();
      return;
    }
    final List<ResponsePart> parts;
    try {
      parts = parser.parseChunk(_reply.substring(from, to));
    } on Object catch (error) {
      if (closes) {
        final String surfaceId =
            _failingSurfaceId(parser, _reply.substring(0, to)) ?? '';
        onError(error, surfaceId);
        _parser = format.createParser();
      } else {
        onError(error, '');
        _parser = null;
      }
      return;
    }
    for (final part in parts) {
      switch (part) {
        case TextPart(:final String text):
          onText(text);
        case A2uiPart(:final List<AgentToRendererMessage> a2ui):
          a2ui.forEach(onMessage);
      }
    }
  }
}

/// Finds where the text of a reply that a parser may read ends: before the
/// object of a message other than `updateComponents` that has not closed.
/// Also finds the reply's tags, outside JSON strings.
class _MessageScan {
  int _i = 0;
  bool _inBlock = false;
  bool _inString = false;
  int _stringStart = 0;

  /// Where each tag found so far starts, and where each close tag ends, in
  /// order.
  final Set<int> cuts = {};

  /// Where each close tag found so far ends.
  final Set<int> closeEnds = {};

  /// The brackets open in the current block.
  final List<String> _open = [];

  /// Where the object of the message being read starts, or null.
  int? _message;
  int _messageDepth = 0;
  bool _streams = false;

  /// The length of [reply] a parser may read, scanning on from where the
  /// last call stopped. Each call passes the reply so far.
  int readableEnd(String reply) {
    while (_i < reply.length) {
      final String c = reply[_i];
      if (_inString) {
        if (c == r'\') {
          if (_i + 1 == reply.length) break;
          _i++;
        } else if (c == '"') {
          _inString = false;
          _readString(reply.substring(_stringStart + 1, _i));
        }
      } else if (c == '<') {
        final Match? tag = (_inBlock ? _closeTag : _openTag).matchAsPrefix(
          reply,
          _i,
        );
        if (tag != null) {
          cuts.add(_i);
          if (_inBlock) {
            cuts.add(tag.end);
            closeEnds.add(tag.end);
          }
          _inBlock = !_inBlock;
          _open.clear();
          _message = null;
          _i = tag.end;
          continue;
        }
        if (_mayBecomeTag(reply.substring(_i))) break;
      } else if (!_inBlock) {
        // Text outside a block.
      } else if (c == '"') {
        _inString = true;
        _stringStart = _i;
      } else if (c == '{' || c == '[') {
        if (c == '{' && _open.length <= 1 && !_open.contains('{')) {
          _message = _i;
          _messageDepth = _open.length;
          _streams = false;
        }
        _open.add(c);
      } else if ((c == '}' || c == ']') && _open.isNotEmpty) {
        _open.removeLast();
        if (_open.length == _messageDepth) _message = null;
      }
      _i++;
    }
    final int? message = _message;
    return message != null && !_streams ? message : reply.length;
  }

  /// Notes a message whose type key [text] says it streams.
  void _readString(String text) {
    if (_message != null &&
        _open.length == _messageDepth + 1 &&
        text == 'updateComponents') {
      _streams = true;
    }
  }
}

/// Whether [rest], the end of a reply from a `<`, could still become an
/// `<a2ui-json>` or `</a2ui-json>` tag.
bool _mayBecomeTag(String rest) {
  final String text = rest.toLowerCase();
  return '<a2ui-json'.startsWith(text) ||
      '</a2ui-json'.startsWith(text) ||
      _tagWithAttributes.hasMatch(text);
}

/// The surface id named by the first message of the last block of [reply]
/// that [parser] rejects on its own, or null.
String? _failingSurfaceId(Parser parser, String reply) {
  final RawA2uiPart? block = parser
      .unwrap(reply)
      .whereType<RawA2uiPart>()
      .lastOrNull;
  if (block == null) return null;
  final Object? decoded;
  try {
    decoded = jsonDecode(block.a2uiRaw);
  } on FormatException {
    return null;
  }
  for (final Object? envelope in decoded is List ? decoded : [decoded]) {
    try {
      parser.compile(jsonEncode(envelope));
    } on Object {
      if (envelope is! Map) return null;
      for (final Object? body in envelope.values) {
        if (body case {'surfaceId': final String surfaceId}) return surfaceId;
      }
      return null;
    }
  }
  return null;
}
