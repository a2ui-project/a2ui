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

import '../../parser/response_part.dart';
import '../../parser/response_stream.dart';
import '../../utils/renderer_state.dart';
import 'compiler.dart';
import 'parser.dart';
import 'schema_helper.dart';

/// Default property keys whose open string literals are healed progressively
/// while streaming an `<a2ui>` Express block.
const Set<String> defaultExpressProgressiveKeys = {'text'};

const String _openTagLiteral = '<a2ui>';
const String _closeTagLiteral = '</a2ui>';
final RegExp _openTag = RegExp(r'<a2ui(?:\s[^>]*)?>', caseSensitive: false);
final RegExp _openTagStart = RegExp(r'^<a2ui\s[^>]*$', caseSensitive: false);
final RegExp _closeTag = RegExp(r'</a2ui\s*>', caseSensitive: false);
final RegExp _closeTagPrefix = RegExp(r'</a2ui\s*$', caseSensitive: false);
final RegExp _leadingFence = RegExp(
  r'^\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n',
  caseSensitive: false,
);
final RegExp _trailingFence = RegExp(
  r'(?:\r?\n)?[ \t]*```[ \t]*$',
  caseSensitive: false,
);
final RegExp _edgeBackticks = RegExp(r'^`+|`+$');
final RegExp _ident = RegExp(
  r'[\p{XID_Start}_]\p{XID_Continue}*',
  unicode: true,
);
final RegExp _dataAssign = RegExp(r'^\s*\$[a-zA-Z0-9_/]*\s*=(?!=)');

final RegExp _token = RegExp(
  r'[rR]"""[\s\S]*?"""'
  r'|[rR]"[^\r\n"]*"'
  r'|"""(?:\\[\s\S]|[^\\])*?"""'
  r'|"(?:\\[\s\S]|[^\\])*?"'
  r'|(?:#|//|--)[^\r\n]*'
  r'|/\*[\s\S]*?\*/'
  r'|\$[a-zA-Z0-9_/]*'
  r'|\?[\p{XID_Start}_]\p{XID_Continue}*'
  r'|[\p{XID_Start}_]\p{XID_Continue}*',
  unicode: true,
);

/// Index where a trailing partial `<a2ui` open tag may begin in [text], or
/// `text.length` if none is present.
int possibleOpenTagStart(String text) {
  final int start = (text.length - 64).clamp(0, text.length);
  for (var i = start; i < text.length; i++) {
    if (text.codeUnitAt(i) != 0x3C /* '<' */ ) continue;
    final String tail = text.substring(i);
    if (_openTagLiteral.startsWith(tail.toLowerCase()) ||
        _openTagStart.hasMatch(tail)) {
      return i;
    }
  }
  return text.length;
}

int? _commentCloseIndex(String content, int start, int end) {
  if (!content.startsWith('#', start) &&
      !content.startsWith('//', start) &&
      !content.startsWith('--', start)) {
    return null;
  }
  final Match? inComment = _closeTag.firstMatch(content.substring(start, end));
  return inComment == null ? null : start + inComment.start;
}

bool _isPartialCloseTag(String content, int i) {
  if (content.codeUnitAt(i) != 0x3C /* '<' */ ) return false;
  // Only a tail shorter than the tag can be a literal prefix of it, so the
  // substring copies at most a few characters.
  if (content.length - i < _closeTagLiteral.length &&
      _closeTagLiteral.startsWith(content.substring(i).toLowerCase())) {
    return true;
  }
  return _closeTagPrefix.matchAsPrefix(content, i) != null;
}

bool _isUnclosedDelimiter(String content, int i) =>
    content.startsWith('"', i) || content.startsWith('/*', i);

/// Scans an `<a2ui>` block in [content] for its closing `</a2ui>` tag.
///
/// Returns `(closeStart, readableEnd)`. When `closeStart` is not null, the
/// block closes there. When `closeStart` is null, `readableEnd` is the index up
/// to which the block is safe to read (excluding any trailing partial
/// `</a2ui>` prefix outside strings and comments).
(int?, int) scanExpressBlock(String content) {
  var i = 0;
  final int n = content.length;
  while (i < n) {
    if (_closeTag.matchAsPrefix(content, i) != null) return (i, i);
    if (_isPartialCloseTag(content, i)) return (null, i);
    if (_token.matchAsPrefix(content, i) case final Match token) {
      final int? inComment = _commentCloseIndex(content, i, token.end);
      if (inComment != null) return (inComment, inComment);
      i = token.end;
    } else if (_isUnclosedDelimiter(content, i)) {
      return (null, n);
    } else {
      i++;
    }
  }
  return (null, n);
}

/// Strips leading/trailing markdown fences and edge backticks from
/// `block.substring(0, end)`, returning null if only an incomplete opening
/// fence has arrived so far.
String? cleanExpressPayload(String block, int end) {
  final String text = block.substring(0, end);
  final String stripped = text.trimLeft();
  if (stripped.isNotEmpty &&
      stripped.length <= 3 &&
      '```'.startsWith(stripped)) {
    return null;
  }
  if (stripped.startsWith('```') && !stripped.contains('\n')) {
    return null;
  }
  return text
      .replaceFirst(_leadingFence, '')
      .replaceFirst(_trailingFence, '')
      .replaceAll(_edgeBackticks, '');
}

class _ScanCursor {
  int depth = 0;
  bool hasToken = false;
  bool sawEquals = false;
  bool hasRhs = false;
  bool rhsClosed = false;
  int lastComplete = 0;

  void resetStatement(int pos) {
    hasToken = false;
    sawEquals = false;
    hasRhs = false;
    rhsClosed = false;
    lastComplete = pos;
  }
}

/// Splits [source] into `(completePrefix, trailingFragment)`.
(String, String) splitCompleteStatements(
  String source, {
  bool isFinal = false,
}) {
  if (isFinal) return (source, '');
  final cur = _ScanCursor();
  var i = 0;
  final int n = source.length;
  while (i < n) {
    final (int nextI, bool closedString) = _stepStringOrComment(source, i, n);
    if (nextI > i) {
      if (closedString && cur.depth == 0 && cur.sawEquals) {
        cur.hasRhs = true;
        cur.rhsClosed = true;
        cur.lastComplete = nextI;
      }
      i = nextI;
      continue;
    }
    i = _stepCodeChar(source, i, n, cur);
  }
  return (
    source.substring(0, cur.lastComplete),
    source.substring(cur.lastComplete),
  );
}

(int, bool) _stepStringOrComment(String source, int i, int n) {
  if ((source[i] == 'r' || source[i] == 'R') &&
      i + 1 < n &&
      source[i + 1] == '"') {
    final int? end = _scanDoubleQuoted(source, i + 1, n, raw: true);
    return end == null ? (n, false) : (end, true);
  }
  if (source[i] == '"') {
    final int? end = _scanDoubleQuoted(source, i, n, raw: false);
    return end == null ? (n, false) : (end, true);
  }
  if (source.startsWith('/*', i)) {
    final int close = source.indexOf('*/', i + 2);
    return close >= 0 ? (close + 2, false) : (n, false);
  }
  if (source[i] == '#' ||
      source.startsWith('//', i) ||
      source.startsWith('--', i)) {
    final int nl = source.indexOf('\n', i);
    return nl >= 0 ? (nl, false) : (n, false);
  }
  return (i, false);
}

int? _scanDoubleQuoted(
  String source,
  int quoteStart,
  int n, {
  required bool raw,
}) {
  final bool triple = source.startsWith('"""', quoteStart);
  final delim = triple ? '"""' : '"';
  int i = quoteStart + delim.length;
  while (i < n) {
    if (!raw && source.codeUnitAt(i) == 0x5C /* '\\' */ ) {
      if (i + 1 >= n) return null;
      i += 2;
      continue;
    }
    if (source.startsWith(delim, i)) {
      return i + delim.length;
    }
    i++;
  }
  return null;
}

int _stepCodeChar(String source, int i, int n, _ScanCursor cur) {
  final String ch = source[i];
  if (ch == '(' || ch == '[' || ch == '{') {
    _onOpenBracket(cur);
  } else if (ch == ')' || ch == ']' || ch == '}') {
    _onCloseBracket(i, cur);
  } else if (cur.depth == 0 && (ch == '\n' || ch == ';')) {
    _onStatementSeparator(i, cur);
  } else if (ch.trim().isNotEmpty) {
    _onNonSpaceChar(source, i, n, cur);
  }
  return i + 1;
}

void _onOpenBracket(_ScanCursor cur) {
  cur.depth++;
  cur.hasToken = true;
  if (cur.sawEquals) {
    cur.hasRhs = true;
    cur.rhsClosed = false;
  }
}

void _onCloseBracket(int i, _ScanCursor cur) {
  if (cur.depth <= 0) return;
  cur.depth--;
  if (cur.depth == 0 && (cur.sawEquals || cur.hasToken)) {
    cur.hasRhs = true;
    cur.rhsClosed = true;
    cur.lastComplete = i + 1;
  }
}

void _onStatementSeparator(int i, _ScanCursor cur) {
  if (cur.rhsClosed || (cur.sawEquals && cur.hasRhs)) {
    cur.resetStatement(i + 1);
  } else if (!cur.hasToken) {
    cur.lastComplete = i + 1;
  }
}

void _onNonSpaceChar(String source, int i, int n, _ScanCursor cur) {
  if (cur.depth == 0 &&
      source[i] == '=' &&
      (i + 1 >= n || source[i + 1] != '=')) {
    cur.sawEquals = true;
    cur.hasToken = true;
    return;
  }
  cur.hasToken = true;
  if (cur.depth == 0 && cur.sawEquals) {
    cur.hasRhs = true;
  }
}

class _OpenCallFrame {
  _OpenCallFrame(this.name);

  final String name;
  int argIndex = 0;
  String? kwargName;
  String? lastIdent;
}

class _FragmentScanState {
  final List<String> brackets = [];
  final List<_OpenCallFrame> calls = [];
  String? lastIdent;
}

typedef _UnclosedStringState = (
  int strStart,
  String delim,
  bool isRaw,
  List<String> brackets,
  List<_OpenCallFrame> calls,
);

/// Heals an unclosed progressive string literal at the tail of [fragment], or
/// returns null when [fragment] is not in a healable progressive string slot.
String? healProgressiveFragment(
  String fragment,
  Map<String, CatalogSchemaHelper> helpers,
  Set<String> progressiveKeys,
) {
  if (progressiveKeys.isEmpty || fragment.trim().isEmpty) return null;
  final _UnclosedStringState? state = _scanFragmentForUnclosedString(fragment);
  if (state == null) return null;
  final (
    int strStart,
    String delim,
    bool isRaw,
    List<String> brackets,
    List<_OpenCallFrame> calls,
  ) = state;
  final String content = fragment.substring(strStart);
  if (_isUrlLike(content)) return null;
  if (!_isProgressiveSlot(fragment, calls, helpers, progressiveKeys)) {
    return null;
  }
  var healed = fragment;
  if (!isRaw && _hasOddTrailingBackslashes(healed)) {
    healed = healed.substring(0, healed.length - 1);
  }
  if (delim == '"""' && !isRaw && healed.endsWith('"')) {
    healed = '${healed.substring(0, healed.length - 1)}\\"';
  }
  final String closingBrackets = [
    for (final String b in brackets.reversed) _closingDelimiter(b),
  ].join();
  return '$healed$delim$closingBrackets';
}

_UnclosedStringState? _scanFragmentForUnclosedString(String fragment) {
  var i = 0;
  final int n = fragment.length;
  final st = _FragmentScanState();

  while (i < n) {
    final (int, _UnclosedStringState?)? strRes = _tryScanFragmentString(
      fragment,
      i,
      n,
      st,
    );
    if (strRes != null) {
      final (int nextI, _UnclosedStringState? unclosed) = strRes;
      if (unclosed != null) return unclosed;
      i = nextI;
      continue;
    }
    final int? commentI = _trySkipFragmentComment(fragment, i, n);
    if (commentI != null) {
      if (commentI < 0) return null;
      i = commentI;
      continue;
    }
    i = _stepFragmentToken(fragment, i, st);
  }
  return null;
}

(int, _UnclosedStringState?)? _tryScanFragmentString(
  String fragment,
  int i,
  int n,
  _FragmentScanState st,
) {
  final bool isRaw =
      (fragment[i] == 'r' || fragment[i] == 'R') &&
      i + 1 < n &&
      fragment[i + 1] == '"';
  if (!isRaw && fragment[i] != '"') return null;
  final int quotePos = isRaw ? i + 1 : i;
  final delim = fragment.startsWith('"""', quotePos) ? '"""' : '"';
  final int? end = _scanDoubleQuoted(fragment, quotePos, n, raw: isRaw);
  if (end == null) {
    return (n, (quotePos + delim.length, delim, isRaw, st.brackets, st.calls));
  }
  return (end, null);
}

int? _trySkipFragmentComment(String fragment, int i, int n) {
  if (fragment.startsWith('/*', i)) {
    final int close = fragment.indexOf('*/', i + 2);
    return close < 0 ? -1 : close + 2;
  }
  if (fragment[i] == '#' ||
      fragment.startsWith('//', i) ||
      fragment.startsWith('--', i)) {
    final int nl = fragment.indexOf('\n', i);
    return nl < 0 ? -1 : nl + 1;
  }
  return null;
}

int _stepFragmentToken(String fragment, int i, _FragmentScanState st) {
  if (_ident.matchAsPrefix(fragment, i) case final Match m) {
    st.lastIdent = m.group(0);
    if (st.calls.isNotEmpty &&
        st.brackets.isNotEmpty &&
        st.brackets.last == '(') {
      st.calls.last.lastIdent = st.lastIdent;
    }
    return m.end;
  }
  _applyFragmentPunct(fragment[i], st);
  return i + 1;
}

void _applyFragmentPunct(String ch, _FragmentScanState st) {
  final bool inCallParens =
      st.calls.isNotEmpty && st.brackets.isNotEmpty && st.brackets.last == '(';
  if (ch == '(') {
    st.brackets.add('(');
    st.calls.add(_OpenCallFrame(st.lastIdent ?? ''));
    st.lastIdent = null;
  } else if (ch == '[' || ch == '{') {
    st.brackets.add(ch);
    st.lastIdent = null;
  } else if (ch == ')' || ch == ']' || ch == '}') {
    if (st.brackets.isNotEmpty &&
        st.brackets.removeLast() == '(' &&
        st.calls.isNotEmpty) {
      st.calls.removeLast();
    }
    st.lastIdent = null;
  } else if (ch == ',' && inCallParens) {
    st.calls.last
      ..argIndex += 1
      ..kwargName = null
      ..lastIdent = null;
  } else if (ch == '=' && inCallParens && st.calls.last.lastIdent != null) {
    st.calls.last.kwargName = st.calls.last.lastIdent;
  } else if (ch.trim().isNotEmpty) {
    st.lastIdent = null;
  }
}

bool _isProgressiveSlot(
  String fragment,
  List<_OpenCallFrame> calls,
  Map<String, CatalogSchemaHelper> helpers,
  Set<String> progressiveKeys,
) {
  if (calls.isEmpty) {
    return _dataAssign.hasMatch(fragment);
  }
  final _OpenCallFrame frame = calls.last;
  if (frame.name.isEmpty) return false;
  for (final CatalogSchemaHelper helper in helpers.values) {
    if (helper.isComponent(frame.name)) {
      if (frame.kwargName != null) {
        return progressiveKeys.contains(frame.kwargName);
      }
      final List<String> props = helper.properties(frame.name);
      if (frame.argIndex < props.length) {
        return progressiveKeys.contains(props[frame.argIndex]);
      }
    }
  }
  return false;
}

bool _isUrlLike(String content) {
  final String lower = content.trimLeft().toLowerCase();
  return lower.startsWith('http://') ||
      lower.startsWith('https://') ||
      lower.startsWith('data:');
}

bool _hasOddTrailingBackslashes(String text) {
  var count = 0;
  int idx = text.length - 1;
  while (idx >= 0 && text.codeUnitAt(idx) == 0x5C /* '\\' */ ) {
    count++;
    idx--;
  }
  return count.isOdd;
}

String _closingDelimiter(String openCh) => switch (openCh) {
  '(' => ')',
  '[' => ']',
  '{' => '}',
  _ => ')',
};

/// Reads one streamed Express response chunk by chunk.
///
/// Obtained from [ExpressParser.openStream].
class ExpressResponseStream extends ResponseStream {
  /// Creates a stream for [_parser].
  ExpressResponseStream(
    this._parser, {
    required bool wrapped,
    required this.state,
    Set<String>? progressiveKeys,
  }) : _compiler = ExpressCompiler(_parser.catalogs),
       _wrapped = wrapped,
       _inBlock = !wrapped,
       _progressiveKeys = Set.unmodifiable(
         progressiveKeys ?? _parser.progressiveKeys,
       ) {
    _resetBlock();
  }

  final ExpressParser _parser;
  final ExpressCompiler _compiler;
  final bool _wrapped;
  final Set<String> _progressiveKeys;

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
  String _lastCompiledPrefix = '';
  final Set<String> _touched = {};
  late Set<String> _initialSurfaces;
  late ExpressScopeSession _session;

  void _resetBlock() {
    _block = '';
    _lastCompiledPrefix = '';
    _touched.clear();
    _initialSurfaces = Set.unmodifiable(state.surfaceIds);
    _session = ExpressScopeSession(_compiler);
  }

  @override
  List<ResponsePart> feed(String chunk) {
    if (_closed) throw StateError('The response stream is closed.');
    final Set<String> emitted = {..._touched};
    try {
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
        state.markChecked(_touched);
        _resetBlock();
        throw A2uiParseError(
          'The response ended inside an $_openTagLiteral block, before its '
          '</a2ui> tag.',
        );
      }
    } catch (_) {
      _fail(_touched);
      rethrow;
    }
    if (_heldBackticks.isNotEmpty) {
      _emitText(parts, _heldBackticks);
      _heldBackticks = '';
    }
    if (_held.isNotEmpty) {
      _emitText(parts, _held);
      _held = '';
    }
    return parts;
  }

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
    String input = _prepareChunk(chunk);
    while (input.isNotEmpty) {
      if (_inBlock) {
        input = _consumeBlockText(parts, input);
      } else {
        input = _consumeOutsideText(parts, input);
      }
    }
    return parts;
  }

  String _prepareChunk(String chunk) {
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
    if (!_inBlock && _heldBackticks.isNotEmpty && input.isNotEmpty) {
      final bool isOpen =
          _openTag.matchAsPrefix(input) != null ||
          _openTagStart.hasMatch(input) ||
          (input.startsWith('<') &&
              input.length <= _openTagLiteral.length &&
              _openTagLiteral.startsWith(input.toLowerCase()));
      if (!isOpen) {
        input = '$_heldBackticks$input';
      }
      _heldBackticks = '';
    }
    return input;
  }

  String _consumeBlockText(List<ResponsePart> parts, String input) {
    _block += input;
    final (int? closeStart, int readableEnd) = scanExpressBlock(_block);
    if (closeStart == null) {
      _emitReady(parts, readableEnd);
      return '';
    }
    final Match closeMatch = _closeTag.matchAsPrefix(_block, closeStart)!;
    String remaining = _block.substring(closeMatch.end);
    if (remaining.startsWith('`')) {
      remaining = remaining.replaceAll(RegExp(r'^`+'), '');
    } else if (remaining.isEmpty) {
      _stripCloseBackticks = true;
    }
    _finishBlock(parts, closeStart);
    return remaining;
  }

  String _consumeOutsideText(List<ResponsePart> parts, String input) {
    final Match? openMatch = _openTag.firstMatch(input);
    if (openMatch != null) {
      String textBefore = input.substring(0, openMatch.start);
      if (textBefore.endsWith('`')) {
        textBefore = textBefore.replaceAll(RegExp(r'`+$'), '');
      }
      _emitText(parts, textBefore);
      _runStarted = false;
      _heldSpace = '';
      _heldBackticks = '';
      _inBlock = true;
      _resetBlock();
      return input.substring(openMatch.end);
    }

    int hold = possibleOpenTagStart(input);
    if (hold < input.length) {
      while (hold > 0 && input.codeUnitAt(hold - 1) == 0x60 /* '`' */ ) {
        hold--;
      }
    }
    String textToEmit = input.substring(0, hold);
    _held = input.substring(hold);
    if (_held.isEmpty) {
      final Match? ticksMatch = RegExp(r'`+$').firstMatch(textToEmit);
      if (ticksMatch != null) {
        _heldBackticks = ticksMatch.group(0)!;
        textToEmit = textToEmit.substring(0, ticksMatch.start);
      }
    }
    _emitText(parts, textToEmit);
    return '';
  }

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

  void _emitReady(List<ResponsePart> parts, int end) {
    final String? payload = cleanExpressPayload(_block, end);
    if (payload == null || payload.trim().isEmpty) return;
    final (String completePrefix, String trailingFragment) =
        splitCompleteStatements(payload);
    final readyMessages = <AgentToRendererMessage>[];
    if (completePrefix.trim().isNotEmpty &&
        completePrefix != _lastCompiledPrefix) {
      final List<AgentToRendererMessage> prefixMsgs = _compileStep(
        completePrefix,
        isFinal: false,
      );
      _lastCompiledPrefix = completePrefix;
      if (prefixMsgs.isNotEmpty) {
        _apply(prefixMsgs);
        readyMessages.addAll(prefixMsgs);
      }
    }

    final String? healed = healProgressiveFragment(
      trailingFragment,
      _compiler.catalogHelpers,
      _progressiveKeys,
    );
    if (healed != null) {
      final String combined = completePrefix.trim().isNotEmpty
          ? '$completePrefix\n$healed'
          : healed;
      readyMessages.addAll(_tryCompileAndApplyHealed(combined));
    }

    if (readyMessages.isNotEmpty) {
      parts.add(A2uiPart(_mergeSameSurfaceUpdates(readyMessages)));
    }
  }

  List<AgentToRendererMessage> _tryCompileAndApplyHealed(String combined) {
    final Object savedSession = _session.snapshot();
    final savedTouched = Set<String>.from(_touched);
    try {
      return state.transaction(() {
        final List<AgentToRendererMessage> msgs = _compileStep(
          combined,
          isFinal: false,
          cachePrefix: false,
        );
        if (msgs.isNotEmpty) {
          _apply(msgs);
        }
        return msgs;
      });
    } on A2uiError {
      _session.restore(savedSession);
      _touched
        ..clear()
        ..addAll(savedTouched);
      return const [];
    }
  }

  void _finishBlock(List<ResponsePart> parts, int end) {
    final String payload = cleanExpressPayload(_block, end) ?? '';
    final List<AgentToRendererMessage> models = state.transaction(() {
      final List<AgentToRendererMessage> emitted;
      if (!_session.hasEmitted) {
        emitted = _parser.compile(payload);
        _apply(emitted);
      } else {
        emitted = _compileStep(payload, isFinal: true);
        if (emitted.isNotEmpty) {
          _apply(emitted);
        }
      }
      state.checkTopology(_touched);
      return emitted;
    });
    if (models.isNotEmpty) {
      parts.add(A2uiPart(models));
    }
    _inBlock = !_wrapped;
    _resetBlock();
  }

  List<AgentToRendererMessage> _compileStep(
    String source, {
    required bool isFinal,
    bool cachePrefix = true,
  }) => _session.compileStep(
    source,
    isFinal: isFinal,
    existingSurfaces: _initialSurfaces,
    cachePrefix: cachePrefix,
  );

  void _apply(Iterable<AgentToRendererMessage> messages) {
    _touched.addAll(state.apply(messages));
  }
}

List<Map<String, Object?>> _mergeComponentLists(
  List<Map<String, Object?>> first,
  List<Map<String, Object?>> second,
) => <String, Map<String, Object?>>{
  for (final c in first) c['id']! as String: c,
  for (final c in second) c['id']! as String: c,
}.values.toList();

AgentToRendererMessage? _tryMergeComponentUpdate(
  AgentToRendererMessage prev,
  UpdateComponentsMessage msg,
) {
  if (prev is UpdateComponentsMessage && prev.surfaceId == msg.surfaceId) {
    return UpdateComponentsMessage(
      version: msg.version,
      surfaceId: msg.surfaceId,
      components: _mergeComponentLists(prev.components, msg.components),
    );
  }
  if (prev is CreateSurfaceMessage &&
      prev.surfaceId == msg.surfaceId &&
      prev.components != null) {
    return CreateSurfaceMessage(
      version: prev.version,
      surfaceId: prev.surfaceId,
      catalogId: prev.catalogId,
      components: _mergeComponentLists(prev.components!, msg.components),
      dataModel: prev.dataModel,
      theme: prev.theme,
      sendDataModel: prev.sendDataModel,
    );
  }
  return null;
}

/// Coalesces adjacent `UpdateComponentsMessage`s targeting the same surface in
/// a single emitted chunk (for example, when both `completePrefix` and
/// `healed` produce component updates in the same `feed` call).
List<AgentToRendererMessage> _mergeSameSurfaceUpdates(
  List<AgentToRendererMessage> messages,
) {
  if (messages.length <= 1) return messages;
  final merged = <AgentToRendererMessage>[];
  for (final msg in messages) {
    if (msg is UpdateComponentsMessage && merged.isNotEmpty) {
      final AgentToRendererMessage? combined = _tryMergeComponentUpdate(
        merged.last,
        msg,
      );
      if (combined != null) {
        merged[merged.length - 1] = combined;
        continue;
      }
    }
    merged.add(msg);
  }
  return merged;
}
