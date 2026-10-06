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

import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:meta/meta.dart';

import '../model/client_function.dart';
import '../model/data_model.dart';
import '../primitives/logging.dart';
import '../primitives/simple_items.dart';
import '../utils/stream_extensions.dart';

/// Formats a value as a string.
class FormatStringFunction implements ClientFunction {
  const FormatStringFunction();

  @override
  String get name => 'formatString';

  @override
  String get description => r'''
Performs string interpolation of data model values and other functions in the
catalog functions list and returns the resulting string. The value string can
contain interpolated expressions in the ${expression} format. Supported
expression types include: JSON Pointer paths to the data model (e.g.,
${/absolute/path} or ${relative/path}), and client-side function calls (e.g.,
${now()}). Function arguments must be named (e.g.,
${formatDate(value:${/currentDate}, format:'MM-dd')}). To include a literal ${
sequence, escape it as \${.''';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.string;

  @override
  Schema get argumentSchema => S.object(properties: {'value': S.any()});

  @override
  Stream<String> execute(JsonMap args, ExecutionContext context) {
    if (!args.containsKey('value')) return Stream.value('');
    final Object? value = args['value'];

    return ExpressionParser(context).parse(value?.toString() ?? '');
  }
}

/// Exception thrown when the maximum recursion depth is exceeded.
class RecursionExpectedException implements Exception {
  /// Creates a [RecursionExpectedException] with the given [message].
  RecursionExpectedException(this.message);

  /// The detailed message explaining the recursion limit that was exceeded.
  final String message;
  @override
  String toString() => 'RecursionExpectedException: $message';
}

/// Parses and evaluates expressions in the A2UI `${expression}` format.
@visibleForTesting
class ExpressionParser {
  ExpressionParser(this.context);

  final ExecutionContext context;

  static const int _maxRecursionDepth = 100;

  /// Parses the input string and resolves any embedded expressions.
  ///
  /// The return value will always be a [Stream<String>].
  ///
  /// This method is the entry point for expression resolution. It handles
  /// escaping of the `${` sequence using a backslash (e.g. `\${`).
  Stream<String> parse(String input, {int depth = 0}) {
    if (depth > _maxRecursionDepth) {
      throw RecursionExpectedException('Max recursion depth reached in parse');
    }

    if (!input.contains(r'${')) {
      return Stream.value(input);
    }
    return _parseStringWithInterpolations(
      input,
      null,
      depth: depth + 1,
    ).map((event) => event?.toString() ?? '');
  }

  /// Evaluates a function call defined by [callDefinition].
  ///
  /// If [dependencies] is provided, the function will not be executed, but
  /// any data path dependencies within the arguments will be added to the set.
  Stream<Object?> evaluateFunctionCall(
    JsonMap callDefinition, {
    Set<DataPath>? dependencies,
    int depth = 0,
  }) {
    if (depth > _maxRecursionDepth) {
      throw RecursionExpectedException(
        'Max recursion depth reached in evaluateFunctionCall',
      );
    }

    final name = callDefinition['call'] as String?;
    if (name == null) {
      return Stream.value(null);
    }

    // 1. Resolve arguments
    final Map<String, Object?> args = {};
    final Object? argsJson = callDefinition['args'];
    var hasStreams = false;

    if (argsJson is Map) {
      for (final Object? key in argsJson.keys) {
        final argName = key.toString();
        final Object? value = argsJson[key];
        Object? resolvedValue;

        if (value is String) {
          resolvedValue = _parseStringWithInterpolations(
            value,
            dependencies,
            depth: depth + 1,
          );
        } else if (value is Map && value.containsKey('path')) {
          resolvedValue = _resolvePath(value['path'] as String, dependencies);
        } else if (value is Map && value.containsKey('call')) {
          resolvedValue = evaluateFunctionCall(
            value as JsonMap,
            dependencies: dependencies,
            depth: depth + 1,
          );
        } else {
          resolvedValue = value;
        }

        if (resolvedValue is Stream) {
          hasStreams = true;
        }
        args[argName] = resolvedValue;
      }
    } else if (argsJson != null) {
      genUiLogger.warning(
        'Function $name called with invalid args type: '
        '${argsJson.runtimeType}. Expected Map. Arguments dropped.',
      );
    }

    if (dependencies != null) {
      return Stream.value(null); // Dependency collection only
    }

    final ClientFunction? func = context.getFunction(name);
    if (func == null) {
      genUiLogger.warning('Function not found: $name');
      return Stream.value(null);
    }

    // 2. Execute function
    if (!hasStreams) {
      // Synchronous execution (returns Stream, but args are static)
      return func.execute(args, context);
    }

    // 3. Handle Stream arguments
    // Create a stream that combines all argument streams, then switches to the
    // result of execution.
    final List<String> keys = args.keys.toList();
    final List<Stream<Object?>> streams = keys.map((key) {
      final Object? val = args[key];
      if (val is Stream) return val.cast<Object?>();
      return Stream<Object?>.value(val);
    }).toList();

    return streams.combineLatestAll().switchMap((List<Object?> values) {
      final Map<String, Object?> combinedArgs = {};
      for (var i = 0; i < keys.length; i++) {
        combinedArgs[keys[i]] = values[i];
      }
      return func.execute(combinedArgs, context);
    });
  }

  Stream<Object?> _parseStringWithInterpolations(
    String input,
    Set<DataPath>? dependencies, {
    int depth = 0,
  }) {
    if (depth > _maxRecursionDepth) {
      throw RecursionExpectedException(
        'Max recursion depth reached in _parseStringWithInterpolations',
      );
    }

    var i = 0;
    final parts = <Object?>[];

    while (i < input.length) {
      final int startIndex = input.indexOf(r'${', i);
      if (startIndex == -1) {
        parts.add(input.substring(i));
        break;
      }

      if (startIndex > 0 && input[startIndex - 1] == r'\') {
        parts.add(input.substring(i, startIndex - 1));
        parts.add(r'${');
        i = startIndex + 2;
        continue;
      }

      if (startIndex > i) {
        parts.add(input.substring(i, startIndex));
      }
      final (String content, int endIndex) = _extractExpressionContent(
        input,
        startIndex + 2,
      );
      if (endIndex == -1) {
        parts.add(input.substring(startIndex));
        break;
      }

      final Object? value = _evaluateExpression(
        content,
        depth + 1,
        dependencies,
      );
      parts.add(value);

      i = endIndex + 1; // Skip closing '}'
    }

    if (parts.isEmpty) return Stream.value('');

    if (parts.length == 1 && parts[0] is! String) {
      final Object? part = parts[0];
      return part is Stream ? part.cast<Object?>() : Stream.value(part);
    }

    if (dependencies != null) {
      return Stream.value(null);
    }

    // Combine streams for string interpolation
    final List<Stream<Object?>> streams = parts.map((part) {
      if (part is Stream) return part.cast<Object?>();
      return Stream<Object?>.value(part);
    }).toList();

    return streams.combineLatestAll().map((List<Object?> values) {
      return values.map((e) => e?.toString() ?? '').join('');
    });
  }

  (String, int) _extractExpressionContent(String input, int start) {
    var balance = 1;
    var i = start;
    while (i < input.length) {
      if (input[i] == r'{') {
        balance++;
      } else if (input[i] == r'}') {
        balance--;
        if (balance == 0) {
          return (input.substring(start, i), i);
        }
      }
      if (input[i] == "'" || input[i] == '"') {
        final String quote = input[i];
        i++;
        while (i < input.length) {
          if (input[i] == quote && input[i - 1] != r'\') {
            break;
          }
          i++;
        }
      }
      i++;
    }
    return ('', -1);
  }

  Object? _evaluateExpression(
    String content,
    int depth,
    Set<DataPath>? dependencies,
  ) {
    if (depth > _maxRecursionDepth) {
      throw RecursionExpectedException(
        'Max recursion depth reached in expression: $content',
      );
    }

    content = content.trim();

    final RegExpMatch? match = RegExp(
      r'^([a-zA-Z0-9_]+)\s*\(',
    ).firstMatch(content);
    if (match != null && content.endsWith(')')) {
      final String funcName = match.group(1)!;
      final String argsStr = content.substring(match.end, content.length - 1);
      final Map<String, Object?> args = _parseNamedArgs(
        argsStr,
        depth + 1,
        dependencies,
      );

      if (dependencies != null) {
        return null;
      }

      // Construct a call definition for evaluateFunctionCall to reuse logic
      return evaluateFunctionCall({'call': funcName, 'args': args});
    }

    return _resolvePath(content, dependencies);
  }

  Map<String, Object?> _parseNamedArgs(
    String argsStr,
    int depth,
    Set<DataPath>? dependencies,
  ) {
    final args = <String, Object?>{};
    var i = 0;

    while (i < argsStr.length) {
      while (i < argsStr.length && argsStr[i].trim().isEmpty) {
        i++;
      }
      if (i >= argsStr.length) break;

      final keyStart = i;
      while (i < argsStr.length &&
          argsStr[i] != ':' &&
          argsStr[i] != ' ' &&
          argsStr[i] != ',') {
        i++;
      }
      final String key = argsStr.substring(keyStart, i).trim();

      while (i < argsStr.length && argsStr[i].trim().isEmpty) {
        i++;
      }

      if (i < argsStr.length && argsStr[i] == ':') {
        i++;
      } else {
        genUiLogger.warning(
          'Invalid named argument format (missing colon) at index $i: $argsStr',
        );
        return args;
      }

      while (i < argsStr.length && argsStr[i].trim().isEmpty) {
        i++;
      }

      final (Object? value, int nextIndex) = _parseValue(
        argsStr,
        i,
        depth,
        dependencies,
      );
      args[key] = value;
      i = nextIndex;

      while (i < argsStr.length && argsStr[i].trim().isEmpty) {
        i++;
      }

      if (i < argsStr.length && argsStr[i] == ',') i++;
    }
    return args;
  }

  (Object?, int) _parseValue(
    String input,
    int start,
    int depth,
    Set<DataPath>? dependencies,
  ) {
    if (start >= input.length) return (null, start);

    final String char = input[start];

    if (char == "'" || char == '"') {
      final quote = char;
      int i = start + 1;
      while (i < input.length) {
        if (input[i] == quote && input[i - 1] != r'\') {
          break;
        }
        i++;
      }
      if (i < input.length) {
        final String val = input.substring(start + 1, i);
        return (
          _parseStringWithInterpolations(val, dependencies, depth: depth + 1),
          i + 1,
        );
      }
      return (input.substring(start), input.length);
    }

    if (char == r'$' && start + 1 < input.length && input[start + 1] == '{') {
      final (String content, int end) = _extractExpressionContent(
        input,
        start + 2,
      );
      if (end != -1) {
        final Object? val = _evaluateExpression(content, depth, dependencies);
        return (val, end + 1);
      }
    }

    var i = start;
    while (i < input.length) {
      final String c = input[i];
      if (c == ',' ||
          c == ')' ||
          c == '}' ||
          c == ' ' ||
          c == '\t' ||
          c == '\n') {
        break;
      }
      i++;
    }

    final String token = input.substring(start, i);
    if (token == 'true') return (true, i);
    if (token == 'false') return (false, i);
    if (token == 'null') return (null, i);

    final num? numVal = num.tryParse(token);
    if (numVal != null) return (numVal, i);

    return (_resolvePath(token, dependencies), i);
  }

  Stream<Object?> _resolvePath(String pathStr, Set<DataPath>? dependencies) {
    pathStr = pathStr.trim();
    if (dependencies != null) {
      dependencies.add(context.resolvePath(DataPath(pathStr)));
      return Stream.value(null);
    }
    return context.subscribeStream<Object?>(DataPath(pathStr));
  }
}
