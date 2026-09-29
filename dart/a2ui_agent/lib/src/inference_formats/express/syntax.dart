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

/// The Express syntax tree and the parser that builds it.
///
/// Follows `specification/inference_formats/express/Express.g4`.
library;

import 'package:a2ui_core/a2ui_core.dart';

/// An Express expression.
sealed class ExpressNode {
  const ExpressNode();
}

/// A string, number, boolean or `null`.
final class LiteralNode extends ExpressNode {
  final Object? value;

  const LiteralNode(this.value);
}

/// A data binding, `$/absolute` or `$relative`, held without the `$`.
final class PathNode extends ExpressNode {
  final String path;

  const PathNode(this.path);
}

/// A reference to a variable assigned elsewhere in the block.
final class VariableNode extends ExpressNode {
  final String name;

  const VariableNode(this.name);
}

/// The `_` placeholder for an argument left out.
final class SkippedNode extends ExpressNode {
  const SkippedNode();
}

final class ArrayNode extends ExpressNode {
  final List<ExpressNode> items;

  const ArrayNode(this.items);
}

final class MapNode extends ExpressNode {
  final Map<String, ExpressNode> entries;

  const MapNode(this.entries);
}

/// A call to a component, a catalog function or a reserved helper.
final class CallNode extends ExpressNode {
  final String name;
  final List<ExpressNode> args;
  final Map<String, ExpressNode> kwargs;

  const CallNode(this.name, this.args, this.kwargs);
}

/// A validation check, `?name` or `?name(args)`.
final class CheckNode extends ExpressNode {
  final String name;
  final List<ExpressNode> args;

  const CheckNode(this.name, this.args);
}

/// A top-level Express statement.
sealed class ExpressStatement {
  const ExpressStatement();
}

/// `target = value`, where the target is a variable or a data path.
final class AssignmentStatement extends ExpressStatement {
  /// The variable name, or the data path without its `$`.
  final String target;

  /// Whether [target] is a data path rather than a variable.
  final bool isDataPath;

  final ExpressNode value;

  const AssignmentStatement(
    this.target,
    this.value, {
    required this.isDataPath,
  });
}

/// An expression written as a statement of its own, such as `surface("s1")`.
final class ExpressionStatement extends ExpressStatement {
  final ExpressNode value;

  const ExpressionStatement(this.value);
}

/// Parses an Express block into its statements.
///
/// Throws [A2uiParseError] if [source] does not match the grammar.
List<ExpressStatement> parseExpress(String source) =>
    _Parser(source, _Lexer(source).tokenize()).program();

enum _TokenType {
  lParen('('),
  rParen(')'),
  lBracket('['),
  rBracket(']'),
  lBrace('{'),
  rBrace('}'),
  comma(','),
  colon(':'),
  equals('='),
  underscore('_'),
  nullLiteral('null'),
  string('a string'),
  number('a number'),
  boolean('a boolean'),
  path('a data path'),
  check('a check'),
  identifier('a name'),
  eof('the end of the block');

  const _TokenType(this.description);

  final String description;
}

class _Token {
  final _TokenType type;
  final String text;
  final Object? value;
  final int offset;

  const _Token(this.type, this.text, this.offset, [this.value]);
}

const Map<String, _TokenType> _punctuation = {
  '(': _TokenType.lParen,
  ')': _TokenType.rParen,
  '[': _TokenType.lBracket,
  ']': _TokenType.rBracket,
  '{': _TokenType.lBrace,
  '}': _TokenType.rBrace,
  ',': _TokenType.comma,
  ':': _TokenType.colon,
  '=': _TokenType.equals,
};

final RegExp _identifierStart = RegExp('[a-zA-Z_]');
final RegExp _identifierPart = RegExp('[a-zA-Z0-9_]');
final RegExp _pathPart = RegExp('[a-zA-Z0-9_/]');
final RegExp _digit = RegExp('[0-9]');

/// Reports a syntax error at [offset] of [source].
Never _syntaxError(String source, int offset, String message) {
  final String before = source.substring(0, offset);
  final int line = '\n'.allMatches(before).length + 1;
  final int column = offset - (before.lastIndexOf('\n') + 1) + 1;
  throw A2uiParseError(
    'Express syntax error at line $line, column $column: $message',
    rawContent: source,
  );
}

class _Lexer {
  _Lexer(this.source);

  final String source;
  int _i = 0;

  bool _at(String text, [int ahead = 0]) => source.startsWith(text, _i + ahead);

  bool _matches(RegExp pattern, int index) =>
      index < source.length && pattern.hasMatch(source[index]);

  List<_Token> tokenize() {
    final tokens = <_Token>[];
    while (_i < source.length) {
      final String c = source[_i];
      if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == ';') {
        _i++;
      } else if (c == '#' || _at('//')) {
        final int end = source.indexOf('\n', _i);
        _i = end < 0 ? source.length : end;
      } else if (_at('/*')) {
        final int end = source.indexOf('*/', _i + 2);
        if (end < 0) _syntaxError(source, _i, 'unterminated block comment.');
        _i = end + 2;
      } else if (_punctuation[c] case final _TokenType type) {
        tokens.add(_Token(type, c, _i++));
      } else if ((c == 'r' || c == 'R') && _at('"', 1)) {
        tokens.add(_rawString());
      } else if (c == '"') {
        tokens.add(_string());
      } else if (c == r'$') {
        tokens.add(_path());
      } else if (c == '?') {
        tokens.add(_check());
      } else if (c == '-' || _digit.hasMatch(c)) {
        tokens.add(_number());
      } else if (_identifierStart.hasMatch(c)) {
        tokens.add(_word());
      } else {
        _syntaxError(source, _i, "unexpected character '$c'.");
      }
    }
    tokens.add(_Token(_TokenType.eof, '', source.length));
    return tokens;
  }

  _Token _string() {
    final int start = _i;
    if (_at('"""')) {
      final int? end = _findClosing(start + 3, '"""');
      if (end != null) {
        _i = end + 3;
        final String text = source.substring(start, _i);
        return _Token(
          _TokenType.string,
          text,
          start,
          _unescape(source.substring(start + 3, end)),
        );
      }
    }
    final int? end = _findClosing(start + 1, '"');
    if (end == null) _syntaxError(source, start, 'unterminated string.');
    _i = end + 1;
    return _Token(
      _TokenType.string,
      source.substring(start, _i),
      start,
      _unescape(source.substring(start + 1, end)),
    );
  }

  /// The index of the first unescaped [delimiter] at or after [from].
  int? _findClosing(int from, String delimiter) {
    var j = from;
    while (j < source.length) {
      if (source[j] == r'\') {
        j += 2;
      } else if (source.startsWith(delimiter, j)) {
        return j;
      } else {
        j++;
      }
    }
    return null;
  }

  _Token _rawString() {
    final int start = _i;
    if (source.startsWith('"""', start + 1)) {
      final int end = source.indexOf('"""', start + 4);
      if (end < 0) _syntaxError(source, start, 'unterminated raw string.');
      _i = end + 3;
      return _Token(
        _TokenType.string,
        source.substring(start, _i),
        start,
        source.substring(start + 4, end),
      );
    }
    int j = start + 2;
    while (j < source.length && source[j] != '"') {
      if (source[j] == '\n' || source[j] == '\r') {
        _syntaxError(
          source,
          start,
          'a raw string cannot span lines; use r"""...""" instead.',
        );
      }
      j++;
    }
    if (j >= source.length) {
      _syntaxError(source, start, 'unterminated raw string.');
    }
    _i = j + 1;
    return _Token(
      _TokenType.string,
      source.substring(start, _i),
      start,
      source.substring(start + 2, j),
    );
  }

  _Token _path() {
    final int start = _i++;
    while (_matches(_pathPart, _i)) {
      _i++;
    }
    final String text = source.substring(start, _i);
    return _Token(_TokenType.path, text, start, text.substring(1));
  }

  _Token _check() {
    final int start = _i++;
    if (!_matches(_identifierStart, _i)) {
      _syntaxError(source, start, "'?' must be followed by a check name.");
    }
    while (_matches(_identifierPart, _i)) {
      _i++;
    }
    final String text = source.substring(start, _i);
    return _Token(_TokenType.check, text, start, text.substring(1));
  }

  _Token _number() {
    final int start = _i;
    if (source[_i] == '-') _i++;
    if (!_matches(_digit, _i)) {
      _syntaxError(source, start, "'-' must be followed by a number.");
    }
    while (_matches(_digit, _i)) {
      _i++;
    }
    var isDecimal = false;
    if (_at('.') && _matches(_digit, _i + 1)) {
      isDecimal = true;
      _i++;
      while (_matches(_digit, _i)) {
        _i++;
      }
    }
    final String text = source.substring(start, _i);
    return _Token(
      _TokenType.number,
      text,
      start,
      isDecimal ? double.parse(text) : int.parse(text),
    );
  }

  _Token _word() {
    final int start = _i;
    while (_matches(_identifierPart, _i)) {
      _i++;
    }
    final String text = source.substring(start, _i);
    return switch (text) {
      '_' => _Token(_TokenType.underscore, text, start),
      'null' => _Token(_TokenType.nullLiteral, text, start),
      'true' => _Token(_TokenType.boolean, text, start, true),
      'false' => _Token(_TokenType.boolean, text, start, false),
      _ => _Token(_TokenType.identifier, text, start, text),
    };
  }
}

/// Resolves `\n`, `\r`, `\t`, `\\` and `\"`, keeping any other escape as
/// written.
String _unescape(String value) => value.replaceAllMapped(
  RegExp(r'\\([\s\S])'),
  (m) => switch (m[1]) {
    'n' => '\n',
    'r' => '\r',
    't' => '\t',
    r'\' => r'\',
    '"' => '"',
    _ => m[0]!,
  },
);

class _Parser {
  _Parser(this.source, this.tokens);

  final String source;
  final List<_Token> tokens;
  int _pos = 0;

  _Token get _peek => tokens[_pos];

  _Token _peekAt(int ahead) =>
      tokens[(_pos + ahead).clamp(0, tokens.length - 1)];

  _Token _next() => tokens[_pos++];

  bool _accept(_TokenType type) {
    if (_peek.type != type) return false;
    _pos++;
    return true;
  }

  _Token _expect(_TokenType type) {
    if (_peek.type == type) return _next();
    _unexpected('expected ${type.description}');
  }

  Never _unexpected(String expectation) {
    final _Token token = _peek;
    final String found = token.type == _TokenType.eof
        ? token.type.description
        : "'${token.text}'";
    _syntaxError(source, token.offset, '$expectation, found $found.');
  }

  List<ExpressStatement> program() {
    final statements = <ExpressStatement>[];
    while (_peek.type != _TokenType.eof) {
      statements.add(_statement());
    }
    return statements;
  }

  ExpressStatement _statement() {
    final _TokenType type = _peek.type;
    if ((type == _TokenType.identifier || type == _TokenType.path) &&
        _peekAt(1).type == _TokenType.equals) {
      final _Token target = _next();
      _next();
      return AssignmentStatement(
        target.value! as String,
        _expression(),
        isDataPath: type == _TokenType.path,
      );
    }
    return ExpressionStatement(_expression());
  }

  ExpressNode _expression() {
    final _Token token = _peek;
    switch (token.type) {
      case _TokenType.lBracket:
        return ArrayNode(_list(_TokenType.lBracket, _TokenType.rBracket));
      case _TokenType.lBrace:
        return _map();
      case _TokenType.path:
        _next();
        return PathNode(token.value! as String);
      case _TokenType.check:
        _next();
        final List<ExpressNode> args = _peek.type == _TokenType.lParen
            ? _list(_TokenType.lParen, _TokenType.rParen)
            : const [];
        return CheckNode(token.value! as String, args);
      case _TokenType.identifier:
        _next();
        if (_peek.type == _TokenType.lParen) return _call(token.text);
        return VariableNode(token.text);
      case _TokenType.underscore:
        _next();
        return const SkippedNode();
      case _TokenType.string:
      case _TokenType.number:
      case _TokenType.boolean:
        _next();
        return LiteralNode(token.value);
      case _TokenType.nullLiteral:
        _next();
        return const LiteralNode(null);
      default:
        _unexpected('expected an expression');
    }
  }

  /// `open (expression (',' expression)* ','?)? close`.
  List<ExpressNode> _list(_TokenType open, _TokenType close) {
    _expect(open);
    final items = <ExpressNode>[];
    while (!_accept(close)) {
      items.add(_expression());
      if (!_accept(_TokenType.comma)) {
        _expect(close);
        break;
      }
    }
    return items;
  }

  MapNode _map() {
    _expect(_TokenType.lBrace);
    final entries = <String, ExpressNode>{};
    while (!_accept(_TokenType.rBrace)) {
      final _Token key = _peek;
      if (key.type != _TokenType.identifier && key.type != _TokenType.string) {
        _unexpected('expected a map key');
      }
      _next();
      _expect(_TokenType.colon);
      entries[key.value! as String] = _expression();
      if (!_accept(_TokenType.comma)) {
        _expect(_TokenType.rBrace);
        break;
      }
    }
    return MapNode(entries);
  }

  CallNode _call(String name) {
    _expect(_TokenType.lParen);
    final args = <ExpressNode>[];
    final kwargs = <String, ExpressNode>{};
    while (!_accept(_TokenType.rParen)) {
      if (_peek.type == _TokenType.identifier &&
          _peekAt(1).type == _TokenType.equals) {
        final _Token key = _next();
        _next();
        if (kwargs.containsKey(key.text)) {
          _syntaxError(
            source,
            key.offset,
            "argument '${key.text}' is given twice.",
          );
        }
        kwargs[key.text] = _expression();
      } else {
        args.add(_expression());
      }
      if (!_accept(_TokenType.comma)) {
        _expect(_TokenType.rParen);
        break;
      }
    }
    return CallNode(name, args, kwargs);
  }
}
