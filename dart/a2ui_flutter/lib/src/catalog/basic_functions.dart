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

import 'package:intl/intl.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:url_launcher/url_launcher.dart';

import '../functions/format_string.dart';
import '../model/a2ui_schemas.dart';
import '../model/client_function.dart';
import '../primitives/simple_items.dart';

// ignore: avoid_classes_with_only_static_members
/// A collection of basic client-side functions.
class BasicFunctions {
  static const requiredFunction = RequiredFunction();
  static const regexFunction = RegexFunction();
  static const lengthFunction = LengthFunction();
  static const numericFunction = NumericFunction();
  static const emailFunction = EmailFunction();
  static const formatStringFunction = FormatStringFunction();
  static const openUrlFunction = OpenUrlFunction();
  static const formatNumberFunction = FormatNumberFunction();
  static const formatCurrencyFunction = FormatCurrencyFunction();
  static const formatDateFunction = FormatDateFunction();
  static const pluralizeFunction = PluralizeFunction();
  static const andFunction = AndFunction();
  static const orFunction = OrFunction();
  static const notFunction = NotFunction();

  /// Returns a list of all basic functions.
  static List<ClientFunction> get all => [
    requiredFunction,
    regexFunction,
    lengthFunction,
    numericFunction,
    emailFunction,
    formatStringFunction,
    openUrlFunction,
    formatNumberFunction,
    formatCurrencyFunction,
    formatDateFunction,
    pluralizeFunction,
    andFunction,
    orFunction,
    notFunction,
  ];
}

/// Helper to check for truthiness.
bool _isTruthy(Object? value) {
  if (value is bool) return value;
  if (value == null) return false;
  return true;
}

/// Checks if all values in a list are truthy.
class AndFunction extends SynchronousClientFunction {
  const AndFunction();
  @override
  String get name => 'and';

  @override
  String get description =>
      'Performs a logical AND operation on a list of boolean values.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.boolean;

  @override
  Schema get argumentSchema =>
      S.object(properties: {'values': S.list(items: S.any())});

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    if (!args.containsKey('values')) return false;
    final Object? values = args['values'];
    if (values is! List) return false;
    for (final Object? element in values) {
      if (!_isTruthy(element)) return false;
    }
    return true;
  }
}

/// Checks if any value in a list is truthy.
class OrFunction extends SynchronousClientFunction {
  const OrFunction();

  @override
  String get name => 'or';

  @override
  String get description =>
      'Performs a logical OR operation on a list of boolean values.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.boolean;

  @override
  Schema get argumentSchema =>
      S.object(properties: {'values': S.list(items: S.any())});

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    if (!args.containsKey('values')) return false;
    final Object? values = args['values'];
    if (values is! List) return false;
    for (final Object? element in values) {
      if (_isTruthy(element)) return true;
    }
    return false;
  }
}

/// Negates a boolean value.
class NotFunction extends SynchronousClientFunction {
  const NotFunction();

  @override
  String get name => 'not';

  @override
  String get description =>
      'Performs a logical NOT operation on a boolean value.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.boolean;

  @override
  Schema get argumentSchema => S.object(properties: {'value': S.any()});

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    if (!args.containsKey('value')) return false;
    return !_isTruthy(args['value']);
  }
}

/// Checks if a value is present and not empty.
class RequiredFunction extends SynchronousClientFunction {
  const RequiredFunction();

  @override
  String get name => 'required';

  @override
  String get description =>
      'Checks that the value is not null, undefined, or empty.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.boolean;

  @override
  Schema get argumentSchema => S.object(properties: {'value': S.any()});

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    if (!args.containsKey('value')) return false;
    final Object? value = args['value'];
    if (value == null) return false;
    if (value is String) return value.isNotEmpty;
    if (value is List) return value.isNotEmpty;
    if (value is Map) return value.isNotEmpty;
    return true;
  }
}

/// Checks if a string matches a regex pattern.
class RegexFunction extends SynchronousClientFunction {
  const RegexFunction();

  @override
  String get name => 'regex';

  @override
  String get description =>
      'Checks that the value matches a regular expression string.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.boolean;

  @override
  Schema get argumentSchema => S.object(
    properties: {'value': A2uiSchemas.stringReference(), 'pattern': S.string()},
  );

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    final Object? value = args['value'];
    final Object? pattern = args['pattern'];
    if (value is! String || pattern is! String) return false;
    try {
      return RegExp(pattern).hasMatch(value);
    } on FormatException catch (exception) {
      throw FormatException('Invalid regex pattern: $pattern. $exception');
    }
  }
}

/// Returns the length of a string, list, or map.
class LengthFunction extends SynchronousClientFunction {
  const LengthFunction();

  @override
  String get name => 'length';

  @override
  String get description => 'Checks string length constraints.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.any;

  @override
  Schema get argumentSchema => S.object(
    properties: {'value': S.any(), 'min': S.integer(), 'max': S.integer()},
  );

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    final Object? value = args['value'];
    var length = 0;
    if (value == null) {
      length = 0;
    } else if (value is String) {
      length = value.length;
    } else if (value is List) {
      length = value.length;
    } else if (value is Map) {
      length = value.length;
    } else {
      length = 0;
    }

    if (args.containsKey('min') || args.containsKey('max')) {
      if (args.containsKey('min')) {
        final Object? min = args['min'];
        if (min is num && length < min) return false;
      }
      if (args.containsKey('max')) {
        final Object? max = args['max'];
        if (max is num && length > max) return false;
      }
      return true;
    }

    return length;
  }
}

/// Checks if a value is numeric and optionally within a range.
class NumericFunction extends SynchronousClientFunction {
  const NumericFunction();

  @override
  String get name => 'numeric';

  @override
  String get description => 'Checks numeric range constraints.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.boolean;

  @override
  Schema get argumentSchema => S.object(
    properties: {
      'value': A2uiSchemas.numberReference(),
      'min': S.number(),
      'max': S.number(),
    },
  );

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    final Object? value = args['value'];
    if (value is! num) return false;

    if (args.containsKey('min')) {
      final Object? min = args['min'];
      if (min is num && value < min) return false;
    }
    if (args.containsKey('max')) {
      final Object? max = args['max'];
      if (max is num && value > max) return false;
    }
    return true;
  }
}

/// Checks if a string is a valid email.
class EmailFunction extends SynchronousClientFunction {
  const EmailFunction();

  @override
  String get name => 'email';

  @override
  String get description => 'Checks that the value is a valid email address.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.boolean;

  @override
  Schema get argumentSchema =>
      S.object(properties: {'value': A2uiSchemas.stringReference()});

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    final Object? value = args['value'];
    if (value is! String) return false;
    final emailRegex = RegExp(r'^[^@]+@[^@]+\.[^@]+\$');
    return emailRegex.hasMatch(value);
  }
}

/// Opens a URL.
class OpenUrlFunction extends SynchronousClientFunction {
  const OpenUrlFunction();

  @override
  String get name => 'openUrl';

  @override
  String get description =>
      'Opens the specified URL in a browser or handler. '
      'This function has no return value.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.empty;

  @override
  Schema get argumentSchema =>
      S.object(properties: {'url': A2uiSchemas.stringReference()});

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    final Object? urlStr = args['url'];
    if (urlStr is! String) return false;
    final Uri? uri = Uri.tryParse(urlStr);
    if (uri != null) {
      canLaunchUrl(uri).then((can) {
        if (can) launchUrl(uri);
      });
      return true;
    }
    return false;
  }
}

/// Formats a number.
class FormatNumberFunction extends SynchronousClientFunction {
  const FormatNumberFunction();

  @override
  String get name => 'formatNumber';

  @override
  String get description =>
      'Formats a number with the specified grouping and decimal precision.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.string;

  @override
  Schema get argumentSchema => S.object(
    properties: {
      'value': A2uiSchemas.numberReference(),
      'decimalPlaces': S.integer(),
      'useGrouping': S.boolean(),
    },
  );

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    final Object? number = args['value'];
    if (number is! num) return number?.toString() ?? '';

    int? decimalPlaces;
    if (args['decimalPlaces'] is num) {
      decimalPlaces = (args['decimalPlaces'] as num).toInt();
    }

    var useGrouping = true;
    if (args['useGrouping'] is bool) {
      useGrouping = args['useGrouping'] as bool;
    }

    final formatter = NumberFormat.decimalPattern(); // Default locale
    if (!useGrouping) {
      formatter.turnOffGrouping();
    }
    if (decimalPlaces != null) {
      formatter.minimumFractionDigits = decimalPlaces;
      formatter.maximumFractionDigits = decimalPlaces;
    }

    return formatter.format(number);
  }
}

/// Formats a currency value.
class FormatCurrencyFunction extends SynchronousClientFunction {
  const FormatCurrencyFunction();

  @override
  String get name => 'formatCurrency';

  @override
  String get description => 'Formats a number as a currency string.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.string;

  @override
  Schema get argumentSchema => S.object(
    properties: {
      'value': A2uiSchemas.numberReference(),
      'currencyCode': S.string(),
    },
  );

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    final Object? amount = args['value'];
    final Object? currencyCode = args['currencyCode'];
    if (amount is! num || currencyCode is! String) {
      return amount?.toString() ?? '';
    }

    final formatter = NumberFormat.simpleCurrency(name: currencyCode);
    return formatter.format(amount);
  }
}

/// Formats a date.
class FormatDateFunction extends SynchronousClientFunction {
  const FormatDateFunction();

  @override
  String get name => 'formatDate';

  @override
  String get description =>
      'Formats a timestamp into a string using a pattern.';

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.string;

  @override
  Schema get argumentSchema => S.object(
    properties: {
      'value': S.any(), // String or int (millis)
      'pattern': S.string(),
    },
  );

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    final Object? dateVal = args['value'];
    final Object? pattern = args['pattern'];

    DateTime? date;
    if (dateVal is String) {
      date = DateTime.tryParse(dateVal);
    } else if (dateVal is int) {
      date = DateTime.fromMillisecondsSinceEpoch(dateVal);
    }

    if (date == null || pattern is! String) return dateVal?.toString();

    try {
      return DateFormat(pattern).format(date);
    } catch (_) {
      return date.toString();
    }
  }
}

/// Pluralizes a word based on a count.
class PluralizeFunction extends SynchronousClientFunction {
  const PluralizeFunction();

  @override
  String get name => 'pluralize';

  @override
  String get description =>
      'Returns a localized string based on the Common Locale Data Repository '
      '(CLDR) plural category of the count (zero, one, two, few, many, other). '
      "Requires an 'other' fallback.";

  @override
  ClientFunctionReturnType get returnType => ClientFunctionReturnType.string;

  @override
  Schema get argumentSchema => S.object(
    properties: {
      'value': A2uiSchemas.numberReference(),
      'zero': S.string(),
      'one': S.string(),
      'two': S.string(),
      'few': S.string(),
      'many': S.string(),
      'other': S.string(),
    },
  );

  @override
  Object? executeSync(JsonMap args, ExecutionContext _) {
    final Object? count = args['value'] ?? args['count'];
    if (count is! num) return '';

    return Intl.pluralLogic(
      count,
      zero: args['zero'] as String?,
      one: args['one'] as String?,
      two: args['two'] as String?,
      few: args['few'] as String?,
      many: args['many'] as String?,
      other: args['other'] as String? ?? '',
    );
  }
}
