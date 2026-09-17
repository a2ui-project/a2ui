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

import 'dart:async';
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart' as core;

import '../model/generation_events.dart';
import '../primitives/a2ui_validation_exception.dart';

/// Transforms a stream of text chunks into a stream of logical
/// [GenerationEvent]s.
///
/// It handles buffering split tokens, extracting JSON blocks, and sanitizing
/// text.
class A2uiParserTransformer
    extends StreamTransformerBase<String, GenerationEvent> {
  /// Creating a const constructor for the transformer.
  const A2uiParserTransformer();

  @override
  Stream<GenerationEvent> bind(Stream<String> stream) {
    return _A2uiParserStream(stream).stream;
  }
}

class _A2uiParserStream {
  _A2uiParserStream(Stream<String> input) {
    _controller = StreamController<GenerationEvent>(
      onListen: () {
        _subscription = input.listen(
          _onData,
          onError: _controller.addError,
          onDone: _onDone,
          cancelOnError: false,
        );
      },
      onPause: () => _subscription?.pause(),
      onResume: () => _subscription?.resume(),
      onCancel: () => _subscription?.cancel(),
    );
  }

  late final StreamController<GenerationEvent> _controller;
  StreamSubscription<String>? _subscription;
  String _buffer = '';
  // When true, whitespace-only content is treated as a JSONL separator and
  // discarded. When false, it is emitted as a TextEvent.
  bool _wasLastEventA2ui = false;

  Stream<GenerationEvent> get stream => _controller.stream;

  void _onData(String chunk) {
    _buffer += chunk;
    _processBuffer();
  }

  void _onDone() {
    // If there's anything left in the buffer that looks like text, emit it.
    if (_buffer.isNotEmpty) {
      _emitText(_buffer);
      _buffer = '';
    }
    _controller.close();
  }

  void _processBuffer() {
    while (_buffer.isNotEmpty) {
      // 1. Check for Markdown JSON block
      final _Match? markdownMatch = _findMarkdownJson(_buffer);
      if (markdownMatch != null) {
        try {
          final Object? decoded = jsonDecode(markdownMatch.content);
          if (decoded != null) {
            _emitBefore(markdownMatch.start);
            _emitMessage(decoded);
            _buffer = _buffer.substring(markdownMatch.end);
            continue;
          }
        } on FormatException {
          // Invalid JSON in markdown block.
          // Emit as text immediately so we don't get stuck in a loop
          // where the fallback logic waits for more data indefinitely.
          _emitBefore(markdownMatch.start);
          _emitText(markdownMatch.original);
          _buffer = _buffer.substring(markdownMatch.end);
          continue;
        }
      }

      // 2. Check for Balanced JSON
      final _Match? jsonMatch = _findBalancedJson(_buffer);
      if (jsonMatch != null) {
        // Prioritize markdown if it starts BEFORE the balanced JSON logic would
        // pick it up.
        if (markdownMatch != null && markdownMatch.start <= jsonMatch.start) {
          // We already tried markdown and failed (otherwise we continued).
          // Fall through.
        }

        try {
          final Object? decoded = jsonDecode(jsonMatch.content);
          if (decoded != null) {
            _emitBefore(jsonMatch.start);
            _emitMessage(decoded);
            _buffer = _buffer.substring(jsonMatch.end);
            continue;
          }
        } on FormatException catch (_) {
          // Invalid JSON.
          // Emit as text immediately to avoid stalling.
          _emitBefore(jsonMatch.start);
          _emitText(jsonMatch.original);
          _buffer = _buffer.substring(jsonMatch.end);
          continue;
        }
      }

      // 3. Fallback / Wait logic
      final int markdownStart = _buffer.indexOf('```');
      final int braceStart = _buffer.indexOf('{');

      var firstPotentialStart = -1;
      if (markdownStart != -1 && braceStart != -1) {
        firstPotentialStart = markdownStart < braceStart
            ? markdownStart
            : braceStart;
      } else if (markdownStart != -1) {
        firstPotentialStart = markdownStart;
      } else {
        firstPotentialStart = braceStart;
      }

      if (firstPotentialStart == -1) {
        // No potential JSON start.
        if (_buffer.isNotEmpty) {
          if (_wasLastEventA2ui && _buffer.trim().isEmpty) {
            // Whitespace-only after a JSON message: treat as JSONL separator.
            // Hold in buffer until more data arrives or stream ends.
            break;
          }
          _emitText(_buffer);
          _buffer = '';
        }
        break;
      } else {
        // Found a potential start at `firstPotentialStart`.
        if (firstPotentialStart > 0) {
          final String prefix = _buffer.substring(0, firstPotentialStart);
          if (_wasLastEventA2ui && prefix.trim().isEmpty) {
            // Skip whitespace-only prefix after a JSON message
            // (JSONL separator).
            _buffer = _buffer.substring(firstPotentialStart);
            continue;
          }
          _emitText(prefix);
          _buffer = _buffer.substring(firstPotentialStart);
        }
        // Buffer starts with potential JSON. Wait for more data.
        break;
      }
    }
  }

  void _emitBefore(int index) {
    if (index > 0) {
      _emitText(_buffer.substring(0, index));
    }
  }

  void _emitText(String text) {
    _wasLastEventA2ui = false;
    // Clean up protocol tags that might leak into text stream
    final String cleanText = text
        .replaceAll('<a2ui_message>', '')
        .replaceAll('</a2ui_message>', '');

    if (cleanText.isNotEmpty) {
      _controller.add(TextEvent(cleanText));
    }
  }

  /// Top-level keys that mark a JSON payload as an attempted A2UI message.
  /// If parsing fails on one of these, surface a validation error rather
  /// than fall back to plain text. `version` is included so a
  /// malformed-but-versioned payload still counts as an attempted message.
  static const _a2uiMessageKeys = {
    'version',
    'createSurface',
    'updateComponents',
    'updateDataModel',
    'deleteSurface',
  };

  bool _looksLikeA2uiMessage(Map<String, Object?> json) =>
      json.keys.any(_a2uiMessageKeys.contains);

  void _emitMessage(Object json) {
    if (json is Map<String, Object?>) {
      _tryEmitOne(json);
    } else if (json is List) {
      for (final Object? item in json) {
        if (item is Map<String, Object?>) {
          _tryEmitOne(item);
        }
      }
    }
  }

  void _tryEmitOne(Map<String, Object?> json) {
    try {
      _controller.add(A2uiMessageEvent(_parseMessage(json)));
      _wasLastEventA2ui = true;
    } catch (e) {
      if (_looksLikeA2uiMessage(json)) {
        _controller.addError(
          e is A2uiValidationException
              ? e
              : A2uiValidationException(
                  'Failed to parse A2UI message',
                  json: json,
                  cause: e,
                ),
        );
      } else {
        // Not an A2UI message; emit as plain text.
        _controller.add(TextEvent(jsonEncode(json)));
      }
      _wasLastEventA2ui = false;
    }
  }

  core.AgentToRendererMessage _parseMessage(Map<String, Object?> json) {
    try {
      return core.AgentToRendererMessage.fromJson(json);
    } on core.A2uiValidationError catch (e) {
      final String message = e.message.contains("'version'")
          ? 'A2UI message must have version "v0.9"'
          : e.message;
      throw A2uiValidationException(message, json: json, cause: e);
    }
  }

  _Match? _findMarkdownJson(String text) {
    final regex = RegExp(r'```(?:json)?\s*([\s\S]*?)\s*```');
    final RegExpMatch? match = regex.firstMatch(text);
    if (match != null) {
      return _Match(
        match.start,
        match.end,
        match.group(1) ?? '',
        match.group(0) ?? '',
      );
    }
    return null;
  }

  _Match? _findBalancedJson(String input) {
    if (!input.startsWith('{')) return null;

    var balance = 0;
    var inString = false;
    var isEscaped = false;

    for (var i = 0; i < input.length; i++) {
      final String char = input[i];

      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (char == '\\') {
        isEscaped = true;
        continue;
      }
      if (char == '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char == '{') {
          balance++;
        } else if (char == '}') {
          balance--;
          if (balance == 0) {
            final String text = input.substring(0, i + 1);
            return _Match(0, i + 1, text, text);
          }
        }
      }
    }
    return null;
  }
}

class _Match {
  _Match(this.start, this.end, this.content, this.original);
  final int start;
  final int end;
  final String content;
  final String original;
}
