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

import 'package:collection/collection.dart';
import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;
import 'package:meta/meta.dart';

import '../core/validation_result.dart';
import '../primitives/uax31.dart';
import 'catalog_model.dart';
import 'type_definition.dart';

/// Direct canonical validator over [TypeDefinition], [ComponentDefinition],
/// [FunctionDefinition], and [SurfacePropertiesDefinition].
///
/// Validates wire payloads and resolved function arguments directly over the
/// canonical AST, falling back to `json_schema_builder` only for
/// [RawJsonSchemaType] legacy escape hatches.
@internal
final class CanonicalValidator {
  static const DeepCollectionEquality _deepEquals = DeepCollectionEquality();
  static final RegExp _uriPattern = RegExp(r'^[A-Za-z][A-Za-z0-9+.-]*:\S*$');
  static final RegExp _reservedKeyPattern = RegExp(r'^@([^@]|$)');
  static final RegExp _datePattern = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');
  static final RegExp _timePattern = RegExp(
    r'^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$',
  );
  static final RegExp _dateTimePattern = RegExp(
    r'^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?'
    r'(?:[Zz]|([+-])(\d{2}):(\d{2}))$',
  );
  static final RegExp _emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  static const ObjectType _accessibilitySchema = ObjectType(
    properties: [
      ParameterDefinition(name: 'label', type: StringType(dynamic: true)),
      ParameterDefinition(name: 'description', type: StringType(dynamic: true)),
    ],
  );
  static const ObjectType _childListTemplateSchema = ObjectType(
    properties: [
      ParameterDefinition(
        name: 'componentId',
        type: StringType(),
        required: true,
      ),
      ParameterDefinition(name: 'path', type: StringType(), required: true),
    ],
  );
  static const ObjectType _actionEventV1Schema = ObjectType(
    properties: [
      ParameterDefinition(name: 'name', type: StringType(), required: true),
      ParameterDefinition(name: 'userMessage', type: StringType(dynamic: true)),
      ParameterDefinition(
        name: 'context',
        type: ObjectType(additionalPropertiesType: AnyType(dynamic: true)),
      ),
    ],
  );
  static const ObjectType _actionEventV09Schema = ObjectType(
    properties: [
      ParameterDefinition(name: 'name', type: StringType(), required: true),
      ParameterDefinition(
        name: 'context',
        type: ObjectType(additionalPropertiesType: AnyType(dynamic: true)),
      ),
    ],
  );
  static const ObjectType _checkRuleV1Schema = ObjectType(
    properties: [
      ParameterDefinition(
        name: 'condition',
        type: UnionType(variants: [DataBindingType(), FunctionCallType()]),
        required: true,
      ),
      ParameterDefinition(name: 'message', type: StringType()),
    ],
  );
  static const ObjectType _checkRuleV09Schema = ObjectType(
    properties: [
      ParameterDefinition(
        name: 'condition',
        type: BooleanType(dynamic: true),
        required: true,
      ),
      ParameterDefinition(name: 'message', type: StringType(), required: true),
    ],
  );

  final Map<String, TypeDefinition> types;
  final bool atLeastV1;
  final Map<String, FunctionDefinition> functions;

  const CanonicalValidator({
    this.types = const {},
    required this.atLeastV1,
    this.functions = const {},
  });

  /// Validates a component's non-envelope properties against [definition].
  List<ValidationError> validateComponentProperties(
    ComponentDefinition definition,
    Map<String, Object?> target,
  ) => _ValidationRun(this).runObject(
    target,
    parameters: definition.parameters,
    atLeastOneOf: definition.atLeastOneOf,
    additionalFlag: true,
    additionalType: null,
  );

  /// Validates a function call's wire `args` map against [definition].
  List<ValidationError> validateFunctionArgs(
    FunctionDefinition definition,
    Map<String, Object?> args, {
    bool ignoreNullArgs = false,
    bool allowValidationResultInBool = false,
  }) =>
      _ValidationRun(
        this,
        allowValidationResultInBool: allowValidationResultInBool,
      ).runObject(
        args,
        parameters: definition.parameters,
        atLeastOneOf: definition.atLeastOneOf,
        additionalFlag: definition.additionalParameters,
        additionalType: definition.additionalParametersType,
        ignoreNullValues: ignoreNullArgs,
        unknownErrorType: ValidationErrorType.unevaluatedPropertyNotAllowed,
      );

  /// Validates a surface's `theme` / `surfaceProperties` object.
  List<ValidationError> validateSurfaceProperties(
    SurfacePropertiesDefinition definition,
    Map<String, Object?> value,
  ) => _ValidationRun(this).runObject(
    value,
    parameters: definition.properties,
    atLeastOneOf: null,
    additionalFlag: definition.additionalProperties,
    additionalType: definition.additionalPropertiesType,
  );

  /// Validates a v1.0 component `@accessibility` / `accessibility` object.
  List<ValidationError> validateAccessibility(Object? value) =>
      _ValidationRun(this).runValue(value, _accessibilitySchema);

  /// Validates a v1.0 component `@checks` / `checks` array.
  List<ValidationError> validateChecks(Object? value) => _ValidationRun(this)
      .runValue(
        value,
        ArrayType(items: atLeastV1 ? _checkRuleV1Schema : _checkRuleV09Schema),
      );

  /// Validates a v1.0 component `@metadata` / `metadata` object natively with
  /// full Unicode UAX #31 extension key support.
  List<ValidationError> validateMetadata(Object? value) {
    final run = _ValidationRun(this);
    if (value is! Map) {
      run.typeErr(const [], 'object', value);
      return run.errors;
    }
    for (final MapEntry<Object?, Object?> entry in value.entries) {
      final key = '${entry.key}';
      if (key != 'extensions') {
        run.err(ValidationErrorType.additionalPropertyNotAllowed, [
          key,
        ], 'Additional property "$key" is not allowed');
      } else if (entry.value is! Map) {
        run.typeErr(const ['extensions'], 'object', entry.value);
      } else {
        for (final Object? extKey in (entry.value! as Map).keys) {
          final k = '$extKey';
          if (!isValidUax31Identifier(k)) {
            run.err(ValidationErrorType.patternMismatch, [
              'extensions',
              k,
            ], 'Extension key "$k" must be a valid UAX #31 identifier');
          }
        }
      }
    }
    return run.errors;
  }

  /// Coerces [ValidationResult] objects in `DynamicBoolean` argument positions
  /// of [definition] using [coerceDynamicBoolean].
  static Map<String, dynamic> coerceFunctionArgs(
    FunctionDefinition definition,
    Map<String, TypeDefinition> types,
    Map<String, dynamic> args,
  ) {
    var changed = false;
    final coerced = <String, dynamic>{};
    for (final MapEntry<String, dynamic> entry in args.entries) {
      final TypeDefinition? type =
          definition.parameter(entry.key)?.type ??
          definition.additionalParametersType;
      final Object? result = type == null
          ? entry.value
          : _coerceTypeValue(type, types, entry.value, <String>{});
      if (!identical(result, entry.value)) changed = true;
      coerced[entry.key] = result;
    }
    return changed ? coerced : args;
  }

  static Object? _coerceTypeValue(
    TypeDefinition type,
    Map<String, TypeDefinition> types,
    Object? value,
    Set<String> visitedRefs,
  ) {
    switch (type) {
      case RefType(:final ref):
        if (!visitedRefs.add(ref)) return value;
        try {
          final TypeDefinition? target = types[ref];
          return target == null
              ? value
              : _coerceTypeValue(target, types, value, visitedRefs);
        } finally {
          visitedRefs.remove(ref);
        }
      case BooleanType(dynamic: true):
        return coerceDynamicBoolean(value);
      case ArrayType(:final items) when items != null && value is List:
        var changed = false;
        final out = <Object?>[
          for (final Object? item in value)
            () {
              final Object? c = _coerceTypeValue(
                items,
                types,
                item,
                visitedRefs,
              );
              if (!identical(c, item)) changed = true;
              return c;
            }(),
        ];
        return changed ? out : value;
      case ObjectType(:final additionalPropertiesType) when value is Map:
        var changed = false;
        final out = <String, Object?>{};
        for (final MapEntry<Object?, Object?> entry in value.entries) {
          final key = '${entry.key}';
          final TypeDefinition? propType =
              type.property(key)?.type ?? additionalPropertiesType;
          final Object? c = propType == null
              ? entry.value
              : _coerceTypeValue(propType, types, entry.value, visitedRefs);
          if (!identical(c, entry.value)) changed = true;
          out[key] = c;
        }
        return changed ? out : value;
      case UnionType(:final variants):
        for (final variant in variants) {
          final Object? c = _coerceTypeValue(
            variant,
            types,
            value,
            visitedRefs,
          );
          if (!identical(c, value)) return c;
        }
        return value;
      case StringType() ||
          NumberType() ||
          IntegerType() ||
          BooleanType() ||
          EnumType() ||
          ConstType() ||
          AnyType() ||
          ObjectType() ||
          ArrayType() ||
          DataBindingType() ||
          FunctionCallType() ||
          ChildType() ||
          ChildListType() ||
          ActionType() ||
          CheckRuleType() ||
          AccessibilityType() ||
          RawJsonSchemaType():
        return value;
    }
  }

  static bool _isValidationResultMap(Object? value) =>
      value is ValidationResult ||
      (value is Map &&
          value['valid'] is bool &&
          value.keys.every(
            (k) =>
                k == 'valid' ||
                k == 'message' ||
                k == 'code' ||
                k == 'severity',
          ));

  static bool _matchesFormat(String value, String format) => switch (format) {
    'uri' || 'iri' => _uriPattern.hasMatch(value),
    'date' => _isValidCalendarDate(value),
    'time' => _isValidRfc3339Time(value),
    'date-time' => _isValidRfc3339DateTime(value),
    'email' => _emailPattern.hasMatch(value),
    _ => true,
  };

  static bool _validDate(int y, int m, int d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    final dt = DateTime.utc(y, m, d);
    return dt.year == y && dt.month == m && dt.day == d;
  }

  static bool _validTime(
    int h,
    int min,
    int sec,
    String? sign,
    String? oh,
    String? om,
  ) =>
      h <= 23 &&
      min <= 59 &&
      sec <= 60 &&
      (sign == null || (int.parse(oh!) <= 23 && int.parse(om!) <= 59));

  static bool _isValidCalendarDate(String value) {
    final RegExpMatch? m = _datePattern.firstMatch(value);
    return m != null &&
        _validDate(
          int.parse(m.group(1)!),
          int.parse(m.group(2)!),
          int.parse(m.group(3)!),
        );
  }

  static bool _isValidRfc3339Time(String value) {
    final RegExpMatch? m = _timePattern.firstMatch(value);
    return m != null &&
        _validTime(
          int.parse(m.group(1)!),
          int.parse(m.group(2)!),
          int.parse(m.group(3)!),
          m.group(4),
          m.group(5),
          m.group(6),
        );
  }

  static bool _isValidRfc3339DateTime(String value) {
    final RegExpMatch? m = _dateTimePattern.firstMatch(value);
    return m != null &&
        _validDate(
          int.parse(m.group(1)!),
          int.parse(m.group(2)!),
          int.parse(m.group(3)!),
        ) &&
        _validTime(
          int.parse(m.group(4)!),
          int.parse(m.group(5)!),
          int.parse(m.group(6)!),
          m.group(7),
          m.group(8),
          m.group(9),
        );
  }
}

final class _ValidationRun {
  _ValidationRun(
    this.v, {
    this.allowValidationResultInBool = false,
    Set<String>? visitedRefs,
  }) : visitedRefs = visitedRefs ?? <String>{};

  final CanonicalValidator v;
  final bool allowValidationResultInBool;
  final Set<String> visitedRefs;
  final List<ValidationError> errors = [];

  bool get _v1 => v.atLeastV1;

  void err(ValidationErrorType type, List<String> path, String? details) =>
      errors.add(ValidationError(type, path: path, details: details));

  void typeErr(List<String> path, String expected, Object? actual) =>
      errors.add(
        ValidationError.typeMismatch(
          path: path,
          expectedType: expected,
          actualValue: actual,
        ),
      );

  List<ValidationError> runValue(Object? value, TypeDefinition type) {
    _validateValue(value, type, const []);
    return errors;
  }

  List<ValidationError> runObject(
    Map<Object?, Object?> map, {
    required List<ParameterDefinition> parameters,
    required List<List<String>>? atLeastOneOf,
    required bool additionalFlag,
    required TypeDefinition? additionalType,
    bool ignoreNullValues = false,
    ValidationErrorType unknownErrorType =
        ValidationErrorType.additionalPropertyNotAllowed,
  }) {
    _validateObjectProperties(
      map,
      parameters: parameters,
      atLeastOneOf: atLeastOneOf,
      additionalFlag: additionalFlag,
      additionalType: additionalType,
      path: const [],
      ignoreNullValues: ignoreNullValues,
      unknownErrorType: unknownErrorType,
    );
    return errors;
  }

  void _validateObjectProperties(
    Map<Object?, Object?> map, {
    required List<ParameterDefinition> parameters,
    required List<List<String>>? atLeastOneOf,
    required bool additionalFlag,
    required TypeDefinition? additionalType,
    required List<String> path,
    bool ignoreNullValues = false,
    ValidationErrorType unknownErrorType =
        ValidationErrorType.additionalPropertyNotAllowed,
  }) {
    final Set<String> unresolved = ignoreNullValues
        ? {
            for (final MapEntry<Object?, Object?> e in map.entries)
              if (e.value == null) '${e.key}',
          }
        : const <String>{};

    for (final p in parameters) {
      if (p.required &&
          !map.containsKey(p.name) &&
          !unresolved.contains(p.name)) {
        err(
          ValidationErrorType.requiredPropertyMissing,
          path,
          'Required property "${p.name}" is missing',
        );
      }
    }

    if (atLeastOneOf != null) {
      for (final List<String> group in atLeastOneOf) {
        final bool ok =
            group.any((k) => map.containsKey(k) && !unresolved.contains(k)) ||
            (ignoreNullValues && group.any(unresolved.contains));
        if (!ok) {
          err(
            ValidationErrorType.anyOfNotMet,
            path,
            'At least one of ${group.join(', ')} is required',
          );
        }
      }
    }

    final byName = <String, ParameterDefinition>{
      for (final p in parameters) p.name: p,
    };
    for (final MapEntry<Object?, Object?> entry in map.entries) {
      final key = '${entry.key}';
      if (unresolved.contains(key)) continue;
      final childPath = [...path, key];
      if (byName[key] case final ParameterDefinition declared) {
        _validateValue(entry.value, declared.type, childPath);
      } else if (additionalType != null) {
        _validateValue(entry.value, additionalType, childPath);
      } else if (!additionalFlag) {
        err(
          unknownErrorType,
          childPath,
          'Additional property "$key" is not allowed',
        );
      }
    }
  }

  void _validateValue(Object? value, TypeDefinition type, List<String> path) {
    if (type is RefType) {
      if (!visitedRefs.add(type.ref)) {
        err(
          ValidationErrorType.custom,
          path,
          "Cyclic local type reference '${type.ref}'",
        );
        return;
      }
      try {
        final TypeDefinition? resolved = v.types[type.ref];
        if (resolved == null) {
          err(
            ValidationErrorType.custom,
            path,
            "Unresolved local type reference '${type.ref}'",
          );
          return;
        }
        _validateValue(value, resolved, path);
      } finally {
        visitedRefs.remove(type.ref);
      }
      return;
    }

    if (type.isDynamic && value is Map) {
      final String? expectedRet = _expectedDynamicReturnType(type);
      if (_isValidDynamicExpr(value, expectedReturnType: expectedRet)) return;
      // Avoid hijacking literal pre-v1.0 ObjectTypes that declare `path`/`call`
      // or UnionTypes that may match another branch.
      final bool allowShortCircuit = switch (type) {
        ObjectType() =>
          _v1 ||
              (value.length == 1 &&
                  type.property('path') == null &&
                  type.property('call') == null),
        UnionType() => false,
        _ => true,
      };
      if (allowShortCircuit) {
        if (_looksLikeBinding(value)) {
          _validateDataBinding(value, path);
          return;
        }
        if (_looksLikeFunctionCall(value)) {
          _validateFunctionCall(value, path, expectedReturnType: expectedRet);
          return;
        }
      }
    }

    switch (type) {
      case StringType(
        :final allFormats,
        :final pattern,
        :final minLength,
        :final maxLength,
      ):
        if (value is! String) return typeErr(path, 'string', value);
        final int cp = value.runes.length;
        if (minLength != null && cp < minLength) {
          err(
            ValidationErrorType.minLengthNotMet,
            path,
            'String length $cp is less than minimum $minLength',
          );
        }
        if (maxLength != null && cp > maxLength) {
          err(
            ValidationErrorType.maxLengthExceeded,
            path,
            'String length $cp exceeds maximum $maxLength',
          );
        }
        if (pattern != null) {
          try {
            if (!RegExp(pattern, unicode: true).hasMatch(value)) {
              err(
                ValidationErrorType.patternMismatch,
                path,
                'String "$value" does not match pattern "$pattern"',
              );
            }
          } on FormatException catch (e) {
            err(
              ValidationErrorType.patternMismatch,
              path,
              'Invalid pattern "$pattern": ${e.message}',
            );
          }
        }
        if (allFormats.isNotEmpty &&
            !allFormats.any(
              (f) => CanonicalValidator._matchesFormat(value, f),
            )) {
          err(
            ValidationErrorType.formatInvalid,
            path,
            'String "$value" does not match format '
            '${allFormats.map((f) => '"$f"').join(' or ')}',
          );
        }

      case NumberType(:final min, :final max):
        if (value is! num) return typeErr(path, 'number', value);
        if (min != null && value < min) {
          err(
            ValidationErrorType.minimumNotMet,
            path,
            'Value $value is less than minimum $min',
          );
        }
        if (max != null && value > max) {
          err(
            ValidationErrorType.maximumExceeded,
            path,
            'Value $value exceeds maximum $max',
          );
        }

      case IntegerType(:final min, :final max):
        final bool isInt =
            value is int ||
            (value is double &&
                value.isFinite &&
                value == value.truncateToDouble());
        if (!isInt) return typeErr(path, 'integer', value);
        final numVal = value as num;
        if (min != null && numVal < min) {
          err(
            ValidationErrorType.minimumNotMet,
            path,
            'Value $numVal is less than minimum $min',
          );
        }
        if (max != null && numVal > max) {
          err(
            ValidationErrorType.maximumExceeded,
            path,
            'Value $numVal exceeds maximum $max',
          );
        }

      case BooleanType(:final dynamic):
        if (value is bool) return;
        if (dynamic &&
            allowValidationResultInBool &&
            CanonicalValidator._isValidationResultMap(value)) {
          return;
        }
        typeErr(path, 'boolean', value);

      case EnumType(:final values):
        if (!values.any((allowed) => allowed == value)) {
          err(
            ValidationErrorType.enumValueNotAllowed,
            path,
            'Value "$value" is not in allowed enum values $values',
          );
        }

      case ConstType(value: final expected):
        if (value != expected) {
          err(
            ValidationErrorType.constMismatch,
            path,
            'Expected constant value "$expected", got "$value"',
          );
        }

      case AnyType(:final dynamic, :final nullable):
        if (value == null) {
          if (!nullable) typeErr(path, 'non-null value', value);
          return;
        }
        if (value is Map && !dynamic) {
          if (_isValidDynamicExpr(value)) {
            err(
              ValidationErrorType.typeMismatch,
              path,
              'Dynamic expression is not allowed for static any type',
            );
          } else if (_v1) {
            _validateNoReservedKeys(value, path);
          }
        }

      case ObjectType(
        :final properties,
        :final additionalProperties,
        :final additionalPropertiesType,
        :final atLeastOneOf,
      ):
        if (value is! Map) return typeErr(path, 'object', value);
        _validateObjectProperties(
          value,
          parameters: properties,
          atLeastOneOf: atLeastOneOf,
          additionalFlag: additionalProperties,
          additionalType: additionalPropertiesType,
          path: path,
        );

      case ArrayType(
        :final items,
        :final minItems,
        :final maxItems,
        :final uniqueItems,
      ):
        if (value is! List) return typeErr(path, 'array', value);
        if (minItems != null && value.length < minItems) {
          err(
            ValidationErrorType.minItemsNotMet,
            path,
            'Array length ${value.length} is less than minimum $minItems',
          );
        }
        if (maxItems != null && value.length > maxItems) {
          err(
            ValidationErrorType.maxItemsExceeded,
            path,
            'Array length ${value.length} exceeds maximum $maxItems',
          );
        }
        if (uniqueItems) {
          for (var i = 0; i < value.length; i++) {
            for (int j = i + 1; j < value.length; j++) {
              if (CanonicalValidator._deepEquals.equals(value[i], value[j])) {
                err(ValidationErrorType.uniqueItemsViolated, [
                  ...path,
                  '$j',
                ], 'Array items must be unique');
                break;
              }
            }
          }
        }
        if (items != null) {
          for (var i = 0; i < value.length; i++) {
            _validateValue(value[i], items, [...path, '$i']);
          }
        }

      case UnionType(:final variants, :final exclusive):
        var matches = 0;
        for (final variant in variants) {
          final probe = _ValidationRun(
            v,
            allowValidationResultInBool: allowValidationResultInBool,
            visitedRefs: visitedRefs,
          ).._validateValue(value, variant, path);
          if (probe.errors.isEmpty) matches++;
        }
        if (exclusive && matches != 1) {
          err(
            ValidationErrorType.oneOfNotMet,
            path,
            'Value must match exactly one variant (matched $matches)',
          );
        } else if (!exclusive && matches == 0) {
          err(
            ValidationErrorType.anyOfNotMet,
            path,
            'Value did not match any allowed union variant',
          );
        }

      case DataBindingType():
        _validateDataBinding(value, path);
      case FunctionCallType():
        _validateFunctionCall(value, path);
      case ChildType():
        if (value is! String) typeErr(path, 'string', value);
      case ChildListType():
        if (value is List) {
          for (var i = 0; i < value.length; i++) {
            if (value[i] is! String) {
              typeErr([...path, '$i'], 'string', value[i]);
            }
          }
        } else if (value is Map) {
          _validateValue(
            value,
            CanonicalValidator._childListTemplateSchema,
            path,
          );
        } else {
          typeErr(path, 'ChildList', value);
        }
      case ActionType():
        if (value is! Map) return typeErr(path, 'Action', value);
        final bool hasEvent = value.containsKey('event');
        final bool hasFn = value.containsKey('functionCall');
        if (hasEvent == hasFn || value.length != 1) {
          err(
            ValidationErrorType.oneOfNotMet,
            path,
            'Action must have exactly one of "event" or "functionCall"',
          );
          return;
        }
        if (hasEvent) {
          _validateValue(
            value['event'],
            _v1
                ? CanonicalValidator._actionEventV1Schema
                : CanonicalValidator._actionEventV09Schema,
            [...path, 'event'],
          );
        } else {
          _validateFunctionCall(value['functionCall'], [
            ...path,
            'functionCall',
          ]);
        }
      case CheckRuleType():
        _validateValue(
          value,
          _v1
              ? CanonicalValidator._checkRuleV1Schema
              : CanonicalValidator._checkRuleV09Schema,
          path,
        );
      case AccessibilityType():
        _validateValue(value, CanonicalValidator._accessibilitySchema, path);
      case RawJsonSchemaType(:final schema):
        for (final ValidationError e in Schema.fromMap(
          schema,
        ).validateSync(value)) {
          err(e.error, [...path, ...e.path], e.details);
        }
      case RefType():
        break;
    }
  }

  bool _looksLikeBinding(Map<Object?, Object?> value) =>
      _v1 ? value.containsKey('@path') : value.containsKey('path');

  bool _looksLikeFunctionCall(Map<Object?, Object?> value) =>
      _v1 ? value.containsKey('@call') : value.containsKey('call');

  bool _isValidDynamicExpr(Object? value, {String? expectedReturnType}) {
    if (value is! Map) return false;
    final probe = _ValidationRun(v, visitedRefs: visitedRefs);
    if (_looksLikeBinding(value)) {
      probe._validateDataBinding(value, const []);
      return probe.errors.isEmpty;
    }
    if (_looksLikeFunctionCall(value)) {
      probe._validateFunctionCall(
        value,
        const [],
        expectedReturnType: expectedReturnType,
      );
      return probe.errors.isEmpty;
    }
    return false;
  }

  static String? _expectedDynamicReturnType(TypeDefinition type) =>
      switch (type) {
        StringType() => 'string',
        NumberType() || IntegerType() => 'number',
        BooleanType() => 'boolean',
        ArrayType() => 'array',
        ObjectType() => 'object',
        _ => null,
      };

  void _validateDataBinding(Object? value, List<String> path) {
    final key = _v1 ? '@path' : 'path';
    if (value is! Map) return typeErr(path, 'DataBinding', value);
    if (!value.containsKey(key)) {
      err(
        ValidationErrorType.requiredPropertyMissing,
        path,
        'Required property "$key" is missing',
      );
    } else if (value[key] is! String) {
      typeErr([...path, key], 'string', value[key]);
    }
    for (final Object? k in value.keys) {
      if (k != key) {
        err(ValidationErrorType.additionalPropertyNotAllowed, [
          ...path,
          '$k',
        ], 'Unexpected property "$k" on DataBinding');
      }
    }
  }

  void _validateFunctionCall(
    Object? value,
    List<String> path, {
    String? expectedReturnType,
  }) {
    if (value is! Map) return typeErr(path, 'FunctionCall', value);
    final callKey = _v1 ? '@call' : 'call';
    final Object? name = value[callKey];
    if (name is! String || name.isEmpty) {
      err(
        value.containsKey(callKey)
            ? ValidationErrorType.typeMismatch
            : ValidationErrorType.requiredPropertyMissing,
        path,
        'FunctionCall requires a non-empty string "$callKey"',
      );
      return;
    }
    if (value.containsKey('args') && value['args'] is! Map) {
      typeErr([...path, 'args'], 'object', value['args']);
    }
    if (_v1) {
      if (value.containsKey('catalogId') &&
          (value['catalogId'] is! String ||
              (value['catalogId']! as String).isEmpty)) {
        typeErr([...path, 'catalogId'], 'non-empty string', value['catalogId']);
      }
      for (final Object? k in value.keys) {
        if (k != '@call' && k != 'catalogId' && k != 'args') {
          err(ValidationErrorType.additionalPropertyNotAllowed, [
            ...path,
            '$k',
          ], 'Unexpected property "$k" on FunctionCall');
        }
      }
      return;
    }
    if (value.containsKey('returnType')) {
      final Object? rt = value['returnType'];
      if (rt is! String) {
        typeErr([...path, 'returnType'], 'string', rt);
      } else if (expectedReturnType != null && rt != expectedReturnType) {
        err(ValidationErrorType.constMismatch, [
          ...path,
          'returnType',
        ], 'Expected returnType "$expectedReturnType", got "$rt"');
      }
    }
    if (v.functions.isNotEmpty) {
      final FunctionDefinition? fn = v.functions[name];
      if (fn == null) {
        err(ValidationErrorType.oneOfNotMet, path, "Unknown function '$name'");
        return;
      }
      final bool reqArgs =
          fn.requiredParameters.isNotEmpty ||
          (fn.atLeastOneOf?.isNotEmpty ?? false);
      if (reqArgs && !value.containsKey('args')) {
        err(
          ValidationErrorType.requiredPropertyMissing,
          path,
          'Required property "args" is missing',
        );
      }
      if (expectedReturnType != null &&
          fn.returnType.returnType != A2uiReturnType.any &&
          fn.returnType.returnType.jsonValue != expectedReturnType) {
        err(
          ValidationErrorType.constMismatch,
          path,
          "Function '$name' returns '${fn.returnType.returnType.jsonValue}', "
          "expected '$expectedReturnType'",
        );
      }
    }
    for (final Object? k in value.keys) {
      if (k != 'call' && k != 'args' && k != 'returnType') {
        err(ValidationErrorType.unevaluatedPropertyNotAllowed, [
          ...path,
          '$k',
        ], 'Unexpected property "$k" on FunctionCall');
      }
    }
  }

  void _validateNoReservedKeys(Map<Object?, Object?> map, List<String> path) {
    for (final MapEntry<Object?, Object?> e in map.entries) {
      final key = '${e.key}';
      if (CanonicalValidator._reservedKeyPattern.hasMatch(key)) {
        err(ValidationErrorType.additionalPropertyNotAllowed, [
          ...path,
          key,
        ], 'Reserved "@"-prefixed key "$key" is not allowed in plain objects');
      }
    }
  }
}
