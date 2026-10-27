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

part of 'parser.dart';

/// Reads one streamed direct JSON response.
///
/// Obtained from [DirectJsonParser.openStream].
///
/// Text outside a block is emitted as it arrives, less trailing whitespace
/// and any tail that could be the start of a tag, which wait for the next
/// chunk or for [close].
///
/// A message is emitted, and applied to [state], as soon as it reads and the
/// state accepts it, and again each time a later chunk changes it; each
/// [A2uiPart] carries the messages of one block that are new or changed. Only
/// `updateComponents` and `updateDataModel` are emitted while they grow. Any
/// other message, such as `createSurface`, `deleteSurface` or
/// `callRendererFunction`, is held until its object closes, and the messages
/// after it wait with it. When a block closes, the messages it holds are
/// applied in full and every surface they touched is checked in full. See
/// `conformance/agent/direct_json/response_streaming.yaml`.
///
/// Each chunk is read once. The scan for the close tag and the read of the
/// open block go on from where the previous chunk left them, a message that
/// has closed is not read, applied or checked again, and a message that
/// grows is checked for what it gains: an `updateComponents` applies only the
/// components it gained, and the last one again if it grew, and an
/// `updateDataModel` is checked for the lists and maps its value gained and
/// applied again once it closes.
///
/// The stream ends when [close] returns or when [feed] or [close] throws:
/// the response cannot be read further once part of it is rejected. The
/// messages already emitted stay in [state], since the renderer holds them,
/// and the components they added are marked checked
/// ([RendererState.markChecked]), so a later turn on the surface is not
/// required to make them reachable.
class DirectJsonResponseStream extends ResponseStream {
  DirectJsonResponseStream._(
    this._parser, {
    required bool wrapped,
    required this.state,
  }) : _wrapped = wrapped,
       _inBlock = !wrapped;

  final DirectJsonParser _parser;
  final bool _wrapped;

  @override
  final RendererState state;

  bool _closed = false;

  // Text outside blocks.
  String _held = '';
  bool _runStarted = false;
  String _heldSpace = '';
  String _heldBackticks = '';
  bool _stripCloseBackticks = false;

  // The open block.
  bool _inBlock;
  String _block = '';

  /// Finds the close tag of the open block as its text arrives.
  BlockScanner _scanner = BlockScanner(0);

  /// What the reads of the open block keep from one chunk to the next, for
  /// reads of the payload starting at [_readStart].
  PartialReadCache _readCache = PartialReadCache();
  int? _readStart;

  /// How many messages of the open block have closed and been applied.
  int _done = 0;

  /// The message of the open block that is still growing, as far as it is
  /// applied, or null.
  _Growing? _growing;

  /// Whether a message of the open block that has closed was rejected. It is
  /// rejected the same way on every later chunk, so nothing after it is
  /// emitted before the block closes.
  bool _stalled = false;

  /// The surfaces the messages of the open block touched.
  final Set<String> _touched = {};

  /// Throws [A2uiParseError] if a block closes on text that is not JSON,
  /// [A2uiValidationError] if a message the block closes with is rejected,
  /// and what [DirectJsonParser.compile] throws for the catalogs, such as
  /// [A2uiCatalogError] for catalogs of different versions, as soon as a
  /// block holds part of a message.
  @override
  List<ResponsePart> feed(String chunk) {
    if (_closed) throw StateError('The response stream is closed.');
    // The surfaces of the messages already emitted in the open block, which
    // the state still holds if the chunk fails.
    final Set<String> emitted = {..._touched};
    try {
      // A chunk may apply messages and then fail, for example in a second
      // block, before its parts are returned. The transaction undoes them, so
      // the state holds only what was emitted.
      return state.transaction(() => _feed(chunk));
    } catch (_) {
      _fail(emitted);
      rethrow;
    }
  }

  @override
  List<ResponsePart> close() {
    if (_closed) return [];
    _closed = true;
    final parts = <ResponsePart>[];
    try {
      if (!_wrapped) {
        _finishBlock(parts, _block.length);
        return parts;
      }
      if (_inBlock) {
        throw A2uiParseError(
          'The response ended inside an $openTagText block, before its '
          '$closeTagText tag.',
        );
      }
    } catch (_) {
      _fail(_touched);
      rethrow;
    }
    if (_heldBackticks.isNotEmpty) {
      _emitText(parts, _heldBackticks);
      _heldBackticks = '';
    } else if (_held.isNotEmpty) {
      _emitText(parts, _held);
      _held = '';
    }
    return parts;
  }

  /// Ends the stream after a failure, keeping what it emitted.
  ///
  /// The renderer holds the messages already emitted, which touched
  /// [surfaceIds], and so does the state. No message removes a component, so
  /// the components they added are marked checked: a later turn is not
  /// required to make them reachable.
  void _fail(Iterable<String> surfaceIds) {
    _closed = true;
    state.markChecked(surfaceIds);
  }

  List<ResponsePart> _feed(String chunk) {
    final parts = <ResponsePart>[];
    if (!_wrapped) {
      _block += chunk;
      _emitReady(parts, _block.length);
      return parts;
    }
    String input = _held + chunk;
    _held = '';
    if (_stripCloseBackticks) {
      if (input.startsWith('`')) {
        input = input.replaceAll(RegExp(r'^`+'), '');
      }
      if (input.isNotEmpty) {
        _stripCloseBackticks = false;
      }
    }
    if (!_inBlock && _heldBackticks.isNotEmpty) {
      if (input.isNotEmpty) {
        final bool isOpenTag =
            openTag.matchAsPrefix(input) != null ||
            (input.startsWith('<') &&
                openTagText.startsWith(input.toLowerCase()));
        if (isOpenTag) {
          _heldBackticks = '';
        } else {
          input = '$_heldBackticks$input';
          _heldBackticks = '';
        }
      }
    }
    while (input.isNotEmpty) {
      if (_inBlock) {
        _block += input;
        input = '';
        final BlockScan scan = _scanner.scan(_block);
        final int? closeStart = scan.closeStart;
        if (closeStart == null) {
          _emitReady(parts, scan.readableEnd);
          break;
        }
        input = _block.substring(
          closeTag.matchAsPrefix(_block, closeStart)!.end,
        );
        if (input.startsWith('`')) {
          input = input.replaceAll(RegExp(r'^`+'), '');
        } else if (input.isEmpty) {
          _stripCloseBackticks = true;
        }
        _finishBlock(parts, closeStart);
        continue;
      }
      final Match? open = openTag.firstMatch(input);
      if (open != null) {
        String textBefore = input.substring(0, open.start);
        if (textBefore.endsWith('`')) {
          textBefore = textBefore.replaceAll(RegExp(r'`+$'), '');
        }
        _emitText(parts, textBefore);
        _runStarted = false;
        _heldSpace = '';
        _heldBackticks = '';
        _inBlock = true;
        input = input.substring(open.end);
        continue;
      }
      int hold = possibleTagStart(input);
      if (hold < input.length) {
        while (hold > 0 && input.codeUnitAt(hold - 1) == 0x60) {
          hold--;
        }
      }
      String textToEmit = input.substring(0, hold);
      _held = input.substring(hold);
      input = '';
      if (_held.isEmpty) {
        final Match? ticksMatch = RegExp(r'`+$').firstMatch(textToEmit);
        if (ticksMatch != null) {
          _heldBackticks = ticksMatch.group(0)!;
          textToEmit = textToEmit.substring(
            0,
            textToEmit.length - _heldBackticks.length,
          );
        }
      }
      _emitText(parts, textToEmit);
    }
    return parts;
  }

  /// Emits the text of a run, less leading whitespace at the start of the
  /// run and trailing whitespace, which is held until more text arrives.
  void _emitText(List<ResponsePart> parts, String text) {
    final String body = (_runStarted ? text : text.trimLeft()).trimRight();
    if (body.isEmpty) {
      if (_runStarted && body.isEmpty) _heldSpace += text;
      return;
    }
    final int start = _runStarted ? 0 : text.indexOf(body);
    parts.add(TextPart('$_heldSpace$body'));
    _heldSpace = text.substring(start + body.length);
    _runStarted = true;
  }

  /// Reads the open block up to [end], going on from the previous read.
  ///
  /// Returns the block's messages, each with whether it has closed, or null
  /// while nothing but the start of a markdown fence has arrived.
  List<PartialMessage>? _read(int end) {
    final int? start = payloadStart(_block, end);
    if (start == null) return null;
    // The block only grows, so what earlier reads found holds while the
    // payload starts at the same place.
    if (start != _readStart) {
      _readStart = start;
      _readCache = PartialReadCache();
    }
    return readPartialMessages(
      _block,
      _parser.progressiveKeys,
      wholeItemKeys: _parser._buffersComponents
          ? const {'components'}
          : const {},
      cache: _readCache,
      start: start,
      end: trailingFenceStart(_block, start, end),
    );
  }

  /// Emits the messages of the open block, up to [end], that read and are
  /// new or changed.
  void _emitReady(List<ResponsePart> parts, int end) {
    final List<PartialMessage>? items = _read(end);
    if (items == null || items.isEmpty) return;
    // Read outside the loop, so that catalogs it cannot read throw rather
    // than pass for a message that has not arrived in full.
    final MessageReader reader = _parser._readerFor();
    final ready = <AgentToRendererMessage>[];
    for (int index = _done; !_stalled && index < items.length; index++) {
      final (:Object? message, :bool closed) = items[index];
      if (message is! Map<String, Object?>) break;
      // Only updateComponents and updateDataModel are emitted while they
      // grow. Any other message, such as createSurface, deleteSurface or
      // callRendererFunction, is held until its object closes, and the
      // messages after it wait with it.
      if (!closed && !_mayGrow(message)) break;
      final AgentToRendererMessage? emitted;
      try {
        emitted = _check(reader, message, closed: closed);
      } on A2uiError {
        // With whole components, each component of an update has closed, so
        // one that is rejected cannot become valid later.
        if (_parser._buffersComponents && _isWholeUpdate(message)) rethrow;
        // Not ready, and nothing after it is emitted ahead of it. The block
        // throws when it closes if it still is.
        _stalled = closed;
        break;
      }
      if (emitted != null) ready.add(emitted);
      // Only the last message read so far can be open.
      if (!closed) break;
      _done = index + 1;
      _growing = null;
    }
    if (ready.isNotEmpty) parts.add(A2uiPart(ready));
  }

  /// Applies the rest of the closed block that ends at [end] and checks the
  /// surfaces it touched.
  ///
  /// [DirectJsonParser.compile] only reads the block. Each message is checked
  /// when the state applies it: the messages that closed while the block
  /// arrived were checked then, and the rest are checked here. The trees of
  /// the surfaces the block touched are checked last.
  ///
  /// The messages not emitted yet are emitted only if the checks pass, so a
  /// failed block leaves the state holding what was emitted.
  void _finishBlock(List<ResponsePart> parts, int end) {
    // Compiled so that a block that is not JSON, or holds a message that does
    // not read, throws as compile does.
    final List<AgentToRendererMessage> messages = _parser.compile(
      _block.substring(0, end),
    );
    // The read goes on from where the reads of the open block stopped, so the
    // messages applied as they arrived are not applied again.
    final List<PartialMessage>? items = _read(end);
    final bool read =
        items != null &&
        items.length == messages.length &&
        items.every(
          (item) => item.closed && item.message is Map<String, Object?>,
        );
    final MessageReader reader = _parser._readerFor();
    final List<AgentToRendererMessage> ready = state.transaction(() {
      final ready = <AgentToRendererMessage>[];
      for (int index = _done; index < messages.length; index++) {
        if (read) {
          final AgentToRendererMessage? emitted = _check(
            reader,
            items[index].message! as Map<String, Object?>,
            closed: true,
          );
          if (emitted != null) ready.add(emitted);
        } else {
          _applyMessage(messages[index]);
          ready.add(messages[index]);
        }
        _growing = null;
      }
      state.checkTopology(_touched);
      return ready;
    });
    if (ready.isNotEmpty) parts.add(A2uiPart(ready));
    _inBlock = !_wrapped;
    _block = '';
    _scanner = BlockScanner(0);
    _readCache = PartialReadCache();
    _readStart = null;
    _done = 0;
    _growing = null;
    _stalled = false;
    _touched.clear();
  }

  /// Applies [envelope], the next message of the open block, or what it
  /// gained since the last chunk. [closed] says whether its object has
  /// closed.
  ///
  /// Returns the message to emit, or null if the renderer already holds it
  /// as it now stands.
  AgentToRendererMessage? _check(
    MessageReader reader,
    Map<String, Object?> envelope, {
    required bool closed,
  }) {
    if (_growing case final _Growing growing
        when _restJson(envelope, growing.key, growing.field) == growing.rest) {
      return growing.field == 'components'
          ? _checkAdded(reader, growing, envelope)
          : _checkGrown(reader, growing, envelope, closed: closed);
    }
    final AgentToRendererMessage message = reader.read(envelope);
    _applyMessage(message);
    _growing = null;
    final String? key = _growingKey(envelope);
    if (!closed && key != null) {
      final String field = _growingFields[key]!;
      if (_restJson(envelope, key, field) case final String rest) {
        final growing = _Growing(key, field, rest, message, envelope);
        if (envelope[key] case {'components': final List<Object?> components}) {
          growing
            ..count = components.length
            ..lastJson = components.isEmpty ? null : jsonEncode(components.last)
            ..lastId = components.isEmpty ? null : _componentId(components.last)
            ..ids = {
              for (final Object? component in components)
                ?_componentId(component),
            };
        }
        _growing = growing;
      }
    }
    return message;
  }

  /// Applies the components the growing `updateComponents` [growing] gained
  /// since the last chunk, as [envelope] now holds them.
  ///
  /// The components the state holds have closed, except the last one before
  /// v1.0, which is applied again if it has grown. Applying the added
  /// components over the ones applied before leaves the surface as applying
  /// the whole message would. An id that an earlier chunk of the message
  /// added is rejected, since the state sees each batch on its own and would
  /// take it for an update.
  AgentToRendererMessage? _checkAdded(
    MessageReader reader,
    _Growing growing,
    Map<String, Object?> envelope,
  ) {
    final body = envelope[growing.key]! as Map<String, Object?>;
    final components = body['components']! as List<Object?>;
    int kept = growing.count < components.length
        ? growing.count
        : components.length;
    Set<String> earlier = growing.ids;
    if (kept > 0 && jsonEncode(components[kept - 1]) != growing.lastJson) {
      kept--;
      earlier = {...earlier}..remove(growing.lastId);
    }
    if (kept == components.length) return null;
    final List<Object?> added = components.sublist(kept);
    checkDuplicateComponentIds([
      for (final Object? component in added)
        if (component is Map<String, Object?>) component,
    ], earlier: earlier);
    final delta =
        reader.read({
              ...envelope,
              growing.key: {...body, 'components': added},
            })
            as UpdateComponentsMessage;
    _applyMessage(delta);
    final previous = growing.message as UpdateComponentsMessage;
    final message = UpdateComponentsMessage(
      version: delta.version,
      surfaceId: delta.surfaceId,
      components: [...previous.components.take(kept), ...delta.components],
    );
    growing
      ..message = message
      ..count = components.length
      ..lastJson = jsonEncode(components.last)
      ..lastId = _componentId(components.last)
      ..ids = {
        ...earlier,
        for (final Object? component in added) ?_componentId(component),
      };
    return message;
  }

  /// Emits the growing `updateDataModel` [growing] again if the value
  /// [envelope] now holds changed.
  ///
  /// Of what a renderer checks, only the depth of the value depends on it,
  /// so only the lists and maps the value gained are checked while it grows.
  /// The message is applied again once it has [closed].
  AgentToRendererMessage? _checkGrown(
    MessageReader reader,
    _Growing growing,
    Map<String, Object?> envelope, {
    required bool closed,
  }) {
    final Object? value = (envelope[growing.key]! as Map)['value'];
    final previous = growing.message as UpdateDataModelMessage;
    final bool same = _sameJson(value, previous.value);
    final message = same
        ? previous
        : UpdateDataModelMessage(
            version: previous.version,
            surfaceId: previous.surfaceId,
            path: previous.path,
            value: value,
          );
    if (closed) {
      _applyMessage(message);
    } else if (!same) {
      checkPathsAndRecursion(
        envelope,
        version: reader.version,
        grownFrom: growing.envelope,
      );
    }
    growing
      ..message = message
      ..envelope = envelope;
    return same ? null : message;
  }

  /// Applies [message] to the state and records the surfaces it touched.
  void _applyMessage(AgentToRendererMessage message) =>
      _touched.addAll(state.apply([message]));
}

/// The message of the open block that is still growing, as far as the state
/// holds it.
class _Growing {
  _Growing(this.key, this.field, this.rest, this.message, this.envelope);

  /// The message's envelope key, such as `updateComponents`.
  final String key;

  /// The field of the body the message grows by.
  final String field;

  /// The JSON of the envelope without [field], which must not change for
  /// the message to be checked for what it gains.
  final String rest;

  /// The message as last emitted.
  AgentToRendererMessage message;

  /// The envelope last checked, whose closed lists and maps a later read
  /// returns as the same objects.
  Map<String, Object?> envelope;

  /// For a message that grows by its components, how many of them the state
  /// holds.
  int count = 0;

  /// The JSON of the last of those, which may still grow before v1.0, where
  /// a component is healed as it arrives.
  String? lastJson;

  /// The id of the last of those.
  String? lastId;

  /// The ids of the components the state holds.
  Set<String> ids = {};
}

/// The field each message that a renderer applies again as it grows grows
/// by.
const Map<String, String> _growingFields = {
  'updateComponents': 'components',
  'updateDataModel': 'value',
};

/// The key of [envelope] if it is a message a renderer applies again as it
/// grows, or null.
String? _growingKey(Map<String, Object?> envelope) {
  for (final String key in _growingFields.keys) {
    if (envelope.containsKey(key)) return key;
  }
  return null;
}

/// Whether [envelope], a message still arriving, may be applied and emitted
/// already: one a renderer applies again as it grows, holding the field it
/// grows by, with at least one component for a message that grows by its
/// components.
bool _mayGrow(Map<String, Object?> envelope) {
  final String? key = _growingKey(envelope);
  if (key == null) return false;
  return switch ((envelope[key], _growingFields[key])) {
    ({'components': List(isNotEmpty: true)}, 'components') => true,
    (final Map<Object?, Object?> body, 'value') => body.containsKey('value'),
    _ => false,
  };
}

/// The JSON of [envelope] without the [field] of its [key] body, or null if
/// the body does not hold that field.
String? _restJson(Map<String, Object?> envelope, String key, String field) {
  final Object? body = envelope[key];
  if (body is! Map<String, Object?> || !body.containsKey(field)) return null;
  if (field == 'components' && body[field] is! List) return null;
  return jsonEncode({
    ...envelope,
    key: {...body}..remove(field),
  });
}

/// The id of [component], or null.
String? _componentId(Object? component) => switch (component) {
  {'id': final String id} => id,
  _ => null,
};

/// Whether [a] and [b] are the same JSON value. A list or map that is the
/// same object in both, as the reads of a stream return one that has closed,
/// is not read.
bool _sameJson(Object? a, Object? b) {
  if (identical(a, b)) return true;
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!_sameJson(a[i], b[i])) return false;
    }
    return true;
  }
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final MapEntry<Object?, Object?> entry in a.entries) {
      if (!b.containsKey(entry.key) || !_sameJson(entry.value, b[entry.key])) {
        return false;
      }
    }
    return true;
  }
  return a == b;
}

/// Whether [envelope] is an `updateComponents` with its version, its surface
/// and at least one component.
bool _isWholeUpdate(Map<String, Object?> envelope) =>
    envelope['version'] is String &&
    switch (envelope['updateComponents']) {
      {'surfaceId': String(), 'components': List(isNotEmpty: true)} => true,
      _ => false,
    };
