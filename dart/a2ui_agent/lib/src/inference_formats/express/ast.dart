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

/// The Express syntax tree, read from the parse tree of the lexer and parser
/// that ANTLR generates from
/// `specification/inference_formats/express/Express.g4`.
///
/// After changing the grammar, regenerate them with
/// `dart run tool/generate_express_parser.dart`.
library;

import 'package:a2ui_core/a2ui_core.dart';
import 'package:antlr4/antlr4.dart'
    show
        BaseErrorListener,
        CommonTokenStream,
        InputStream,
        ParseTree,
        RecognitionException,
        Recognizer,
        TerminalNode,
        Token;

import 'generated/express_lexer.dart';
import 'generated/express_parser.dart';

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

const String _identStart = r'a-zA-Z_';
const String _identChars = r'a-zA-Z0-9_';
const String _identifier = '[$_identStart][$_identChars]*';

final RegExp _sqlCommentOrToken = RegExp(
  r'([rR]"""[\s\S]*?"""|[rR]"[^\r\n"]*"|"""(?:\\[\s\S]|[^\\])*?"""|"(?:\\[\s\S]|[^\\])*?"|(?:#|//)[^\r\n]*|/\*[\s\S]*?\*/)|--([^\r\n]*)',
);
final RegExp _declaredLhs = RegExp(
  r'^[ \t]*(' + _identifier + r')[ \t]*=(?!=)',
  multiLine: true,
);
final RegExp _splitLhsIdentifier = RegExp(
  r'^([ \t]*' +
      _identifier +
      r')[ \t]*(\r?\n)[ \t]*([' +
      _identChars +
      r']+)(?=[ \t]*=(?!=))',
  multiLine: true,
);
final RegExp _splitDataPath = RegExp(
  r'(\$[' + _identChars + r'/]*/)[ \t]*(\r?\n)[ \t]*([' + _identChars + r'/]+)',
);
final RegExp _identOnly = RegExp(r'^' + _identifier + r'$');
final RegExp _assignEquals = RegExp(r'^[ \t]*=(?!=)');
final RegExp _splitArgIdentifier = RegExp(
  r'([(\[,:=][ \t]*\r?\n?[ \t]*|[(\[,:=][ \t]*)(' +
      _identifier +
      r')[ \t]*(\r?\n)[ \t]*([' +
      _identChars +
      r']+)(?=[ \t]*[,)\]}]|\s*\r?\n)',
);
final RegExp _edgeNewlines = RegExp(r'^[\r\n]+|[\r\n]+$');

String _normalizeExpressSource(String source) {
  final segments = <(bool isTok, String text)>[];
  var pos = 0;
  for (final RegExpMatch m in _sqlCommentOrToken.allMatches(source)) {
    if (m.start > pos) {
      segments.add((false, source.substring(pos, m.start)));
    }
    if (m[1] case final String tok) {
      segments.add((true, tok));
    } else {
      segments.add((true, '//${m[2] ?? ''}'));
    }
    pos = m.end;
  }
  if (pos < source.length) {
    segments.add((false, source.substring(pos)));
  }

  var depth = 0;
  final segDepths = <List<int>>[];
  for (final (bool isTok, String seg) in segments) {
    if (isTok) {
      segDepths.add(const []);
      continue;
    }
    final depths = <int>[];
    for (var i = 0; i < seg.length; i++) {
      final int code = seg.codeUnitAt(i);
      depths.add(depth);
      if (code == 40 || code == 91 || code == 123) {
        depth++;
      } else if (code == 41 || code == 93 || code == 125) {
        if (depth > 0) depth--;
      }
    }
    segDepths.add(depths);
  }

  final splitP2Starts = <(int, int)>{
    for (int segIdx = 0; segIdx < segments.length; segIdx++)
      if (!segments[segIdx].$1)
        for (final RegExpMatch m in _splitLhsIdentifier.allMatches(
          segments[segIdx].$2,
        ))
          if (segDepths[segIdx][m.start] == 0) (segIdx, m.end - m[3]!.length),
  };

  final directDeclared = <String>{
    for (int segIdx = 0; segIdx < segments.length; segIdx++)
      if (!segments[segIdx].$1)
        for (final RegExpMatch m in _declaredLhs.allMatches(
          segments[segIdx].$2,
        ))
          if (segDepths[segIdx][m.start + m[0]!.indexOf(m[1]!)] == 0 &&
              !splitP2Starts.contains((segIdx, m.start + m[0]!.indexOf(m[1]!))))
            m[1]!,
  };

  final declared = <String>{...directDeclared};
  for (var segIdx = 0; segIdx < segments.length; segIdx++) {
    if (!segments[segIdx].$1) {
      for (final RegExpMatch m in _splitLhsIdentifier.allMatches(
        segments[segIdx].$2,
      )) {
        if (segDepths[segIdx][m.start] == 0) {
          final String p1 = m[1]!.trim();
          final String p2 = m[3]!;
          if (!directDeclared.contains(p1) && !directDeclared.contains(p2)) {
            declared.add('$p1$p2');
          }
        }
      }
    }
  }

  final out = StringBuffer();
  for (final (bool isTok, String seg) in segments) {
    if (isTok) {
      out.write(seg);
      continue;
    }
    String text = seg.replaceAllMapped(_splitDataPath, (m) {
      final String p1 = m[1]!;
      final String nl = m[2]!;
      final String p2 = m[3]!;
      final String rest = seg.substring(m.end);
      if (_identOnly.hasMatch(p2) && _assignEquals.hasMatch(rest)) {
        return m[0]!;
      }
      return '$p1$p2$nl';
    });
    text = text.replaceAllMapped(_splitLhsIdentifier, (m) {
      final String p1Raw = m[1]!;
      final String nl = m[2]!;
      final String p2 = m[3]!;
      final String p1 = p1Raw.trim();
      if (!directDeclared.contains(p1) && !directDeclared.contains(p2)) {
        return '$p1Raw$p2$nl';
      }
      return m[0]!;
    });
    text = text.replaceAllMapped(_splitArgIdentifier, (m) {
      final String prefix = m[1]!;
      final String p1 = m[2]!;
      final String nl = m[3]!;
      final String p2 = m[4]!;
      final joined = '$p1$p2';
      if (declared.contains(joined) &&
          !declared.contains(p1) &&
          !declared.contains(p2)) {
        return '$prefix$joined$nl';
      }
      return m[0]!;
    });
    out.write(text);
  }
  return out.toString();
}

/// Parses an Express block into its statements.
///
/// Throws [A2uiParseError] if [source] does not match the grammar.
List<ExpressStatement> parseExpress(String source) {
  final String normalized = _normalizeExpressSource(source);
  final listener = _ErrorListener(source);
  final lexer = ExpressLexer(InputStream.fromString(normalized))
    ..removeErrorListeners()
    ..addErrorListener(listener);
  final parser = ExpressParser(CommonTokenStream(lexer))
    ..removeErrorListeners()
    ..addErrorListener(listener);
  // The listener throws at the first error, so the tree is complete.
  final ProgramContext program = parser.program();
  return [
    for (final StatementContext statement in program.statements())
      _statement(normalized, statement),
  ];
}

/// Reports the first syntax error the lexer or the parser finds.
class _ErrorListener extends BaseErrorListener {
  _ErrorListener(this.source);

  final String source;

  @override
  void syntaxError(
    Recognizer<Object?> recognizer,
    Object? offendingSymbol,
    int? line,
    int charPositionInLine,
    String msg,
    RecognitionException? e,
  ) => _syntaxError(source, line ?? 1, charPositionInLine, msg);
}

/// Reports a syntax error at [line] and the zero-based [column] of [source].
Never _syntaxError(String source, int line, int column, String message) =>
    throw A2uiParseError(
      'Express syntax error at line $line, column ${column + 1}: $message.',
      rawContent: source,
    );

ExpressStatement _statement(String source, StatementContext statement) {
  if (statement.assignment() case final AssignmentContext assignment) {
    final PathContext? path = assignment.path();
    return AssignmentStatement(
      path == null ? assignment.identifier()!.text : _path(path),
      _expression(source, assignment.expression()!),
      isDataPath: path != null,
    );
  }
  return ExpressionStatement(_expression(source, statement.expression()!));
}

ExpressNode _expression(String source, ExpressionContext expression) =>
    // The rule has one alternative per kind of expression, each a single rule.
    switch (expression.getChild<ParseTree>(0)) {
      final ArrayContext array => ArrayNode([
        for (final ExpressionContext item in array.expressions())
          _expression(source, item),
      ]),
      final MapContext map => MapNode({
        for (final Map_entryContext entry in map.map_entrys())
          entry.identifier()?.text ?? _string(entry.string()!): _expression(
            source,
            entry.expression()!,
          ),
      }),
      final PathContext path => PathNode(_path(path)),
      final CheckContext check => CheckNode(check.CHECK()!.text!.substring(1), [
        for (final ExpressionContext arg in check.expressions())
          _expression(source, arg),
      ]),
      final CallContext call => _call(source, call),
      final VariableContext variable => switch (variable.identifier()) {
        final IdentifierContext name => VariableNode(name.text),
        null => const SkippedNode(),
      },
      final LiteralContext literal => LiteralNode(_literal(literal)),
      _ => throw StateError('Unexpected expression ${expression.text}.'),
    };

CallNode _call(String source, CallContext call) {
  final args = <ExpressNode>[];
  final kwargs = <String, ExpressNode>{};
  for (final ArgContext arg in call.args()) {
    final Named_argContext? named = arg.named_arg();
    if (named == null) {
      args.add(_expression(source, arg.expression()!));
      continue;
    }
    final Token key = named.identifier()!.start!;
    final String name = key.text!;
    if (kwargs.containsKey(name)) {
      _syntaxError(
        source,
        key.line!,
        key.charPositionInLine,
        "argument '$name' is given twice",
      );
    }
    kwargs[name] = _expression(source, named.expression()!);
  }
  return CallNode(call.identifier()!.text, args, kwargs);
}

/// The path of a `$` data path, without the `$`.
String _path(PathContext path) => path.PATH()!.text!.substring(1);

Object? _literal(LiteralContext literal) {
  if (literal.string() case final StringContext string) return _string(string);
  if (literal.NUMBER() case final TerminalNode number) {
    final String text = number.text!;
    // Every SDK reads a NUMBER as a double first, so a literal outside the
    // double range is rejected the same way everywhere.
    final double value = double.parse(text);
    if (!value.isFinite) {
      throw A2uiParseError('Number literal $text is out of range.');
    }
    // Integer text is an exact `int` while it fits. `int.tryParse` returns
    // null for a fraction or an exponent, and for an integer too large for an
    // `int` (the grammar takes integers of any size), so those stay doubles.
    return int.tryParse(text) ?? value;
  }
  if (literal.BOOLEAN() case final TerminalNode boolean) {
    return boolean.text == 'true';
  }
  return null;
}

/// The value of a string literal, without its prefix and quotes.
///
/// Raw strings are kept as written; the others have their escapes resolved.
String _string(StringContext string) {
  // The rule is a single token.
  final Token token = string.start!;
  final String text = token.text!;
  return switch (token.type) {
    ExpressParser.TOKEN_RAW_TRIPLE_STRING => text.substring(4, text.length - 3),
    ExpressParser.TOKEN_RAW_STRING => text.substring(2, text.length - 1),
    ExpressParser.TOKEN_TRIPLE_STRING => _unescape(
      text.substring(3, text.length - 3),
    ),
    _ => _unescape(
      text.substring(1, text.length - 1).replaceAll(_edgeNewlines, ''),
    ),
  };
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
