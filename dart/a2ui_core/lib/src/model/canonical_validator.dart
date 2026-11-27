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
/// Validates wire payloads and resolved function arguments without allocating
/// JSON Schema documents, avoiding `json_schema_builder` workarounds (such as
/// Unicode `\p{XID_Start}` and URI format quirks) and falling back to
/// `json_schema_builder` only for [RawJsonSchemaType] legacy escape hatches.
@internal
final class CanonicalValidator {
  static const DeepCollectionEquality _deepEquals = DeepCollectionEquality();
  static final RegExp _uriPattern = RegExp(r'^[A-Za-z][A-Za-z0-9+.-]*:\S*$');
  static final RegExp _reservedKeyPattern = RegExp(r'^@([^@]|$)');
  static final RegExp _datePattern = RegExp(r'^\d{4}-\d{2}-\d{2}$');
  static final RegExp _timePattern = RegExp(
    r'^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$',
  );
  static final RegExp _dateTimePattern = RegExp(
    r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$',
  );
  static final RegExp _emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  final Map<String, TypeDefinition> types;
  final bool atLeastV1;
  final Map<String, FunctionDefinition> functions;

  const CanonicalValidator({
    this.types = const {},
    required this.atLeastV1,
    this.functions = const {},
  });

  /// Validates a component's non-envelope properties against [definition].
  ///
  /// Unknown-property enforcement is left to `PayloadValidator` so
  /// `ValidationConfig.allowUnknownElements` and component-level envelope rules
  /// keep identical behavior.
  List<ValidationError> validateComponentProperties(
    ComponentDefinition definition,
    Map<String, Object?> target,
  ) {
    final errors = <ValidationError>[];
    for (final ParameterDefinition param in definition.parameters) {
      if (param.required && !target.containsKey(param.name)) {
        errors.add(
          ValidationError(
            ValidationErrorType.requiredPropertyMissing,
            path: const [],
            details: 'Required property "${param.name}" is missing',
          ),
        );
      }
    }
    _checkAtLeastOneOf(definition.atLeastOneOf, target, const [], errors);
    for (final MapEntry<String, Object?> entry in target.entries) {
      final ParameterDefinition? param = definition.parameter(entry.key);
      if (param == null) continue;
      _validateValue(
        entry.value,
        param.type,
        <String>[entry.key],
        errors,
        allowValidationResultInBool: false,
      );
    }
    return errors;
  }

  /// Validates a function call's wire `args` map against [definition].
  ///
  /// When [ignoreNullArgs] is `true` (runtime `Catalog.invoke` /
  /// `argumentErrors`), null argument entries are skipped as unresolved
  /// bindings, and when [allowValidationResultInBool] is `true`,
  /// `{valid: bool}` maps are accepted in `DynamicBoolean` positions.
  List<ValidationError> validateFunctionArgs(
    FunctionDefinition definition,
    Map<String, Object?> args, {
    bool ignoreNullArgs = false,
    bool allowValidationResultInBool = false,
  }) {
    final errors = <ValidationError>[];
    final Set<String> unresolved = ignoreNullArgs
        ? {
            for (final MapEntry<String, Object?> entry in args.entries)
              if (entry.value == null) entry.key,
          }
        : const <String>{};

    for (final ParameterDefinition param in definition.parameters) {
      if (param.required &&
          !args.containsKey(param.name) &&
          !unresolved.contains(param.name)) {
        errors.add(
          ValidationError(
            ValidationErrorType.requiredPropertyMissing,
            path: const [],
            details: 'Required property "${param.name}" is missing',
          ),
        );
      }
    }

    if (definition.atLeastOneOf != null) {
      final effective = <String, Object?>{
        for (final MapEntry<String, Object?> entry in args.entries)
          if (!unresolved.contains(entry.key)) entry.key: entry.value,
      };
      // In runtime invoke mode, a group whose member is unresolved (null)
      // should not fail prematurely.
      for (final List<String> group in definition.atLeastOneOf!) {
        final bool satisfied =
            group.any(effective.containsKey) ||
            (ignoreNullArgs && group.any(unresolved.contains));
        if (!satisfied) {
          errors.add(
            ValidationError(
              ValidationErrorType.anyOfNotMet,
              path: const [],
              details: 'At least one of ${group.join(', ')} is required',
            ),
          );
        }
      }
    }

    for (final MapEntry<String, Object?> entry in args.entries) {
      if (unresolved.contains(entry.key)) continue;
      final ParameterDefinition? param = definition.parameter(entry.key);
      if (param != null) {
        _validateValue(
          entry.value,
          param.type,
          <String>[entry.key],
          errors,
          allowValidationResultInBool: allowValidationResultInBool,
        );
      } else if (definition.additionalParametersType != null) {
        _validateValue(
          entry.value,
          definition.additionalParametersType!,
          <String>[entry.key],
          errors,
          allowValidationResultInBool: allowValidationResultInBool,
        );
      } else if (!definition.additionalParameters) {
        errors.add(
          ValidationError(
            ValidationErrorType.unevaluatedPropertyNotAllowed,
            path: <String>[entry.key],
            details: 'Additional property "${entry.key}" is not allowed',
          ),
        );
      }
    }
    return errors;
  }

  /// Validates a surface's `theme` / `surfaceProperties` object.
  List<ValidationError> validateSurfaceProperties(
    SurfacePropertiesDefinition definition,
    Map<String, Object?> value,
  ) {
    final errors = <ValidationError>[];
    for (final ParameterDefinition param in definition.properties) {
      if (param.required && !value.containsKey(param.name)) {
        errors.add(
          ValidationError(
            ValidationErrorType.requiredPropertyMissing,
            path: const [],
            details: 'Required property "${param.name}" is missing',
          ),
        );
      }
    }
    for (final MapEntry<String, Object?> entry in value.entries) {
      ParameterDefinition? declared;
      for (final ParameterDefinition p in definition.properties) {
        if (p.name == entry.key) {
          declared = p;
          break;
        }
      }
      if (declared != null) {
        _validateValue(
          entry.value,
          declared.type,
          <String>[entry.key],
          errors,
          allowValidationResultInBool: false,
        );
      } else if (definition.additionalPropertiesType != null) {
        _validateValue(
          entry.value,
          definition.additionalPropertiesType!,
          <String>[entry.key],
          errors,
          allowValidationResultInBool: false,
        );
      } else if (!definition.additionalProperties) {
        errors.add(
          ValidationError(
            ValidationErrorType.additionalPropertyNotAllowed,
            path: <String>[entry.key],
            details: 'Additional property "${entry.key}" is not allowed',
          ),
        );
      }
    }
    return errors;
  }

  /// Validates a v1.0 component `@accessibility` / `accessibility` object.
  List<ValidationError> validateAccessibility(Object? value) {
    final errors = <ValidationError>[];
    _validateAccessibility(value, const [], errors);
    return errors;
  }

  /// Validates a v1.0 component `@checks` / `checks` array.
  List<ValidationError> validateChecks(Object? value) {
    final errors = <ValidationError>[];
    if (value is! List) {
      errors.add(
        ValidationError.typeMismatch(
          path: const [],
          expectedType: 'array',
          actualValue: value,
        ),
      );
      return errors;
    }
    for (var i = 0; i < value.length; i++) {
      _validateCheckRule(value[i], <String>['$i'], errors);
    }
    return errors;
  }

  /// Validates a v1.0 component `@metadata` / `metadata` object natively with
  /// full Unicode UAX #31 extension key support.
  List<ValidationError> validateMetadata(Object? value) {
    final errors = <ValidationError>[];
    if (value is! Map) {
      errors.add(
        ValidationError.typeMismatch(
          path: const [],
          expectedType: 'object',
          actualValue: value,
        ),
      );
      return errors;
    }
    for (final MapEntry<Object?, Object?> entry in value.entries) {
      final key = '${entry.key}';
      if (key != 'extensions') {
        errors.add(
          ValidationError(
            ValidationErrorType.additionalPropertyNotAllowed,
            path: <String>[key],
            details: 'Additional property "$key" is not allowed',
          ),
        );
      } else if (entry.value is! Map) {
        errors.add(
          ValidationError.typeMismatch(
            path: const ['extensions'],
            expectedType: 'object',
            actualValue: entry.value,
          ),
        );
      }
    }
    return errors;
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
      final ParameterDefinition? param = definition.parameter(entry.key);
      final TypeDefinition? type =
          param?.type ?? definition.additionalParametersType;
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
        final TypeDefinition? target = types[ref];
        return target == null
            ? value
            : _coerceTypeValue(target, types, value, visitedRefs);
      case BooleanType(dynamic: true):
        return coerceDynamicBoolean(value);
      case ArrayType(:final items) when items != null && value is List:
        var changed = false;
        final out = <Object?>[];
        for (final Object? item in value) {
          final Object? coerced = _coerceTypeValue(
            items,
            types,
            item,
            visitedRefs,
          );
          if (!identical(coerced, item)) changed = true;
          out.add(coerced);
        }
        return changed ? out : value;
      case ObjectType(:final properties, :final additionalPropertiesType)
          when value is Map:
        var changed = false;
        final out = <String, Object?>{};
        for (final MapEntry<Object?, Object?> entry in value.entries) {
          final key = '${entry.key}';
          ParameterDefinition? declared;
          for (final p in properties) {
            if (p.name == key) {
              declared = p;
              break;
            }
          }
          final TypeDefinition? propType =
              declared?.type ?? additionalPropertiesType;
          final Object? coerced = propType == null
              ? entry.value
              : _coerceTypeValue(propType, types, entry.value, visitedRefs);
          if (!identical(coerced, entry.value)) changed = true;
          out[key] = coerced;
        }
        return changed ? out : value;
      default:
        return value;
    }
  }

  // ---------------------------------------------------------------------------
  // Core recursive value validation
  // ---------------------------------------------------------------------------

  void _validateValue(
    Object? value,
    TypeDefinition type,
    List<String> path,
    List<ValidationError> errors, {
    required bool allowValidationResultInBool,
    Set<String>? visitedRefs,
  }) {
    if (type is RefType) {
      final Set<String> seen = visitedRefs ?? <String>{};
      if (!seen.add(type.ref)) return;
      final TypeDefinition? target = types[type.ref];
      if (target == null) {
        errors.add(
          ValidationError(
            ValidationErrorType.refResolutionError,
            path: path,
            details: "Unresolved local type reference '${type.ref}'",
          ),
        );
        return;
      }
      _validateValue(
        value,
        target,
        path,
        errors,
        allowValidationResultInBool: allowValidationResultInBool,
        visitedRefs: seen,
      );
      return;
    }

    if (type.isDynamic &&
        type is! DataBindingType &&
        type is! FunctionCallType &&
        type is! AnyType) {
      final String? expectedReturn = _expectedReturnTypeFor(type);
      if (_isValidDynamicExpr(value, expectedReturnType: expectedReturn)) {
        return;
      }
      // If it looks like a malformed binding or function call, validate it
      // specifically so the error is actionable.
      if (_looksLikeBinding(value)) {
        _validateDataBinding(value, path, errors);
        return;
      }
      if (_looksLikeFunctionCall(value)) {
        _validateFunctionCall(
          value,
          path,
          errors,
          expectedReturnType: expectedReturn,
        );
        return;
      }
    }

    switch (type) {
      case StringType(
        :final formats,
        :final pattern,
        :final minLength,
        :final maxLength,
      ):
        if (value is! String) {
          errors.add(
            ValidationError.typeMismatch(
              path: path,
              expectedType: 'string',
              actualValue: value,
            ),
          );
          return;
        }
        if (minLength != null && value.length < minLength) {
          errors.add(
            ValidationError(
              ValidationErrorType.minLengthNotMet,
              path: path,
              details: 'String length ${value.length} is less than $minLength',
            ),
          );
        }
        if (maxLength != null && value.length > maxLength) {
          errors.add(
            ValidationError(
              ValidationErrorType.maxLengthExceeded,
              path: path,
              details: 'String length ${value.length} exceeds $maxLength',
            ),
          );
        }
        if (pattern != null) {
          final regex = RegExp(pattern, unicode: true);
          if (!regex.hasMatch(value)) {
            errors.add(
              ValidationError(
                ValidationErrorType.patternMismatch,
                path: path,
                details: 'String "$value" does not match pattern "$pattern"',
              ),
            );
          }
        }
        if (formats != null && formats.isNotEmpty) {
          final bool matched = formats.any((f) => _matchesFormat(value, f));
          if (!matched) {
            errors.add(
              ValidationError(
                ValidationErrorType.formatInvalid,
                path: path,
                details:
                    'String "$value" does not match format '
                    '${formats.join(' | ')}',
              ),
            );
          }
        }

      case NumberType(:final min, :final max):
        if (value is! num) {
          errors.add(
            ValidationError.typeMismatch(
              path: path,
              expectedType: 'number',
              actualValue: value,
            ),
          );
          return;
        }
        if (min != null && value < min) {
          errors.add(
            ValidationError(
              ValidationErrorType.minimumNotMet,
              path: path,
              details: 'Value $value is less than minimum $min',
            ),
          );
        }
        if (max != null && value > max) {
          errors.add(
            ValidationError(
              ValidationErrorType.maximumExceeded,
              path: path,
              details: 'Value $value exceeds maximum $max',
            ),
          );
        }

      case IntegerType(:final min, :final max):
        if (value is! int) {
          errors.add(
            ValidationError.typeMismatch(
              path: path,
              expectedType: 'integer',
              actualValue: value,
            ),
          );
          return;
        }
        if (min != null && value < min) {
          errors.add(
            ValidationError(
              ValidationErrorType.minimumNotMet,
              path: path,
              details: 'Value $value is less than minimum $min',
            ),
          );
        }
        if (max != null && value > max) {
          errors.add(
            ValidationError(
              ValidationErrorType.maximumExceeded,
              path: path,
              details: 'Value $value exceeds maximum $max',
            ),
          );
        }

      case BooleanType():
        if (value is bool) return;
        if (allowValidationResultInBool && _isValidityMap(value)) return;
        errors.add(
          ValidationError.typeMismatch(
            path: path,
            expectedType: 'boolean',
            actualValue: value,
          ),
        );

      case EnumType(:final values):
        if (!values.any((v) => v == value)) {
          errors.add(
            ValidationError(
              ValidationErrorType.enumValueNotAllowed,
              path: path,
              details: 'Value "$value" is not in allowed enum values $values',
            ),
          );
        }

      case ConstType(value: final Object? expected):
        if (value != expected) {
          errors.add(
            ValidationError(
              ValidationErrorType.constMismatch,
              path: path,
              details: 'Value "$value" does not match const "$expected"',
            ),
          );
        }

      case AnyType(:final dynamic, :final nullable):
        if (value == null) {
          if (!nullable) {
            errors.add(
              ValidationError.typeMismatch(
                path: path,
                expectedType: 'non-null',
                actualValue: value,
              ),
            );
          }
          return;
        }
        if (dynamic && !nullable) {
          // Matches common_types.json#/$defs/DynamicValue.
          if (value is String ||
              value is num ||
              value is bool ||
              value is List) {
            return;
          }
          if (value is Map) {
            if (_isValidDynamicExpr(value)) return;
            if (_looksLikeBinding(value)) {
              _validateDataBinding(value, path, errors);
              return;
            }
            if (_looksLikeFunctionCall(value)) {
              _validateFunctionCall(value, path, errors);
              return;
            }
            if (!atLeastV1) {
              // v0.9 DynamicValue forbids plain objects.
              errors.add(
                ValidationError.typeMismatch(
                  path: path,
                  expectedType: 'DynamicValue',
                  actualValue: value,
                ),
              );
              return;
            }
            // v1.0 DynamicValue accepts plain objects without single-@ keys.
            for (final Object? key in value.keys) {
              if (key is String && _reservedKeyPattern.hasMatch(key)) {
                errors.add(
                  ValidationError(
                    ValidationErrorType.propertyNamesInvalid,
                    path: [...path, key],
                    details: 'Reserved directive key "$key" not allowed here',
                  ),
                );
              }
            }
            return;
          }
        }

      case ObjectType(
        :final properties,
        :final additionalProperties,
        :final additionalPropertiesType,
        :final atLeastOneOf,
      ):
        if (value is! Map) {
          errors.add(
            ValidationError.typeMismatch(
              path: path,
              expectedType: 'object',
              actualValue: value,
            ),
          );
          return;
        }
        final map = <String, Object?>{
          for (final MapEntry<Object?, Object?> e in value.entries)
            '${e.key}': e.value,
        };
        for (final prop in properties) {
          if (prop.required && !map.containsKey(prop.name)) {
            errors.add(
              ValidationError(
                ValidationErrorType.requiredPropertyMissing,
                path: path,
                details: 'Required property "${prop.name}" is missing',
              ),
            );
          }
        }
        _checkAtLeastOneOf(atLeastOneOf, map, path, errors);
        for (final MapEntry<String, Object?> entry in map.entries) {
          final ParameterDefinition? prop = type.property(entry.key);
          if (prop != null) {
            _validateValue(
              entry.value,
              prop.type,
              [...path, entry.key],
              errors,
              allowValidationResultInBool: allowValidationResultInBool,
            );
          } else if (additionalPropertiesType != null) {
            _validateValue(
              entry.value,
              additionalPropertiesType,
              [...path, entry.key],
              errors,
              allowValidationResultInBool: allowValidationResultInBool,
            );
          } else if (!additionalProperties) {
            errors.add(
              ValidationError(
                ValidationErrorType.additionalPropertyNotAllowed,
                path: [...path, entry.key],
                details: 'Additional property "${entry.key}" is not allowed',
              ),
            );
          }
        }

      case ArrayType(
        :final items,
        :final minItems,
        :final maxItems,
        :final uniqueItems,
      ):
        if (value is! List) {
          errors.add(
            ValidationError.typeMismatch(
              path: path,
              expectedType: 'array',
              actualValue: value,
            ),
          );
          return;
        }
        if (minItems != null && value.length < minItems) {
          errors.add(
            ValidationError(
              ValidationErrorType.minItemsNotMet,
              path: path,
              details: 'Array length ${value.length} is less than $minItems',
            ),
          );
        }
        if (maxItems != null && value.length > maxItems) {
          errors.add(
            ValidationError(
              ValidationErrorType.maxItemsExceeded,
              path: path,
              details: 'Array length ${value.length} exceeds $maxItems',
            ),
          );
        }
        if (uniqueItems) {
          for (var i = 0; i < value.length; i++) {
            for (int j = i + 1; j < value.length; j++) {
              if (_deepEquals.equals(value[i], value[j])) {
                errors.add(
                  ValidationError(
                    ValidationErrorType.uniqueItemsViolated,
                    path: [...path, '$j'],
                    details: 'Duplicate array item at index $j',
                  ),
                );
                break;
              }
            }
          }
        }
        if (items != null) {
          for (var i = 0; i < value.length; i++) {
            _validateValue(
              value[i],
              items,
              [...path, '$i'],
              errors,
              allowValidationResultInBool: allowValidationResultInBool,
            );
          }
        }

      case UnionType(:final variants, :final exclusive):
        var matches = 0;
        for (final variant in variants) {
          final branchErrors = <ValidationError>[];
          _validateValue(
            value,
            variant,
            path,
            branchErrors,
            allowValidationResultInBool: allowValidationResultInBool,
          );
          if (branchErrors.isEmpty) matches++;
        }
        if (exclusive) {
          if (matches != 1) {
            errors.add(
              ValidationError(
                ValidationErrorType.oneOfNotMet,
                path: path,
                details:
                    'Expected value to match exactly one variant '
                    '(matched $matches)',
              ),
            );
          }
        } else {
          if (matches == 0) {
            errors.add(
              ValidationError(
                ValidationErrorType.anyOfNotMet,
                path: path,
                details: 'Value matched none of the allowed variants',
              ),
            );
          }
        }

      case DataBindingType():
        _validateDataBinding(value, path, errors);

      case FunctionCallType():
        _validateFunctionCall(value, path, errors);

      case RefType():
        break; // Handled above.

      case ChildType():
        if (value is! String) {
          errors.add(
            ValidationError.typeMismatch(
              path: path,
              expectedType: 'string',
              actualValue: value,
            ),
          );
        }

      case ChildListType():
        _validateChildList(value, path, errors);

      case ActionType():
        _validateAction(value, path, errors);

      case CheckRuleType():
        _validateCheckRule(value, path, errors);

      case AccessibilityType():
        _validateAccessibility(value, path, errors);

      case RawJsonSchemaType(:final schema):
        final List<ValidationError> rawErrors = Schema.fromMap(schema)
            .validateSync(value, strictFormat: true);
        for (final err in rawErrors) {
          errors.add(
            ValidationError(
              err.error,
              path: [...path, ...err.path],
              details: err.details,
            ),
          );
        }
    }
  }

  // ---------------------------------------------------------------------------
  // Protocol common-type validators
  // ---------------------------------------------------------------------------

  String? _expectedReturnTypeFor(TypeDefinition type) => switch (type) {
    StringType() => 'string',
    NumberType() || IntegerType() => 'number',
    BooleanType() => 'boolean',
    ArrayType() => 'array',
    ObjectType() => 'object',
    _ => null,
  };

  bool _looksLikeBinding(Object? value) {
    if (value is! Map) return false;
    final key = atLeastV1 ? '@path' : 'path';
    return value.containsKey(key) && !value.containsKey('componentId');
  }

  bool _looksLikeFunctionCall(Object? value) {
    if (value is! Map) return false;
    final key = atLeastV1 ? '@call' : 'call';
    return value.containsKey(key);
  }

  bool _isValidDynamicExpr(Object? value, {String? expectedReturnType}) {
    if (value is! Map) return false;
    final bindingErrors = <ValidationError>[];
    if (_looksLikeBinding(value)) {
      _validateDataBinding(value, const [], bindingErrors);
      return bindingErrors.isEmpty;
    }
    if (_looksLikeFunctionCall(value)) {
      final callErrors = <ValidationError>[];
      _validateFunctionCall(
        value,
        const [],
        callErrors,
        expectedReturnType: expectedReturnType,
      );
      return callErrors.isEmpty;
    }
    return false;
  }

  void _validateDataBinding(
    Object? value,
    List<String> path,
    List<ValidationError> errors,
  ) {
    final pathKey = atLeastV1 ? '@path' : 'path';
    if (value is! Map) {
      errors.add(
        ValidationError.typeMismatch(
          path: path,
          expectedType: 'DataBinding',
          actualValue: value,
        ),
      );
      return;
    }
    if (value[pathKey] is! String) {
      errors.add(
        ValidationError(
          value.containsKey(pathKey)
              ? ValidationErrorType.typeMismatch
              : ValidationErrorType.requiredPropertyMissing,
          path: path,
          details: 'Required property "$pathKey" must be a string',
        ),
      );
    }
    for (final Object? key in value.keys) {
      if (key != pathKey) {
        errors.add(
          ValidationError(
            ValidationErrorType.additionalPropertyNotAllowed,
            path: [...path, '$key'],
            details: 'Additional property "$key" is not allowed in DataBinding',
          ),
        );
      }
    }
  }

  void _validateFunctionCall(
    Object? value,
    List<String> path,
    List<ValidationError> errors, {
    String? expectedReturnType,
  }) {
    final callKey = atLeastV1 ? '@call' : 'call';
    if (value is! Map) {
      errors.add(
        ValidationError.typeMismatch(
          path: path,
          expectedType: 'FunctionCall',
          actualValue: value,
        ),
      );
      return;
    }
    final Object? name = value[callKey];
    if (name is! String) {
      errors.add(
        ValidationError(
          ValidationErrorType.requiredPropertyMissing,
          path: path,
          details: 'Required property "$callKey" must be a string',
        ),
      );
      return;
    }
    if (value.containsKey('args') && value['args'] is! Map) {
      errors.add(
        ValidationError.typeMismatch(
          path: [...path, 'args'],
          expectedType: 'object',
          actualValue: value['args'],
        ),
      );
    }

    if (atLeastV1) {
      if (name == '@index') {
        for (final Object? k in value.keys) {
          if (k != '@call' && k != 'args') {
            errors.add(
              ValidationError(
                ValidationErrorType.unevaluatedPropertyNotAllowed,
                path: [...path, '$k'],
                details: 'Unexpected property "$k" on @index call',
              ),
            );
          }
        }
        if (value['args'] case final Map<Object?, Object?> indexArgs) {
          for (final MapEntry<Object?, Object?> e in indexArgs.entries) {
            if (e.key != 'offset') {
              errors.add(
                ValidationError(
                  ValidationErrorType.unevaluatedPropertyNotAllowed,
                  path: [...path, 'args', '${e.key}'],
                  details: 'Unexpected argument "${e.key}" on @index',
                ),
              );
            } else {
              _validateValue(
                e.value,
                const NumberType(dynamic: true),
                [...path, 'args', 'offset'],
                errors,
                allowValidationResultInBool: false,
              );
            }
          }
        }
        return;
      }
      for (final Object? k in value.keys) {
        if (k != '@call' && k != 'args' && k != 'catalogId') {
          errors.add(
            ValidationError(
              ValidationErrorType.unevaluatedPropertyNotAllowed,
              path: [...path, '$k'],
              details: 'Unexpected property "$k" on FunctionCall',
            ),
          );
        }
      }
      if (value.containsKey('catalogId') && value['catalogId'] is! String) {
        errors.add(
          ValidationError.typeMismatch(
            path: [...path, 'catalogId'],
            expectedType: 'string',
            actualValue: value['catalogId'],
          ),
        );
      }
    } else {
      // Pre-v1.0 FunctionCall validates call against catalog functions &
      // returnType.
      if (expectedReturnType != null &&
          value.containsKey('returnType') &&
          value['returnType'] != expectedReturnType) {
        errors.add(
          ValidationError(
            ValidationErrorType.constMismatch,
            path: [...path, 'returnType'],
            details:
                'Expected returnType "$expectedReturnType", got '
                '"${value['returnType']}"',
          ),
        );
      }
      if (functions.isNotEmpty) {
        final FunctionDefinition? fn = functions[name];
        if (fn == null) {
          errors.add(
            ValidationError(
              ValidationErrorType.oneOfNotMet,
              path: path,
              details: "Unknown function '$name'",
            ),
          );
          return;
        }
        final bool requiresArgs =
            fn.requiredParameters.isNotEmpty ||
            (fn.atLeastOneOf?.isNotEmpty ?? false);
        if (requiresArgs && !value.containsKey('args')) {
          errors.add(
            ValidationError(
              ValidationErrorType.requiredPropertyMissing,
              path: path,
              details: 'Required property "args" is missing',
            ),
          );
        }
        if (expectedReturnType != null &&
            fn.returnType.returnType != A2uiReturnType.any &&
            fn.returnType.returnType.jsonValue != expectedReturnType) {
          errors.add(
            ValidationError(
              ValidationErrorType.constMismatch,
              path: path,
              details:
                  "Function '$name' returns "
                  "'${fn.returnType.returnType.jsonValue}', expected "
                  "'$expectedReturnType'",
            ),
          );
        }
      }
      for (final Object? k in value.keys) {
        if (k != 'call' && k != 'args' && k != 'returnType') {
          errors.add(
            ValidationError(
              ValidationErrorType.unevaluatedPropertyNotAllowed,
              path: [...path, '$k'],
              details: 'Unexpected property "$k" on FunctionCall',
            ),
          );
        }
      }
    }
  }

  void _validateChildList(
    Object? value,
    List<String> path,
    List<ValidationError> errors,
  ) {
    if (value is List) {
      for (var i = 0; i < value.length; i++) {
        if (value[i] is! String) {
          errors.add(
            ValidationError.typeMismatch(
              path: [...path, '$i'],
              expectedType: 'string',
              actualValue: value[i],
            ),
          );
        }
      }
      return;
    }
    if (value is Map) {
      if (value['componentId'] is! String) {
        errors.add(
          ValidationError(
            value.containsKey('componentId')
                ? ValidationErrorType.typeMismatch
                : ValidationErrorType.requiredPropertyMissing,
            path: path,
            details: 'Required property "componentId" must be a string',
          ),
        );
      }
      if (value['path'] is! String) {
        errors.add(
          ValidationError(
            value.containsKey('path')
                ? ValidationErrorType.typeMismatch
                : ValidationErrorType.requiredPropertyMissing,
            path: path,
            details: 'Required property "path" must be a string',
          ),
        );
      }
      for (final Object? key in value.keys) {
        if (key != 'componentId' && key != 'path') {
          errors.add(
            ValidationError(
              ValidationErrorType.additionalPropertyNotAllowed,
              path: [...path, '$key'],
              details: 'Additional property "$key" is not allowed in ChildList',
            ),
          );
        }
      }
      return;
    }
    errors.add(
      ValidationError.typeMismatch(
        path: path,
        expectedType: 'ChildList',
        actualValue: value,
      ),
    );
  }

  void _validateAction(
    Object? value,
    List<String> path,
    List<ValidationError> errors,
  ) {
    if (value is! Map) {
      errors.add(
        ValidationError.typeMismatch(
          path: path,
          expectedType: 'Action',
          actualValue: value,
        ),
      );
      return;
    }
    final bool hasEvent = value.containsKey('event');
    final bool hasFn = value.containsKey('functionCall');
    if (hasEvent == hasFn || value.length != 1) {
      errors.add(
        ValidationError(
          ValidationErrorType.oneOfNotMet,
          path: path,
          details: 'Action must have exactly one of "event" or "functionCall"',
        ),
      );
      return;
    }
    if (hasEvent) {
      final Object? event = value['event'];
      if (event is! Map) {
        errors.add(
          ValidationError.typeMismatch(
            path: [...path, 'event'],
            expectedType: 'object',
            actualValue: event,
          ),
        );
        return;
      }
      if (event['name'] is! String) {
        errors.add(
          ValidationError(
            event.containsKey('name')
                ? ValidationErrorType.typeMismatch
                : ValidationErrorType.requiredPropertyMissing,
            path: [...path, 'event'],
            details: 'Required property "name" is missing',
          ),
        );
      }
      for (final MapEntry<Object?, Object?> e in event.entries) {
        final key = '${e.key}';
        if (key == 'name') continue;
        if (key == 'userMessage' && atLeastV1) {
          _validateValue(
            e.value,
            const StringType(dynamic: true),
            [...path, 'event', 'userMessage'],
            errors,
            allowValidationResultInBool: false,
          );
        } else if (key == 'context') {
          if (e.value is! Map) {
            errors.add(
              ValidationError.typeMismatch(
                path: [...path, 'event', 'context'],
                expectedType: 'object',
                actualValue: e.value,
              ),
            );
          } else {
            for (final MapEntry<Object?, Object?> ctx
                in (e.value! as Map).entries) {
              _validateValue(
                ctx.value,
                const AnyType(dynamic: true),
                [...path, 'event', 'context', '${ctx.key}'],
                errors,
                allowValidationResultInBool: false,
              );
            }
          }
        } else {
          errors.add(
            ValidationError(
              ValidationErrorType.additionalPropertyNotAllowed,
              path: [...path, 'event', key],
              details: 'Additional property "$key" is not allowed in event',
            ),
          );
        }
      }
    } else {
      _validateFunctionCall(value['functionCall'], [
        ...path,
        'functionCall',
      ], errors);
    }
  }

  void _validateCheckRule(
    Object? value,
    List<String> path,
    List<ValidationError> errors,
  ) {
    if (value is! Map) {
      errors.add(
        ValidationError.typeMismatch(
          path: path,
          expectedType: 'CheckRule',
          actualValue: value,
        ),
      );
      return;
    }
    if (!value.containsKey('condition')) {
      errors.add(
        ValidationError(
          ValidationErrorType.requiredPropertyMissing,
          path: path,
          details: 'Required property "condition" is missing',
        ),
      );
    } else if (atLeastV1) {
      final Object? cond = value['condition'];
      if (!_isValidDynamicExpr(cond)) {
        errors.add(
          ValidationError(
            ValidationErrorType.oneOfNotMet,
            path: [...path, 'condition'],
            details:
                'CheckRule condition must be a DataBinding or FunctionCall',
          ),
        );
      }
    } else {
      _validateValue(
        value['condition'],
        const BooleanType(dynamic: true),
        [...path, 'condition'],
        errors,
        allowValidationResultInBool: false,
      );
    }

    if (!atLeastV1 && !value.containsKey('message')) {
      errors.add(
        ValidationError(
          ValidationErrorType.requiredPropertyMissing,
          path: path,
          details: 'Required property "message" is missing',
        ),
      );
    } else if (value.containsKey('message') && value['message'] is! String) {
      errors.add(
        ValidationError.typeMismatch(
          path: [...path, 'message'],
          expectedType: 'string',
          actualValue: value['message'],
        ),
      );
    }

    for (final Object? key in value.keys) {
      if (key != 'condition' && key != 'message') {
        errors.add(
          ValidationError(
            ValidationErrorType.additionalPropertyNotAllowed,
            path: [...path, '$key'],
            details: 'Additional property "$key" is not allowed in CheckRule',
          ),
        );
      }
    }
  }

  void _validateAccessibility(
    Object? value,
    List<String> path,
    List<ValidationError> errors,
  ) {
    if (value is! Map) {
      errors.add(
        ValidationError.typeMismatch(
          path: path,
          expectedType: 'AccessibilityAttributes',
          actualValue: value,
        ),
      );
      return;
    }
    for (final MapEntry<Object?, Object?> entry in value.entries) {
      final key = '${entry.key}';
      switch (key) {
        case 'label' || 'description':
          _validateValue(
            entry.value,
            const StringType(dynamic: true),
            [...path, key],
            errors,
            allowValidationResultInBool: false,
          );
        case 'live' when atLeastV1:
          _validateValue(
            entry.value,
            const EnumType(values: ['off', 'polite', 'assertive']),
            [...path, key],
            errors,
            allowValidationResultInBool: false,
          );
        case 'hidden' when atLeastV1:
          _validateValue(
            entry.value,
            const BooleanType(dynamic: true),
            [...path, key],
            errors,
            allowValidationResultInBool: false,
          );
        default:
          if (atLeastV1) {
            errors.add(
              ValidationError(
                ValidationErrorType.additionalPropertyNotAllowed,
                path: [...path, key],
                details:
                    'Additional property "$key" is not allowed in '
                    'AccessibilityAttributes',
              ),
            );
          }
      }
    }
  }

  void _checkAtLeastOneOf(
    List<List<String>>? groups,
    Map<String, Object?> map,
    List<String> path,
    List<ValidationError> errors,
  ) {
    if (groups == null) return;
    for (final List<String> group in groups) {
      if (!group.any(map.containsKey)) {
        errors.add(
          ValidationError(
            ValidationErrorType.anyOfNotMet,
            path: path,
            details: 'At least one of ${group.join(', ')} is required',
          ),
        );
      }
    }
  }

  static bool _isValidityMap(Object? value) =>
      value is Map && value['valid'] is bool;

  static bool _matchesFormat(String value, String format) => switch (format) {
    'uri' => _uriPattern.hasMatch(value),
    'date' => _datePattern.hasMatch(value) && DateTime.tryParse(value) != null,
    'time' => _timePattern.hasMatch(value),
    'date-time' =>
      _dateTimePattern.hasMatch(value) && DateTime.tryParse(value) != null,
    'email' => _emailPattern.hasMatch(value),
    _ => true,
  };

  /// Validates that every extension key in a `metadata` map satisfies UAX #31.
  static String? firstInvalidExtensionKey(Object? metadata) {
    if (metadata case {'extensions': final Map<Object?, Object?> extensions}) {
      for (final Object? key in extensions.keys) {
        if (key is! String || !isValidUax31Identifier(key)) {
          return '$key';
        }
      }
    }
    return null;
  }
}
