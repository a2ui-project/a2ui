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

/// Behaviour shared by the v0.9 and v1.0 basic catalog functions: value
/// coercion, the validation rules, logic, `formatString` and `openUrl`.
///
/// Semantics follow the TypeScript engine (`basic_functions.ts`).
library;

import 'dart:async';
import 'dart:convert';

import '../core/catalog.dart';
import '../core/contexts.dart';
import '../core/validation_result.dart';
import '../primitives/cancellation.dart';
import '../primitives/errors.dart';
import '../primitives/reactivity.dart';
import '../processing/expressions.dart';

/// Opens [url] on behalf of the basic catalog's `openUrl` function.
///
/// The URL has already been checked against the allowed schemes (`http`,
/// `https`, `mailto` and `tel`). A returned future is passed back to the
/// caller, which may await it.
typedef OpenUrlCallback = FutureOr<void> Function(Uri url);

/// Evaluates one basic catalog function call.
typedef BasicFunctionBody = Object? Function(
  Map<String, dynamic> args,
  DataContext context,
);

/// A basic catalog function whose behaviour is a closure, so each catalog
/// version can bind its own locale, callbacks and return shapes.
class BasicFunction extends FunctionImplementation {
  /// Creates a function named [name] that evaluates calls with [body].
  BasicFunction({
    required super.name,
    required super.argumentSchema,
    required super.returnType,
    super.description,
    super.allowedCallers,
    super.requiresUserActivation,
    super.sourceJson,
    required BasicFunctionBody body,
  }) : _body = body;

  final BasicFunctionBody _body;

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      _body(args, context);
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/// Whether [value] is truthy: everything except `null`, `false`, `0`, `NaN`
/// and the empty string. Lists and maps are truthy, even when empty.
bool isTruthy(Object? value) => switch (value) {
      null || false || '' => false,
      final num n => n != 0 && !n.isNaN,
      _ => true,
    };

/// [isTruthy], except that a [ValidationResult], or a map carrying a `valid`
/// key, is truthy when it is valid, as read by [ValidationResult.validityOf].
///
/// The v1.0 logic functions use this so `and`, `or` and `not` agree with the
/// binder's `checks` evaluation when they wrap a validation rule. The v0.9
/// functions keep [isTruthy]: their validation rules return `bool`, and a
/// data-model object that happens to carry a `valid` key is an object.
bool isTruthyOrValid(Object? value) =>
    ValidationResult.validityOf(value) ?? isTruthy(value);

/// Reads [value] as a number, or `NaN` when it is not one.
///
/// Numbers pass through, booleans read as 1 and 0, and strings are parsed
/// after trimming, with a blank string reading as 0. `null`, lists and maps
/// are not numbers.
num toNumber(Object? value) => switch (value) {
      final num n => n,
      final bool b => b ? 1 : 0,
      final String s when s.trim().isEmpty => 0,
      final String s => double.tryParse(s.trim()) ?? double.nan,
      _ => double.nan,
    };

/// Renders [value] as text: `null` as an empty string, integral doubles
/// without a trailing `.0`, and maps and lists as compact JSON.
String coerceToString(Object? value) {
  if (value == null) return '';
  if (value is String) return value;
  if (value is num) return _numberToString(value);
  if (value is Map || value is List) {
    return jsonEncode(
      _normalizeNumbers(value),
      toEncodable: (Object? item) =>
          item is ValidationResult ? item.toJson() : item.toString(),
    );
  }
  return value.toString();
}

String _numberToString(num value) {
  if (value is double &&
      value.isFinite &&
      value == value.truncateToDouble() &&
      value.abs() < 1e21) {
    return value.toInt().toString();
  }
  return value.toString();
}

/// Rewrites integral doubles nested in [value] as integers, so JSON output
/// prints `3` rather than `3.0`.
Object? _normalizeNumbers(Object? value) => switch (value) {
      final double d when d.isFinite && d == d.truncateToDouble() => d.toInt(),
      final Map<Object?, Object?> m => {
          for (final MapEntry<Object?, Object?> e in m.entries)
            e.key.toString(): _normalizeNumbers(e.value),
        },
      final List<Object?> l => [
          for (final Object? e in l) _normalizeNumbers(e)
        ],
      _ => value,
    };

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

const ValidationResult _valid = ValidationResult(valid: true);

ValidationResult _invalid(String message) =>
    ValidationResult(valid: false, message: message);

/// Checks that [value] is present: not `null`, an empty string or an empty
/// list. An empty map counts as present.
ValidationResult validateRequired(Object? value) {
  final bool empty =
      value == null || value == '' || (value is List && value.isEmpty);
  return empty ? _invalid('This field is required.') : _valid;
}

/// Checks that [value], as text, contains a match for [pattern].
///
/// Throws [A2uiExpressionError] when [pattern] is not a valid expression.
ValidationResult validateRegex(Object? value, Object? pattern) {
  final String source = coerceToString(pattern);
  final RegExp regex;
  try {
    regex = RegExp(source);
  } on FormatException catch (e) {
    throw A2uiExpressionError(
      'Invalid regex pattern: $source',
      expression: 'regex',
      details: e,
    );
  }
  return regex.hasMatch(coerceToString(value))
      ? _valid
      : _invalid('Value does not match required pattern.');
}

/// Checks that the length of a string, or the number of elements in a list,
/// is within [min] and [max]. Any other value has length 0.
ValidationResult validateLength(Object? value, Object? min, Object? max) {
  final int length = switch (value) {
    final String s => s.length,
    final List<Object?> l => l.length,
    _ => 0,
  };
  final num lower = toNumber(min);
  final num upper = toNumber(max);
  if (min != null && !lower.isNaN && length < lower) {
    return _invalid('Minimum length is ${coerceToString(lower)}.');
  }
  if (max != null && !upper.isNaN && length > upper) {
    return _invalid('Maximum length is ${coerceToString(upper)}.');
  }
  return _valid;
}

/// Checks that [value] reads as a number within [min] and [max].
ValidationResult validateNumeric(Object? value, Object? min, Object? max) {
  final num number = toNumber(value);
  if (number.isNaN) return _invalid('Value must be a valid number.');
  final num lower = toNumber(min);
  final num upper = toNumber(max);
  if (min != null && !lower.isNaN && number < lower) {
    return _invalid('Minimum value is ${coerceToString(lower)}.');
  }
  if (max != null && !upper.isNaN && number > upper) {
    return _invalid('Maximum value is ${coerceToString(upper)}.');
  }
  return _valid;
}

final RegExp _email =
    RegExp(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$');

/// Checks that [value] is a string with basic email address syntax.
ValidationResult validateEmail(Object? value) =>
    value is String && _email.hasMatch(value)
        ? _valid
        : _invalid('Must be a valid email address.');

// ---------------------------------------------------------------------------
// Logic
// ---------------------------------------------------------------------------

List<Object?> _logicOperands(String name, Object? values) {
  if (values is List<Object?> && values.length >= 2) return values;
  throw A2uiExpressionError('$name requires at least 2 values',
      expression: name);
}

/// Whether every entry of [values] is truthy by [truthy]. Throws
/// [A2uiExpressionError] for fewer than two values.
bool evaluateAnd(Object? values, [bool Function(Object?) truthy = isTruthy]) =>
    _logicOperands('and', values).every(truthy);

/// Whether any entry of [values] is truthy by [truthy]. Throws
/// [A2uiExpressionError] for fewer than two values.
bool evaluateOr(Object? values, [bool Function(Object?) truthy = isTruthy]) =>
    _logicOperands('or', values).any(truthy);

// ---------------------------------------------------------------------------
// formatString
// ---------------------------------------------------------------------------

/// Interpolates the `${...}` expressions in [template] against [context].
///
/// A non-string [template] is coerced to text first. Returns a string when
/// the template holds no bindings or calls, and otherwise a signal that
/// recomputes when the data it reads changes. Interpolated values are
/// rendered with [coerceToString].
///
/// The parser's `{path}` and `{call, args}` parts are rewritten with
/// [DataContext.adaptExpressionPart] into the shape the context resolves.
Object? formatTemplate(Object? template, DataContext context) {
  final List<Object?> parts = ExpressionParser().parse(
    coerceToString(template),
  );
  if (!parts.any((part) => part is Map)) {
    return parts.map(coerceToString).join();
  }
  final List<Object?> sources = [
    for (final Object? part in parts)
      if (part is Map)
        context.resolveListenable(context.adaptExpressionPart(part))
      else
        part,
  ];
  return computed(
    () => sources
        .map(
          (source) => coerceToString(
            source is ReadonlySignal<Object?> ? source.value : source,
          ),
        )
        .join(),
  );
}

// ---------------------------------------------------------------------------
// openUrl
// ---------------------------------------------------------------------------

const Set<String> _allowedUrlSchemes = {'http', 'https', 'mailto', 'tel'};

/// Validates [url] and hands it to [onOpen].
///
/// A missing or blank [url] does nothing. Throws [A2uiExpressionError] when
/// [url] is not an absolute `http`, `https`, `mailto` or `tel` URL, or when
/// there is no [onOpen] to open it with. Returns the callback's future, if
/// it returns one, and otherwise null.
Future<void>? openUrl(Object? url, OpenUrlCallback? onOpen) {
  if (url is! String || url.trim().isEmpty) return null;
  final Uri? uri = Uri.tryParse(url.trim());
  if (uri == null) {
    throw A2uiExpressionError(
      'Invalid URL specified: $url',
      expression: 'openUrl',
    );
  }
  final String scheme = uri.scheme.toLowerCase();
  if (!_allowedUrlSchemes.contains(scheme)) {
    throw A2uiExpressionError(
      scheme.isEmpty
          ? 'URL must be absolute: $url'
          : 'Unsupported URL scheme: $scheme:',
      expression: 'openUrl',
    );
  }
  if (onOpen == null) {
    throw A2uiExpressionError(
      'openUrl has no handler; pass an OpenUrlCallback when building the '
      'basic catalog.',
      expression: 'openUrl',
    );
  }
  final FutureOr<void> result = onOpen(uri);
  return result is Future<void> ? result : null;
}

// ---------------------------------------------------------------------------
// Function bodies
// ---------------------------------------------------------------------------

/// The behaviour of the 14 basic catalog functions, by name, for one
/// protocol version.
///
/// A body evaluates a call; its name, argument schema and return type come
/// from the published catalog document, which `BasicCatalog` reads from an
/// embedded copy. [validator] wraps a rule's [ValidationResult] in the
/// version's return value, and [truthy] is the version's truthiness rule for
/// `and`, `or` and `not`.
Map<String, BasicFunctionBody> basicFunctionBodies({
  required Object? Function(ValidationResult result) validator,
  required bool Function(Object?) truthy,
  required String Function(Object?, Map<String, dynamic>) formatNumber,
  required String Function(Object?, Map<String, dynamic>) formatCurrency,
  required String Function(Object?, Map<String, dynamic>) formatDate,
  required String Function(Object?, Map<String, dynamic>) pluralize,
  OpenUrlCallback? onOpenUrl,
}) {
  BasicFunctionBody validation(
    ValidationResult Function(Map<String, dynamic> args) rule,
  ) =>
      (args, _) => validator(rule(args));

  BasicFunctionBody formatter(
    String Function(Object?, Map<String, dynamic>) format,
  ) =>
      (args, _) => format(args['value'], args);

  return {
    'required': validation((args) => validateRequired(args['value'])),
    'regex': validation(
      (args) => validateRegex(args['value'], args['pattern']),
    ),
    'length': validation(
      (args) => validateLength(args['value'], args['min'], args['max']),
    ),
    'numeric': validation(
      (args) => validateNumeric(args['value'], args['min'], args['max']),
    ),
    'email': validation((args) => validateEmail(args['value'])),
    'formatString': (args, context) => formatTemplate(args['value'], context),
    'formatNumber': formatter(formatNumber),
    'formatCurrency': formatter(formatCurrency),
    'formatDate': formatter(formatDate),
    'pluralize': formatter(pluralize),
    'openUrl': (args, _) => openUrl(args['url'], onOpenUrl),
    'and': (args, _) => evaluateAnd(args['values'], truthy),
    'or': (args, _) => evaluateOr(args['values'], truthy),
    'not': (args, _) => !truthy(args['value']),
  };
}
