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

/// Portable A2UI regular expression subset parser, static safety guard, and
/// cached compiler.
library;

import 'dart:collection';
import 'dart:math' as math;

import 'errors.dart';

/// Maximum length of a regex pattern in Unicode code points.
const int maxRegexPatternCodePoints = 256;

/// Maximum length of an input value in Unicode code points for regex matching.
const int maxRegexValueCodePoints = 4096;

const int _maxCodePoint = 0x10FFFF;
const int _maxQuantifierBound = 256;
const int _compiledRegexCacheLimit = 256;

/// Inclusive `[lo, hi]` Unicode code-point range (`0 <= lo <= hi <= 0x10FFFF`).
class CodePointRange {
  /// Creates an inclusive [lo]..[hi] code-point range.
  const CodePointRange(this.lo, this.hi);

  /// Lower bound code point (inclusive).
  final int lo;

  /// Upper bound code point (inclusive).
  final int hi;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CodePointRange && other.lo == lo && other.hi == hi;

  @override
  int get hashCode => Object.hash(lo, hi);

  @override
  String toString() => 'CodePointRange($lo, $hi)';
}

/// Zero-width anchor kinds supported by the A2UI regex subset.
enum AnchorKind {
  /// Start of input (`^`).
  caret('^'),

  /// End of input (`$`).
  dollar(r'$'),

  /// ASCII word boundary (`\b`).
  wordBoundary(r'\b'),

  /// ASCII non-word boundary (`\B`).
  nonWordBoundary(r'\B');

  const AnchorKind(this.syntax);

  /// The source syntax token for this anchor.
  final String syntax;
}

/// AST node produced by [parseRegexSubset].
sealed class RegexNode {
  const RegexNode();
}

/// An empty sub-expression matching the zero-length string.
final class EmptyRegexNode extends RegexNode {
  /// Creates an [EmptyRegexNode].
  const EmptyRegexNode();
}

/// A set of Unicode code points represented as sorted, merged ranges.
final class CharSetRegexNode extends RegexNode {
  /// Creates a [CharSetRegexNode] with normalized [ranges].
  CharSetRegexNode(List<CodePointRange> ranges)
      : ranges = List<CodePointRange>.unmodifiable(ranges);

  /// Sorted, non-overlapping code-point ranges.
  final List<CodePointRange> ranges;
}

/// A capturing or non-capturing group (`(...)` or `(?:...)`).
final class GroupRegexNode extends RegexNode {
  /// Creates a [GroupRegexNode].
  const GroupRegexNode({required this.capturing, required this.body});

  /// Whether the group captures (`(...)` vs `(?:...)`).
  final bool capturing;

  /// The inner expression.
  final RegexNode body;
}

/// A positive or negative lookahead assertion (`(?=...)` or `(?!...)`).
final class LookaheadRegexNode extends RegexNode {
  /// Creates a [LookaheadRegexNode].
  const LookaheadRegexNode({required this.positive, required this.body});

  /// `true` for `(?=...)`, `false` for `(?!...)`.
  final bool positive;

  /// The inner assertion expression.
  final RegexNode body;
}

/// A zero-width anchor (`^`, `$`, `\b`, `\B`).
final class AnchorRegexNode extends RegexNode {
  /// Creates an [AnchorRegexNode].
  const AnchorRegexNode(this.anchor);

  /// Which anchor this node represents.
  final AnchorKind anchor;
}

/// A sequence of concatenated regex nodes.
final class ConcatRegexNode extends RegexNode {
  /// Creates a [ConcatRegexNode].
  ConcatRegexNode(List<RegexNode> items)
      : items = List<RegexNode>.unmodifiable(items);

  /// The concatenated items in order.
  final List<RegexNode> items;
}

/// An alternation of two or more branches (`a|b`).
final class AltRegexNode extends RegexNode {
  /// Creates an [AltRegexNode].
  AltRegexNode(List<RegexNode> branches)
      : branches = List<RegexNode>.unmodifiable(branches);

  /// The branches of the alternation.
  final List<RegexNode> branches;
}

/// A quantified atom (`*`, `+`, `?`, `{m}`, `{m,}`, `{m,n}`).
final class RepeatRegexNode extends RegexNode {
  /// Creates a [RepeatRegexNode]. An unbounded upper limit is represented by
  /// `max == null`.
  const RepeatRegexNode({
    required this.body,
    required this.min,
    required this.max,
    required this.lazy,
  });

  /// The quantified atom.
  final RegexNode body;

  /// Minimum repetition count (`0 <= min <= 256`).
  final int min;

  /// Maximum repetition count (`min <= max <= 256`), or `null` when unbounded.
  final int? max;

  /// Whether the quantifier is lazy (`*?`, `+?`, `??`, `{m,n}?`).
  final bool lazy;
}

/// Machine-readable reason token for a rejected regex pattern.
enum RegexRejection {
  /// Pattern exceeds [maxRegexPatternCodePoints] Unicode code points.
  patternTooLong('PATTERN_TOO_LONG'),

  /// Pattern uses syntax outside the portable A2UI regex subset.
  unsupportedSyntax('UNSUPPORTED_SYNTAX'),

  /// Pattern contains a quantifier nested inside another quantifier (Rule 2).
  nestedQuantifier('NESTED_QUANTIFIER'),

  /// Pattern contains an overlapping alternation inside a repetition (Rule 3).
  overlappingAlternation('OVERLAPPING_ALTERNATION'),

  /// Pattern contains adjacent unbounded quantifiers that overlap (Rule 4).
  adjacentOverlap('ADJACENT_OVERLAP');

  const RegexRejection(this.wireValue);

  /// The wire/diagnostic token string.
  final String wireValue;
}

/// Outcome of [analyzeRegex].
final class RegexAnalysisResult {
  /// Creates a successful [RegexAnalysisResult].
  const RegexAnalysisResult.ok(RegexNode this.ast)
      : ok = true,
        reason = null,
        detail = null;

  /// Creates a rejected [RegexAnalysisResult].
  const RegexAnalysisResult.rejected(this.reason, [this.detail])
      : ok = false,
        ast = null;

  /// Whether the pattern passed both syntax and static safety checks.
  final bool ok;

  /// Parsed AST when [ok] is `true`.
  final RegexNode? ast;

  /// Rejection token when [ok] is `false`.
  final RegexRejection? reason;

  /// Human-readable detail when [ok] is `false`.
  final String? detail;
}

/// Thrown by [parseRegexSubset] when a pattern violates the portable grammar.
class RegexSyntaxError implements Exception {
  /// Creates a [RegexSyntaxError] at code-point [offset].
  const RegexSyntaxError(this.message, this.offset);

  /// Description of the syntax violation.
  final String message;

  /// Code-point index where the violation occurred.
  final int offset;

  @override
  String toString() => 'RegexSyntaxError at $offset: $message';
}

// ---------------------------------------------------------------------------
// Character set operations
// ---------------------------------------------------------------------------

List<CodePointRange> _normalizeRanges(Iterable<CodePointRange> ranges) {
  final nonEmpty = <CodePointRange>[
    for (final r in ranges)
      if (r.lo <= r.hi)
        CodePointRange(
          math.max(0, r.lo),
          math.min(_maxCodePoint, r.hi),
        ),
  ];
  if (nonEmpty.isEmpty) return const <CodePointRange>[];
  nonEmpty.sort(
      (a, b) => a.lo != b.lo ? a.lo.compareTo(b.lo) : a.hi.compareTo(b.hi));
  final out = <CodePointRange>[nonEmpty.first];
  for (var i = 1; i < nonEmpty.length; i++) {
    final CodePointRange cur = nonEmpty[i];
    final CodePointRange last = out.last;
    if (cur.lo <= last.hi + 1) {
      if (cur.hi > last.hi) {
        out[out.length - 1] = CodePointRange(last.lo, cur.hi);
      }
    } else {
      out.add(cur);
    }
  }
  return out;
}

List<CodePointRange> _complementRanges(List<CodePointRange> ranges) {
  final List<CodePointRange> norm = _normalizeRanges(ranges);
  final out = <CodePointRange>[];
  var cursor = 0;
  for (final r in norm) {
    if (r.lo > cursor) {
      out.add(CodePointRange(cursor, r.lo - 1));
    }
    cursor = r.hi + 1;
    if (cursor > _maxCodePoint) break;
  }
  if (cursor <= _maxCodePoint) {
    out.add(CodePointRange(cursor, _maxCodePoint));
  }
  return out;
}

List<CodePointRange> _unionRanges(
  List<CodePointRange> a,
  List<CodePointRange> b,
) {
  if (a.isEmpty) return b;
  if (b.isEmpty) return a;
  return _normalizeRanges(<CodePointRange>[...a, ...b]);
}

bool _rangesIntersect(List<CodePointRange> a, List<CodePointRange> b) {
  var i = 0;
  var j = 0;
  while (i < a.length && j < b.length) {
    final CodePointRange ra = a[i];
    final CodePointRange rb = b[j];
    if (ra.lo <= rb.hi && rb.lo <= ra.hi) return true;
    if (ra.hi < rb.hi) {
      i++;
    } else {
      j++;
    }
  }
  return false;
}

final List<CodePointRange> _digitRanges = _normalizeRanges(const [
  CodePointRange(0x30, 0x39),
]);

final List<CodePointRange> _nonDigitRanges = _complementRanges(_digitRanges);

final List<CodePointRange> _wordRanges = _normalizeRanges(const [
  CodePointRange(0x30, 0x39),
  CodePointRange(0x41, 0x5A),
  CodePointRange(0x5F, 0x5F),
  CodePointRange(0x61, 0x7A),
]);

final List<CodePointRange> _nonWordRanges = _complementRanges(_wordRanges);

final List<CodePointRange> _spaceRanges = _normalizeRanges(const [
  CodePointRange(0x09, 0x0D),
  CodePointRange(0x20, 0x20),
]);

final List<CodePointRange> _nonSpaceRanges = _complementRanges(_spaceRanges);

final List<CodePointRange> _dotRanges = _normalizeRanges(const [
  CodePointRange(0x00, 0x09),
  CodePointRange(0x0B, 0x0C),
  CodePointRange(0x0E, _maxCodePoint),
]);

// ---------------------------------------------------------------------------
// Recursive-descent parser
// ---------------------------------------------------------------------------

/// Counts the number of Unicode code points in [input].
int countCodePoints(String input) => input.runes.length;

bool _isHexDigit(String ch) {
  final int cp = ch.codeUnitAt(0);
  return (cp >= 0x30 && cp <= 0x39) ||
      (cp >= 0x41 && cp <= 0x46) ||
      (cp >= 0x61 && cp <= 0x66);
}

bool _isAsciiDigit(String ch) {
  final int cp = ch.codeUnitAt(0);
  return cp >= 0x30 && cp <= 0x39;
}

const Set<String> _syntaxEscapeChars = <String>{
  '^',
  r'$',
  r'\',
  '.',
  '*',
  '+',
  '?',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '|',
  '/',
  '-',
};

const Map<String, int> _controlEscapes = <String, int>{
  't': 0x09,
  'n': 0x0A,
  'r': 0x0D,
  'f': 0x0C,
  'v': 0x0B,
};

final Map<String, List<CodePointRange>> _charClassEscapes =
    <String, List<CodePointRange>>{
  'd': _digitRanges,
  'D': _nonDigitRanges,
  'w': _wordRanges,
  'W': _nonWordRanges,
  's': _spaceRanges,
  'S': _nonSpaceRanges,
};

class _Parser {
  _Parser(List<int> runes)
      : _cps = <String>[for (final int r in runes) String.fromCharCode(r)];

  final List<String> _cps;
  int _pos = 0;

  bool get atEnd => _pos >= _cps.length;

  int get pos => _pos;

  String? peek([int offset = 0]) {
    final int idx = _pos + offset;
    return idx >= 0 && idx < _cps.length ? _cps[idx] : null;
  }

  String next() {
    if (_pos >= _cps.length) {
      throw RegexSyntaxError('Unexpected end of pattern', _pos);
    }
    return _cps[_pos++];
  }

  RegexNode parsePattern() {
    final RegexNode node = _parseAlternation();
    if (!atEnd) {
      throw RegexSyntaxError("Unexpected token '${peek()}'", _pos);
    }
    return node;
  }

  RegexNode _parseAlternation() {
    final branches = <RegexNode>[_parseConcat()];
    while (peek() == '|') {
      next();
      branches.add(_parseConcat());
    }
    return branches.length == 1 ? branches.first : AltRegexNode(branches);
  }

  RegexNode _parseConcat() {
    final items = <RegexNode>[];
    while (!atEnd) {
      final String? ch = peek();
      if (ch == '|' || ch == ')') break;
      items.add(_parseQuantified());
    }
    if (items.isEmpty) return const EmptyRegexNode();
    if (items.length == 1) return items.first;
    return ConcatRegexNode(items);
  }

  RegexNode _parseQuantified() {
    final RegexNode atom = _parseAtom();
    final String? ch = peek();
    if (ch == '*' || ch == '+' || ch == '?' || ch == '{') {
      if (atom is AnchorRegexNode || atom is LookaheadRegexNode) {
        throw RegexSyntaxError(
          'Zero-width assertion cannot be quantified',
          _pos,
        );
      }
      final (:int min, :int? max) = _parseQuantifierBounds();
      var lazy = false;
      if (peek() == '?') {
        next();
        lazy = true;
      }
      final String? after = peek();
      if (after == '*' || after == '+' || after == '?' || after == '{') {
        throw RegexSyntaxError(
          'Possessive or chained quantifiers are not supported',
          _pos,
        );
      }
      return RepeatRegexNode(body: atom, min: min, max: max, lazy: lazy);
    }
    return atom;
  }

  ({int min, int? max}) _parseQuantifierBounds() {
    final String ch = next();
    if (ch == '*') return (min: 0, max: null);
    if (ch == '+') return (min: 1, max: null);
    if (ch == '?') return (min: 0, max: 1);

    final int startOffset = _pos - 1;
    final int? min = _readDecimal();
    if (min == null) {
      throw RegexSyntaxError(
        "Malformed quantifier: expected digits after '{'",
        startOffset,
      );
    }
    int? max = min;
    if (peek() == ',') {
      next();
      if (peek() == '}') {
        max = null;
      } else {
        final int? parsedMax = _readDecimal();
        if (parsedMax == null) {
          throw RegexSyntaxError(
            "Malformed quantifier: expected digits or '}' after ','",
            startOffset,
          );
        }
        max = parsedMax;
      }
    }
    if (peek() != '}') {
      throw RegexSyntaxError(
        "Unclosed or malformed '{m,n}' quantifier",
        startOffset,
      );
    }
    next();
    if (min > _maxQuantifierBound) {
      throw RegexSyntaxError(
        'Quantifier lower bound $min exceeds $_maxQuantifierBound',
        startOffset,
      );
    }
    if (max != null) {
      if (max > _maxQuantifierBound) {
        throw RegexSyntaxError(
          'Quantifier upper bound $max exceeds $_maxQuantifierBound',
          startOffset,
        );
      }
      if (max < min) {
        throw RegexSyntaxError(
          'Quantifier range {$min,$max} is out of order',
          startOffset,
        );
      }
    }
    return (min: min, max: max);
  }

  int? _readDecimal() {
    final int start = _pos;
    var value = 0;
    while (!atEnd && _isAsciiDigit(peek()!)) {
      final int digit = next().codeUnitAt(0) - 0x30;
      value = value * 10 + digit;
      if (value > 0x7FFFFFFF) {
        throw RegexSyntaxError('Quantifier bound overflow', start);
      }
    }
    return _pos == start ? null : value;
  }

  RegexNode _parseAtom() {
    final String? ch = peek();
    if (ch == null) {
      throw RegexSyntaxError('Unexpected end of pattern', _pos);
    }
    switch (ch) {
      case '^':
        next();
        return const AnchorRegexNode(AnchorKind.caret);
      case r'$':
        next();
        return const AnchorRegexNode(AnchorKind.dollar);
      case '.':
        next();
        return CharSetRegexNode(_dotRanges);
      case '(':
        return _parseGroup();
      case '[':
        return _parseCharClass();
      case r'\':
        return _parseAtomEscape();
      case '*':
      case '+':
      case '?':
      case '{':
        throw RegexSyntaxError(
          "Unexpected quantifier '$ch' without preceding atom",
          _pos,
        );
      case '}':
        throw RegexSyntaxError(
          "Unescaped '}' outside quantifier; escape as '\\}'",
          _pos,
        );
      case ']':
        throw RegexSyntaxError(
          "Unescaped ']' outside character class; escape as '\\]'",
          _pos,
        );
      case ')':
        throw RegexSyntaxError("Unmatched ')'", _pos);
      default:
        next();
        final int cp = ch.runes.first;
        return CharSetRegexNode(<CodePointRange>[CodePointRange(cp, cp)]);
    }
  }

  RegexNode _parseGroup() {
    final int startOffset = _pos;
    next(); // consume '('
    if (peek() == '?') {
      next(); // consume '?'
      final String? mod = peek();
      if (mod == ':') {
        next();
        final RegexNode body = _parseAlternation();
        if (peek() != ')') {
          throw RegexSyntaxError("Unclosed group '('", startOffset);
        }
        next();
        return GroupRegexNode(capturing: false, body: body);
      }
      if (mod == '=' || mod == '!') {
        next();
        final RegexNode body = _parseAlternation();
        if (peek() != ')') {
          throw RegexSyntaxError("Unclosed lookahead '('", startOffset);
        }
        next();
        return LookaheadRegexNode(positive: mod == '=', body: body);
      }
      throw RegexSyntaxError(
        "Unsupported group construct '(?${mod ?? ''}'",
        startOffset,
      );
    }
    final RegexNode body = _parseAlternation();
    if (peek() != ')') {
      throw RegexSyntaxError("Unclosed group '('", startOffset);
    }
    next();
    return GroupRegexNode(capturing: true, body: body);
  }

  RegexNode _parseAtomEscape() {
    final int escStart = _pos;
    next(); // consume '\'
    if (atEnd) {
      throw RegexSyntaxError(r"Trailing '\' at end of pattern", escStart);
    }
    final String ch = next();
    if (ch == 'b') return const AnchorRegexNode(AnchorKind.wordBoundary);
    if (ch == 'B') return const AnchorRegexNode(AnchorKind.nonWordBoundary);

    final List<CodePointRange>? classRanges = _charClassEscapes[ch];
    if (classRanges != null) {
      return CharSetRegexNode(classRanges);
    }

    final int? cp = _parseScalarEscape(ch, escStart);
    if (cp != null) {
      return CharSetRegexNode(<CodePointRange>[CodePointRange(cp, cp)]);
    }

    throw RegexSyntaxError(
      "Unsupported escape sequence '\\$ch'",
      escStart,
    );
  }

  int? _parseScalarEscape(String ch, int escStart) {
    final int? ctrl = _controlEscapes[ch];
    if (ctrl != null) return ctrl;
    if (_syntaxEscapeChars.contains(ch)) return ch.runes.first;
    if (ch == 'x') return _readFixedHex(2, escStart, r'\xHH');
    if (ch == 'u') {
      if (peek() == '{') {
        next(); // consume '{'
        var hex = '';
        while (!atEnd && peek() != '}') {
          final String hc = next();
          if (!_isHexDigit(hc)) {
            throw RegexSyntaxError(
              r"Invalid hex digit in '\u{...}' escape",
              escStart,
            );
          }
          hex += hc;
          if (hex.length > 6) {
            throw RegexSyntaxError(
              r"Too many hex digits in '\u{...}' escape",
              escStart,
            );
          }
        }
        if (peek() != '}' || hex.isEmpty) {
          throw RegexSyntaxError(
            r"Malformed '\u{...}' Unicode escape",
            escStart,
          );
        }
        next(); // consume '}'
        final int cp = int.parse(hex, radix: 16);
        if (cp > _maxCodePoint || (cp >= 0xD800 && cp <= 0xDFFF)) {
          throw RegexSyntaxError(
            'Unicode escape out of scalar range: 0x${cp.toRadixString(16)}',
            escStart,
          );
        }
        return cp;
      }
      final int cp = _readFixedHex(4, escStart, r'\uHHHH');
      if (cp >= 0xD800 && cp <= 0xDFFF) {
        throw RegexSyntaxError(
          r'Lone surrogate code point in \uHHHH escape is not supported',
          escStart,
        );
      }
      return cp;
    }
    return null;
  }

  int _readFixedHex(int digits, int escStart, String label) {
    var hex = '';
    for (var i = 0; i < digits; i++) {
      final String? c = peek();
      if (c == null || !_isHexDigit(c)) {
        throw RegexSyntaxError("Malformed '$label' escape", escStart);
      }
      hex += next();
    }
    return int.parse(hex, radix: 16);
  }

  RegexNode _parseCharClass() {
    final int startOffset = _pos;
    next(); // consume '['
    var negated = false;
    if (peek() == '^') {
      next();
      negated = true;
    }
    if (peek() == ']') {
      throw RegexSyntaxError(
          'Empty character class is not allowed', startOffset);
    }

    final ranges = <CodePointRange>[];

    while (!atEnd && peek() != ']') {
      if (peek() == '[' &&
          (peek(1) == ':' || peek(1) == '.' || peek(1) == '=')) {
        throw RegexSyntaxError(
          'POSIX character classes are not supported',
          _pos,
        );
      }
      final ({
        bool isSet,
        int? cp,
        List<CodePointRange>? setRanges,
        int offset
      }) left = _parseClassAtom();

      if (peek() == '-' && peek(1) != ']') {
        final int dashOffset = _pos;
        next(); // consume '-'
        if (peek() == '-') {
          throw RegexSyntaxError(
            'Character class subtraction is not supported',
            dashOffset,
          );
        }
        if (atEnd) {
          throw RegexSyntaxError("Unclosed character class '['", startOffset);
        }
        final ({
          bool isSet,
          int? cp,
          List<CodePointRange>? setRanges,
          int offset,
        }) right = _parseClassAtom();
        if (left.isSet || right.isSet) {
          throw RegexSyntaxError(
            'Character class range endpoint cannot be a multi-character '
            'shorthand',
            dashOffset,
          );
        }
        if (left.cp! > right.cp!) {
          throw RegexSyntaxError(
            'Character class range out of order (${left.cp} > ${right.cp})',
            dashOffset,
          );
        }
        ranges.add(CodePointRange(left.cp!, right.cp!));
      } else if (left.isSet) {
        ranges.addAll(left.setRanges!);
      } else {
        ranges.add(CodePointRange(left.cp!, left.cp!));
      }
    }

    if (peek() != ']') {
      throw RegexSyntaxError("Unclosed character class '['", startOffset);
    }
    next(); // consume ']'

    final List<CodePointRange> normalized =
        negated ? _complementRanges(ranges) : _normalizeRanges(ranges);
    return CharSetRegexNode(normalized);
  }

  ({bool isSet, int? cp, List<CodePointRange>? setRanges, int offset})
      _parseClassAtom() {
    final int atomOffset = _pos;
    final String ch = next();
    if (ch == '[') {
      throw RegexSyntaxError(
        "Unescaped '[' inside character class is not supported",
        atomOffset,
      );
    }
    if (ch == '&' && peek() == '&') {
      throw RegexSyntaxError(
        'Character class intersection is not supported',
        atomOffset,
      );
    }
    if (ch == r'\') {
      if (atEnd) {
        throw RegexSyntaxError(
          r"Trailing '\' inside character class",
          atomOffset,
        );
      }
      final String esc = next();
      final List<CodePointRange>? classRanges = _charClassEscapes[esc];
      if (classRanges != null) {
        return (
          isSet: true,
          cp: null,
          setRanges: classRanges,
          offset: atomOffset,
        );
      }
      final int? cp = _parseScalarEscape(esc, atomOffset);
      if (cp != null) {
        return (isSet: false, cp: cp, setRanges: null, offset: atomOffset);
      }
      throw RegexSyntaxError(
        "Unsupported escape '\\$esc' inside character class",
        atomOffset,
      );
    }
    return (
      isSet: false,
      cp: ch.runes.first,
      setRanges: null,
      offset: atomOffset,
    );
  }
}

/// Parses [pattern] under the portable A2UI regex subset grammar.
///
/// Throws [RegexSyntaxError] if [pattern] contains any construct outside the
/// portable subset.
RegexNode parseRegexSubset(String pattern) {
  final parser = _Parser(pattern.runes.toList());
  return parser.parsePattern();
}

// ---------------------------------------------------------------------------
// Static safety guard (Rules 1-4)
// ---------------------------------------------------------------------------

/// Returns whether [node] can match the empty string (`""`).
bool isNullable(RegexNode node) => switch (node) {
      EmptyRegexNode() || AnchorRegexNode() || LookaheadRegexNode() => true,
      CharSetRegexNode() => false,
      GroupRegexNode(:final body) => isNullable(body),
      ConcatRegexNode(:final items) => items.every(isNullable),
      AltRegexNode(:final branches) => branches.any(isNullable),
      RepeatRegexNode(:final min, :final body) => min == 0 || isNullable(body),
    };

/// Returns the union of code points that can appear as the first consumed
/// character of a non-empty match of [node].
List<CodePointRange> firstSet(RegexNode node) => switch (node) {
      EmptyRegexNode() ||
      AnchorRegexNode() ||
      LookaheadRegexNode() =>
        const <CodePointRange>[],
      CharSetRegexNode(:final ranges) => ranges,
      GroupRegexNode(:final body) => firstSet(body),
      AltRegexNode(:final branches) => branches.fold<List<CodePointRange>>(
          const <CodePointRange>[],
          (acc, branch) => _unionRanges(acc, firstSet(branch)),
        ),
      RepeatRegexNode(:final max, :final body) =>
        max == 0 ? const <CodePointRange>[] : firstSet(body),
      ConcatRegexNode(:final items) => _concatFirstSet(items),
    };

List<CodePointRange> _concatFirstSet(List<RegexNode> items) {
  var acc = const <CodePointRange>[];
  for (final item in items) {
    acc = _unionRanges(acc, firstSet(item));
    if (!isNullable(item)) break;
  }
  return acc;
}

/// Returns the union of all code points consumed anywhere inside [node]
/// (ignoring lookahead assertions).
List<CodePointRange> charsSet(RegexNode node) => switch (node) {
      EmptyRegexNode() ||
      AnchorRegexNode() ||
      LookaheadRegexNode() =>
        const <CodePointRange>[],
      CharSetRegexNode(:final ranges) => ranges,
      GroupRegexNode(:final body) => charsSet(body),
      ConcatRegexNode(:final items) => items.fold<List<CodePointRange>>(
          const <CodePointRange>[],
          (acc, item) => _unionRanges(acc, charsSet(item)),
        ),
      AltRegexNode(:final branches) => branches.fold<List<CodePointRange>>(
          const <CodePointRange>[],
          (acc, branch) => _unionRanges(acc, charsSet(branch)),
        ),
      RepeatRegexNode(:final max, :final body) =>
        max == 0 ? const <CodePointRange>[] : charsSet(body),
    };

bool _isRepeatingQuantifier(RepeatRegexNode node) =>
    node.max == null || node.max! > 1;

bool _hasUnbounded(RegexNode node) => switch (node) {
      EmptyRegexNode() || CharSetRegexNode() || AnchorRegexNode() => false,
      GroupRegexNode(:final body) ||
      LookaheadRegexNode(:final body) =>
        _hasUnbounded(body),
      ConcatRegexNode(:final items) => items.any(_hasUnbounded),
      AltRegexNode(:final branches) => branches.any(_hasUnbounded),
      RepeatRegexNode(:final max, :final body) =>
        max == null || _hasUnbounded(body),
    };

bool _hasNestedQuantifier(RegexNode node) => switch (node) {
      EmptyRegexNode() || CharSetRegexNode() || AnchorRegexNode() => false,
      GroupRegexNode(:final body) ||
      LookaheadRegexNode(:final body) =>
        _hasNestedQuantifier(body),
      ConcatRegexNode(:final items) => items.any(_hasNestedQuantifier),
      AltRegexNode(:final branches) => branches.any(_hasNestedQuantifier),
      RepeatRegexNode(:final body) =>
        (_isRepeatingQuantifier(node) && _hasUnbounded(body)) ||
            _hasNestedQuantifier(body),
    };

void _collectAltBranches(RegexNode node, List<RegexNode> out) {
  switch (node) {
    case AltRegexNode(:final branches):
      for (final b in branches) {
        _collectAltBranches(b, out);
      }
    case GroupRegexNode(:final body):
      _collectAltBranches(body, out);
    default:
      out.add(node);
  }
}

bool _altHasOverlappingBranches(AltRegexNode alt) {
  final branches = <RegexNode>[];
  _collectAltBranches(alt, branches);
  for (var i = 0; i < branches.length; i++) {
    final List<CodePointRange> fi = firstSet(branches[i]);
    for (int j = i + 1; j < branches.length; j++) {
      final List<CodePointRange> fj = firstSet(branches[j]);
      if (_rangesIntersect(fi, fj)) return true;
    }
  }
  return false;
}

bool _containsOverlappingAlt(RegexNode node) => switch (node) {
      EmptyRegexNode() || CharSetRegexNode() || AnchorRegexNode() => false,
      LookaheadRegexNode() => false,
      GroupRegexNode(:final body) => _containsOverlappingAlt(body),
      ConcatRegexNode(:final items) => items.any(_containsOverlappingAlt),
      AltRegexNode(:final branches) => _altHasOverlappingBranches(node) ||
          branches.any(_containsOverlappingAlt),
      RepeatRegexNode(:final body) => _containsOverlappingAlt(body),
    };

bool _hasOverlappingAlternationInRepeat(RegexNode node) => switch (node) {
      EmptyRegexNode() || CharSetRegexNode() || AnchorRegexNode() => false,
      GroupRegexNode(:final body) ||
      LookaheadRegexNode(:final body) =>
        _hasOverlappingAlternationInRepeat(body),
      ConcatRegexNode(:final items) =>
        items.any(_hasOverlappingAlternationInRepeat),
      AltRegexNode(:final branches) =>
        branches.any(_hasOverlappingAlternationInRepeat),
      RepeatRegexNode(:final body) =>
        (_isRepeatingQuantifier(node) && _containsOverlappingAlt(body)) ||
            _hasOverlappingAlternationInRepeat(body),
    };

void _flattenConcat(RegexNode node, List<RegexNode> out) {
  switch (node) {
    case ConcatRegexNode(:final items):
      for (final item in items) {
        _flattenConcat(item, out);
      }
    case GroupRegexNode(:final body):
      _flattenConcat(body, out);
    default:
      out.add(node);
  }
}

RegexNode _unwrapSingle(RegexNode node) {
  var cur = node;
  while (cur is GroupRegexNode) {
    cur = cur.body;
  }
  return cur;
}

bool _concatHasAdjacentOverlap(ConcatRegexNode concat) {
  final items = <RegexNode>[];
  _flattenConcat(concat, items);
  for (var i = 0; i < items.length; i++) {
    final RegexNode ux = _unwrapSingle(items[i]);
    if (ux is! RepeatRegexNode || ux.max != null) continue;
    final List<CodePointRange> cx = charsSet(ux.body);
    for (int j = i + 1; j < items.length; j++) {
      final RegexNode uy = _unwrapSingle(items[j]);
      if (uy is RepeatRegexNode && uy.max == null) {
        final List<CodePointRange> cy = charsSet(uy.body);
        if (_rangesIntersect(cx, cy)) return true;
      }
      if (!isNullable(items[j])) break;
    }
  }
  return false;
}

bool _hasAdjacentOverlap(RegexNode node) => switch (node) {
      EmptyRegexNode() || CharSetRegexNode() || AnchorRegexNode() => false,
      GroupRegexNode(:final body) ||
      LookaheadRegexNode(:final body) ||
      RepeatRegexNode(:final body) =>
        _hasAdjacentOverlap(body),
      AltRegexNode(:final branches) => branches.any(_hasAdjacentOverlap),
      ConcatRegexNode(:final items) =>
        _concatHasAdjacentOverlap(node) || items.any(_hasAdjacentOverlap),
    };

/// Checks the four static safety rules against [pattern] and its parsed [tree].
///
/// Returns `null` when the pattern is safe, or the [RegexRejection] reason
/// token when rejected.
RegexRejection? checkRegexSafety(String pattern, RegexNode tree) {
  if (countCodePoints(pattern) > maxRegexPatternCodePoints) {
    return RegexRejection.patternTooLong;
  }
  if (_hasNestedQuantifier(tree)) {
    return RegexRejection.nestedQuantifier;
  }
  if (_hasOverlappingAlternationInRepeat(tree)) {
    return RegexRejection.overlappingAlternation;
  }
  if (_hasAdjacentOverlap(tree)) {
    return RegexRejection.adjacentOverlap;
  }
  return null;
}

/// Validates [pattern] against both the portable grammar and the static safety
/// guard.
RegexAnalysisResult analyzeRegex(String pattern) {
  if (countCodePoints(pattern) > maxRegexPatternCodePoints) {
    return RegexAnalysisResult.rejected(
      RegexRejection.patternTooLong,
      'Pattern length (${countCodePoints(pattern)} code points) exceeds '
      'maximum of $maxRegexPatternCodePoints',
    );
  }
  final RegexNode ast;
  try {
    ast = parseRegexSubset(pattern);
  } on RegexSyntaxError catch (err) {
    return RegexAnalysisResult.rejected(
      RegexRejection.unsupportedSyntax,
      err.message,
    );
  }
  final RegexRejection? rejection = checkRegexSafety(pattern, ast);
  if (rejection != null) {
    return RegexAnalysisResult.rejected(rejection);
  }
  return RegexAnalysisResult.ok(ast);
}

// ---------------------------------------------------------------------------
// Guarded compiler + LRU cache
// ---------------------------------------------------------------------------

final LinkedHashMap<String, RegExp> _compiledRegexCache =
    LinkedHashMap<String, RegExp>();

/// Validates [pattern] against the A2UI portable regex subset and static
/// safety guard, then compiles it as a Unicode-mode [RegExp].
///
/// Successful compilations are cached in a 256-entry LRU cache. Throws
/// [A2uiExpressionError] whose message includes the rejection reason token if
/// the pattern is rejected.
RegExp compileGuarded(String pattern) {
  final RegExp? cached = _compiledRegexCache.remove(pattern);
  if (cached != null) {
    _compiledRegexCache[pattern] = cached;
    return cached;
  }

  final RegexAnalysisResult res = analyzeRegex(pattern);
  if (!res.ok) {
    final String token = res.reason!.wireValue;
    final detail = res.detail != null ? ': ${res.detail}' : '';
    throw A2uiExpressionError(
      'Invalid or unsafe regex pattern [$token]$detail',
      expression: 'regex',
      details: res.detail ?? token,
    );
  }

  final RegExp re;
  try {
    re = RegExp(pattern, unicode: true);
  } on FormatException catch (e) {
    throw A2uiExpressionError(
      'Invalid or unsafe regex pattern [UNSUPPORTED_SYNTAX]: ${e.message}',
      expression: 'regex',
      details: e.message,
    );
  }

  if (_compiledRegexCache.length >= _compiledRegexCacheLimit) {
    _compiledRegexCache.remove(_compiledRegexCache.keys.first);
  }
  _compiledRegexCache[pattern] = re;
  return re;
}
