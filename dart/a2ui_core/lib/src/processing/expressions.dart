// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import '../primitives/errors.dart';

/// A parser for A2UI expressions, supporting string interpolation
/// and function calls.
class ExpressionParser {
  static const int maxDepth = 10;

  /// Parses an input string into a list of components (literals or
  /// [Map] representations of expressions).
  List<Object?> parse(String input, [int depth = 0]) {
    if (depth > maxDepth) {
      throw A2uiExpressionError('Max recursion depth reached in parse');
    }
    if (!input.contains('\${')) {
      return [input];
    }

    final parts = <Object?>[];
    final scanner = _Scanner(input);

    while (!scanner.isAtEnd) {
      if (scanner.matches('\${')) {
        scanner.advance(2);
        final String content = _extractInterpolationContent(scanner);
        final Object? parsed = parseExpression(content, depth + 1);
        parts.add(parsed);
      } else if (scanner.matches('\\\${')) {
        scanner.advance(1); // skip \
        final int start = scanner.pos;
        scanner.advance(2); // skip ${
        final String literal = scanner.substring(start, scanner.pos);
        if (parts.isNotEmpty && parts.last is String) {
          parts[parts.length - 1] = (parts.last as String) + literal;
        } else {
          parts.add(literal);
        }
      } else {
        final int start = scanner.pos;
        while (!scanner.isAtEnd) {
          if (scanner.matches('\${') || scanner.matches('\\\${')) {
            break;
          }
          scanner.advance();
        }
        final String literal = scanner.substring(start, scanner.pos);
        if (parts.isNotEmpty && parts.last is String) {
          parts[parts.length - 1] = (parts.last as String) + literal;
        } else {
          parts.add(literal);
        }
      }
    }
    return parts.where((p) => p != null && p != '').toList();
  }

  String _extractInterpolationContent(_Scanner scanner) {
    final int start = scanner.pos;
    var braceBalance = 1;

    while (!scanner.isAtEnd && braceBalance > 0) {
      final String char = scanner.advance();
      if (char == '{') {
        braceBalance++;
      } else if (char == '}') {
        braceBalance--;
      } else if (char == "'" || char == '"') {
        final quote = char;
        while (!scanner.isAtEnd) {
          final String c = scanner.advance();
          if (c == '\\') {
            scanner.advance();
          } else if (c == quote) {
            break;
          }
        }
      }
    }

    if (braceBalance > 0) {
      throw A2uiExpressionError("Unclosed interpolation: missing '}'");
    }

    return scanner.input.substring(start, scanner.pos - 1);
  }

  /// Parses a single expression string into its DynamicValue representation.
  Object? parseExpression(String expr, [int depth = 0]) {
    final String trimmed = expr.trim();
    if (trimmed.isEmpty) return '';

    final scanner = _Scanner(trimmed);
    final Object? result = _parseExpressionInternal(scanner, depth);
    scanner.skipWhitespace();
    if (!scanner.isAtEnd) {
      throw A2uiExpressionError(
        'Unexpected characters at end of expression: '
        "'${scanner.input.substring(scanner.pos)}'",
      );
    }
    return result;
  }

  Object? _parseExpressionInternal(_Scanner scanner, int depth) {
    scanner.skipWhitespace();
    if (scanner.isAtEnd) return '';

    // Nested interpolation
    if (scanner.matches('\${')) {
      scanner.advance(2);
      final String content = _extractInterpolationContent(scanner);
      return parseExpression(content, depth + 1);
    }

    // Literals
    if (scanner.peek() == "'" || scanner.peek() == '"') {
      return _parseStringLiteral(scanner);
    }
    if (_isDigit(scanner.peek())) {
      return _parseNumberLiteral(scanner);
    }
    if (scanner.matchesKeyword('true')) return true;
    if (scanner.matchesKeyword('false')) return false;
    if (scanner.matchesKeyword('null')) return null;

    // Identifiers (Function calls or Path starts)
    final String token = _scanPathOrIdentifier(scanner);
    scanner.skipWhitespace();

    if (scanner.peek() == '(') {
      return _parseFunctionCall(token, scanner, depth);
    } else {
      if (token.isEmpty) return '';
      return {'path': token};
    }
  }

  String _scanPathOrIdentifier(_Scanner scanner) {
    final int start = scanner.pos;
    while (!scanner.isAtEnd) {
      final String c = scanner.peek();
      if (_isAlnum(c) || c == '/' || c == '.' || c == '_' || c == '-') {
        scanner.advance();
      } else {
        break;
      }
    }
    return scanner.input.substring(start, scanner.pos);
  }

  Object? _parseFunctionCall(String funcName, _Scanner scanner, int depth) {
    scanner.match('(');
    scanner.skipWhitespace();

    final args = <String, dynamic>{};

    while (!scanner.isAtEnd && scanner.peek() != ')') {
      final String argName = _scanIdentifier(scanner);
      scanner.skipWhitespace();
      if (!scanner.match(':')) {
        throw A2uiExpressionError(
          "Expected ':' after argument name '$argName' in function '$funcName'",
        );
      }
      scanner.skipWhitespace();

      args[argName] = _parseExpressionInternal(scanner, depth);

      scanner.skipWhitespace();
      if (scanner.peek() == ',') {
        scanner.advance();
        scanner.skipWhitespace();
      }
    }

    if (!scanner.match(')')) {
      throw A2uiExpressionError(
        "Expected ')' after function arguments for '$funcName'",
      );
    }

    return {'call': funcName, 'args': args, 'returnType': 'any'};
  }

  String _scanIdentifier(_Scanner scanner) {
    final int start = scanner.pos;
    while (!scanner.isAtEnd &&
        (_isAlnum(scanner.peek()) || scanner.peek() == '_')) {
      scanner.advance();
    }
    return scanner.input.substring(start, scanner.pos);
  }

  String _parseStringLiteral(_Scanner scanner) {
    final String quote = scanner.advance();
    final result = StringBuffer();
    while (!scanner.isAtEnd) {
      final String c = scanner.advance();
      if (c == '\\') {
        final String next = scanner.advance();
        if (next == 'n') {
          result.write('\n');
        } else if (next == 't') {
          result.write('\t');
        } else if (next == 'r') {
          result.write('\r');
        } else {
          result.write(next);
        }
      } else if (c == quote) {
        break;
      } else {
        result.write(c);
      }
    }
    return result.toString();
  }

  num _parseNumberLiteral(_Scanner scanner) {
    final int start = scanner.pos;
    while (!scanner.isAtEnd &&
        (_isDigit(scanner.peek()) || scanner.peek() == '.')) {
      scanner.advance();
    }
    return num.parse(scanner.input.substring(start, scanner.pos));
  }

  bool _isAlnum(String c) {
    if (c.isEmpty) return false;
    final int u = c.codeUnitAt(0);
    return (u >= 0x30 && u <= 0x39) || // 0-9
        (u >= 0x41 && u <= 0x5A) || // A-Z
        (u >= 0x61 && u <= 0x7A); // a-z
  }

  bool _isDigit(String c) {
    if (c.isEmpty) return false;
    final int u = c.codeUnitAt(0);
    return u >= 0x30 && u <= 0x39;
  }
}

class _Scanner {
  final String input;
  int pos = 0;

  _Scanner(this.input);

  bool get isAtEnd => pos >= input.length;

  String peek([int offset = 0]) {
    if (pos + offset >= input.length) return '';
    return input[pos + offset];
  }

  String advance([int count = 1]) {
    final String result = input.substring(pos, pos + count);
    pos += count;
    return result;
  }

  bool match(String expected) {
    if (peek() == expected) {
      advance();
      return true;
    }
    return false;
  }

  bool matches(String expected) {
    return input.startsWith(expected, pos);
  }

  bool matchesKeyword(String keyword) {
    if (input.startsWith(keyword, pos)) {
      final String next = peek(keyword.length);
      if (next.isEmpty || !_isWordChar(next.codeUnitAt(0))) {
        advance(keyword.length);
        return true;
      }
    }
    return false;
  }

  void skipWhitespace() {
    while (!isAtEnd && _isWhitespace(peek().codeUnitAt(0))) {
      advance();
    }
  }

  String substring(int start, [int? end]) {
    return input.substring(start, end);
  }

  static bool _isWordChar(int u) {
    return (u >= 0x30 && u <= 0x39) || // 0-9
        (u >= 0x41 && u <= 0x5A) || // A-Z
        (u >= 0x61 && u <= 0x7A) || // a-z
        u == 0x5F; // _
  }

  static bool _isWhitespace(int u) {
    return u == 0x20 || u == 0x09 || u == 0x0A || u == 0x0D; // space/tab/LF/CR
  }
}
