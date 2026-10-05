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

import 'package:json_schema_builder/json_schema_builder.dart' show Schema;

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
/// and the empty string.
bool isTruthy(Object? value) => switch (value) {
      null || false || '' => false,
      final num n => n != 0 && !n.isNaN,
      _ => true,
    };

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

/// Whether every entry of [values] is truthy. Throws [A2uiExpressionError]
/// for fewer than two values.
bool evaluateAnd(Object? values) =>
    _logicOperands('and', values).every(isTruthy);

/// Whether any entry of [values] is truthy. Throws [A2uiExpressionError]
/// for fewer than two values.
bool evaluateOr(Object? values) => _logicOperands('or', values).any(isTruthy);

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
// Argument schemas
// ---------------------------------------------------------------------------

/// Builds argument schemas in the shape of one protocol version's catalog,
/// where dynamic values are a literal, a data binding or a function call.
class BasicArgumentSchemas {
  /// Creates schemas whose bindings and calls are written as the reserved
  /// protocol directives `@path`/`@call` when [directives] is true, as from
  /// v1.0, and as the bare `path`/`call` keys otherwise.
  const BasicArgumentSchemas({required this.directives});

  /// Whether bindings and calls are written as `@` directives.
  final bool directives;

  String get _pathKey => directives ? '@path' : 'path';
  String get _callKey => directives ? '@call' : 'call';

  Map<String, Object?> get _binding => {
        'type': 'object',
        'properties': {
          _pathKey: {'type': 'string'},
        },
        'required': [_pathKey],
      };

  Map<String, Object?> get _call => {
        'type': 'object',
        'properties': {
          _callKey: {'type': 'string'},
          'args': {'type': 'object'},
          'returnType': {'type': 'string'},
        },
        'required': [_callKey],
      };

  /// A value that is a literal of one of [types], a binding or a call.
  Map<String, Object?> dynamic(String description, List<String> types) => {
        'description': description,
        'anyOf': [
          for (final type in types) {'type': type},
          _binding,
          _call,
        ],
      };

  /// A dynamic string.
  Map<String, Object?> string(String description) =>
      dynamic(description, const ['string']);

  /// A dynamic number.
  Map<String, Object?> number(String description) =>
      dynamic(description, const ['number']);

  /// A dynamic boolean.
  Map<String, Object?> boolean(String description) =>
      dynamic(description, const ['boolean']);

  /// A dynamic value of any JSON type.
  Map<String, Object?> any(String description) => dynamic(
        description,
        const ['string', 'number', 'boolean', 'array', 'object', 'null'],
      );

  /// The URL argument of `openUrl`.
  Map<String, Object?> get url => directives
      ? {
          'description': 'The URL to open.',
          'oneOf': [
            {'type': 'string', 'format': 'uri'},
            _binding,
            _call,
          ],
        }
      : {'type': 'string', 'format': 'uri', 'description': 'The URL to open.'};

  /// An argument object with [properties], of which [required] must be
  /// present, and no other properties.
  Schema object(
    Map<String, Map<String, Object?>> properties, {
    List<String> required = const [],
    List<Object?>? anyOf,
  }) =>
      Schema.fromMap({
        'type': 'object',
        'properties': properties,
        if (required.isNotEmpty) 'required': required,
        if (anyOf != null) 'anyOf': anyOf,
        'unevaluatedProperties': false,
      });
}

/// Builds the 14 basic catalog functions for one protocol version.
///
/// [schemas] picks the binding and call shapes for the argument schemas.
/// [validator] wraps a rule's [ValidationResult] in the version's return
/// value, with [validatorReturnType] as its declared type.
List<FunctionImplementation> buildBasicFunctions({
  required BasicArgumentSchemas schemas,
  required A2uiReturnType validatorReturnType,
  required Object? Function(ValidationResult result) validator,
  required String Function(Object?, Map<String, dynamic>) formatNumber,
  required String Function(Object?, Map<String, dynamic>) formatCurrency,
  required String Function(Object?, Map<String, dynamic>) formatDate,
  required String Function(Object?, Map<String, dynamic>) pluralize,
  OpenUrlCallback? onOpenUrl,
}) {
  const List<Object?> minOrMax = [
    {
      'required': ['min'],
    },
    {
      'required': ['max'],
    },
  ];
  final s = schemas;

  BasicFunction validation(
    String name,
    Map<String, Map<String, Object?>> properties,
    List<String> required,
    ValidationResult Function(Map<String, dynamic> args) rule, {
    List<Object?>? anyOf,
  }) =>
      BasicFunction(
        name: name,
        returnType: validatorReturnType,
        argumentSchema: s.object(properties, required: required, anyOf: anyOf),
        body: (args, _) => validator(rule(args)),
      );

  BasicFunction formatter(
    String name,
    Map<String, Map<String, Object?>> properties,
    List<String> required,
    String Function(Object?, Map<String, dynamic>) format,
  ) =>
      BasicFunction(
        name: name,
        returnType: A2uiReturnType.string,
        argumentSchema: s.object(properties, required: required),
        body: (args, _) => format(args['value'], args),
      );

  return [
    validation(
      'required',
      {
        'value': {'description': 'The value to check.'},
      },
      ['value'],
      (args) => validateRequired(args['value']),
    ),
    validation(
      'regex',
      {
        'value': s.string('The value to test.'),
        'pattern': {
          'type': 'string',
          'description': 'The regex pattern to match against.',
        },
      },
      ['value', 'pattern'],
      (args) => validateRegex(args['value'], args['pattern']),
    ),
    validation(
      'length',
      {
        'value': s.string('The string or list to measure.'),
        'min': {
          'type': 'integer',
          'minimum': 0,
          'description': 'The minimum allowed length.',
        },
        'max': {
          'type': 'integer',
          'minimum': 0,
          'description': 'The maximum allowed length.',
        },
      },
      ['value'],
      (args) => validateLength(args['value'], args['min'], args['max']),
      anyOf: minOrMax,
    ),
    validation(
      'numeric',
      {
        'value': s.number('The value to check.'),
        'min': {'type': 'number', 'description': 'The minimum allowed value.'},
        'max': {'type': 'number', 'description': 'The maximum allowed value.'},
      },
      ['value'],
      (args) => validateNumeric(args['value'], args['min'], args['max']),
      anyOf: minOrMax,
    ),
    validation(
      'email',
      {'value': s.string('The value to check.')},
      ['value'],
      (args) => validateEmail(args['value']),
    ),
    BasicFunction(
      name: 'formatString',
      returnType: A2uiReturnType.string,
      argumentSchema: s.object({
        'value': s.string('The string template to interpolate.'),
      }, required: [
        'value'
      ]),
      body: (args, context) => formatTemplate(args['value'], context),
    ),
    formatter(
      'formatNumber',
      {
        'value': s.number('The number to format.'),
        'decimals': s.number('Optional. The number of decimal places.'),
        'grouping': s.boolean(
          'Optional. Whether to use locale grouping separators. Defaults to '
          'true.',
        ),
      },
      ['value'],
      formatNumber,
    ),
    formatter(
      'formatCurrency',
      {
        'value': s.number('The monetary amount.'),
        'currency': s.string("The ISO 4217 currency code (e.g., 'USD')."),
        'decimals': s.number('Optional. The number of decimal places.'),
        'grouping': s.boolean(
          'Optional. Whether to use locale grouping separators. Defaults to '
          'true.',
        ),
      },
      ['currency', 'value'],
      formatCurrency,
    ),
    formatter(
      'formatDate',
      {
        'value': s.any('The date to format.'),
        'format': s.string("A Unicode TR35 date pattern string, or 'ISO'."),
      },
      ['format', 'value'],
      formatDate,
    ),
    formatter(
      'pluralize',
      {
        'value': s.number(
          'The numeric value used to determine the plural category.',
        ),
        'zero': s.string("String for the 'zero' category."),
        'one': s.string("String for the 'one' category."),
        'two': s.string("String for the 'two' category."),
        'few': s.string("String for the 'few' category."),
        'many': s.string("String for the 'many' category."),
        'other': s.string('The default/fallback string.'),
      },
      ['value', 'other'],
      pluralize,
    ),
    BasicFunction(
      name: 'openUrl',
      returnType: A2uiReturnType.void_,
      argumentSchema: s.object({'url': s.url}, required: ['url']),
      body: (args, _) => openUrl(args['url'], onOpenUrl),
    ),
    for (final (String name, bool Function(Object?) evaluate) in [
      ('and', evaluateAnd),
      ('or', evaluateOr),
    ])
      BasicFunction(
        name: name,
        returnType: A2uiReturnType.boolean,
        argumentSchema: s.object({
          'values': {
            'type': 'array',
            'description': 'The list of boolean values to evaluate.',
            'items': s.boolean('A value to evaluate.'),
            'minItems': 2,
          },
        }, required: [
          'values'
        ]),
        body: (args, _) => evaluate(args['values']),
      ),
    BasicFunction(
      name: 'not',
      returnType: A2uiReturnType.boolean,
      argumentSchema: s.object({
        'value': s.boolean('The boolean value to negate.'),
      }, required: [
        'value'
      ]),
      body: (args, _) => !isTruthy(args['value']),
    ),
  ];
}
