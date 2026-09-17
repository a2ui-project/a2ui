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

import '../primitives/constants.dart';
import '../primitives/simple_items.dart';
import 'catalog.dart';

/// Provides a set of pre-defined, reusable schema objects for common
/// A2UI patterns, simplifying the creation of CatalogItem definitions.
abstract final class A2uiSchemas {
  static String get _commonTypesUri => commonTypesSchemaId;

  /// Defines the usage of the function registry.
  static Schema clientFunctions() {
    return S.list(
      title: 'A2UI Client Functions',
      description: 'A list of functions available for use in the client.',
      items: S.combined(
        oneOf: [
          _requiredFunction(),
          _regexFunction(),
          _lengthFunction(),
          _numericFunction(),
          _emailFunction(),
          _formatStringFunction(),
          _formatNumberFunction(),
          _formatCurrencyFunction(),
          _formatDateFunction(),
          _pluralizeFunction(),
          _openUrlFunction(),
          _andFunction(),
          _orFunction(),
          _notFunction(),
        ],
      ),
    );
  }

  static Schema _functionDefinition({
    required String name,
    required String description,
    required String returnType,
    required Schema args,
  }) {
    return S.object(
      description: description,
      properties: {
        'call': S.string(constValue: name),
        'args': args,
        'returnType': S.string(constValue: returnType),
      },
      required: ['call', 'args'],
    );
  }

  static Schema _requiredFunction() {
    return _functionDefinition(
      name: 'required',
      description: 'Checks that the value is not null, undefined, or empty.',
      returnType: 'boolean',
      args: S.object(
        properties: {'value': S.any(description: 'The value to check.')},
        required: ['value'],
      ),
    );
  }

  static Schema _regexFunction() {
    return _functionDefinition(
      name: 'regex',
      description: 'Checks that the value matches a regular expression string.',
      returnType: 'boolean',
      args: S.object(
        properties: {
          'value': S.any(), // DynamicString
          'pattern': S.string(
            description: 'The regex pattern to match against.',
          ),
        },
        required: ['value', 'pattern'],
      ),
    );
  }

  static Schema _lengthFunction() {
    return _functionDefinition(
      name: 'length',
      description: 'Checks string length constraints.',
      returnType: 'boolean',
      args: S.object(
        properties: {
          'value': S.any(), // DynamicString
          'min': S.integer(
            minimum: 0,
            description: 'The minimum allowed length.',
          ),
          'max': S.integer(
            minimum: 0,
            description: 'The maximum allowed length.',
          ),
        },
        required: ['value'],
      ),
    );
  }

  static Schema _numericFunction() {
    return _functionDefinition(
      name: 'numeric',
      description: 'Checks numeric range constraints.',
      returnType: 'boolean',
      args: S.object(
        properties: {
          'value': S.any(), // DynamicNumber
          'min': S.number(description: 'The minimum allowed value.'),
          'max': S.number(description: 'The maximum allowed value.'),
        },
        required: ['value'],
      ),
    );
  }

  static Schema _emailFunction() {
    return _functionDefinition(
      name: 'email',
      description: 'Checks that the value is a valid email address.',
      returnType: 'boolean',
      args: S.object(
        properties: {
          'value': S.any(), // DynamicString
        },
        required: ['value'],
      ),
    );
  }

  static Schema _formatStringFunction() {
    return _functionDefinition(
      name: 'formatString',
      description:
          '''Performs string interpolation of data model values and other functions.''',
      returnType: 'string',
      args: S.object(
        properties: {'value': S.any(description: 'The string to format.')},
        required: ['value'],
        additionalProperties: true, // Allow other interpolation args
      ),
    );
  }

  static Schema _formatNumberFunction() {
    return _functionDefinition(
      name: 'formatNumber',
      description:
          'Formats a number with the specified grouping and decimal precision.',
      returnType: 'string',
      args: S.object(
        properties: {
          'value': S.number(description: 'The number to format.'),
          'decimalPlaces': S.integer(
            description: 'Optional. The number of decimal places to show.',
          ),
          'useGrouping': S.boolean(
            description:
                '''Optional. If true, uses locale-specific grouping separators.''',
          ),
        },
        required: ['value'],
      ),
    );
  }

  static Schema _formatCurrencyFunction() {
    return _functionDefinition(
      name: 'formatCurrency',
      description: 'Formats a number as a currency string.',
      returnType: 'string',
      args: S.object(
        properties: {
          'value': S.number(description: 'The monetary amount.'),
          'currencyCode': S.string(
            description: "The ISO 4217 currency code (e.g., 'USD', 'EUR').",
          ),
        },
        required: ['value', 'currencyCode'],
      ),
    );
  }

  static Schema _formatDateFunction() {
    return _functionDefinition(
      name: 'formatDate',
      description: 'Formats a timestamp into a string using a pattern.',
      returnType: 'string',
      args: S.object(
        properties: {
          'value': S.any(description: 'The date to format.'),
          'pattern': S.string(
            description: 'The format pattern (e.g. "MM/dd/yyyy").',
          ),
        },
        required: ['value', 'pattern'],
      ),
    );
  }

  static Schema _pluralizeFunction() {
    return _functionDefinition(
      name: 'pluralize',
      description: 'Selects a localized string based on a numeric count.',
      returnType: 'string',
      args: S.object(
        properties: {
          'count': S.number(description: 'The numeric count.'),
          'zero': S.string(description: 'String for zero count.'),
          'one': S.string(description: 'String for count of one.'),
          'other': S.string(description: 'Fallback string.'),
        },
        required: ['count', 'other'],
      ),
    );
  }

  static Schema _openUrlFunction() {
    return _functionDefinition(
      name: 'openUrl',
      description: 'Opens a URL in a browser.',
      returnType: 'void',
      args: S.object(
        properties: {'url': S.string(description: 'The URL to open.')},
        required: ['url'],
      ),
    );
  }

  static Schema _andFunction() {
    return _functionDefinition(
      name: 'and',
      description: 'Performs logical AND on a list of values.',
      returnType: 'boolean',
      args: S.object(
        properties: {'values': S.list(items: S.any(), minItems: 2)},
        required: ['values'],
      ),
    );
  }

  static Schema _orFunction() {
    return _functionDefinition(
      name: 'or',
      description: 'Performs logical OR on a list of values.',
      returnType: 'boolean',
      args: S.object(
        properties: {'values': S.list(items: S.any(), minItems: 2)},
        required: ['values'],
      ),
    );
  }

  static Schema _notFunction() {
    return _functionDefinition(
      name: 'not',
      description: 'Performs logical NOT on a value.',
      returnType: 'boolean',
      args: S.object(properties: {'value': S.any()}, required: ['value']),
    );
  }

  /// Schema for a function call.
  static Schema functionCall() => S.object(
    properties: {
      'call': S.string(description: 'The name of the function to call.'),
      'args': S.object(
        description: 'Arguments to pass to the function.',
        additionalProperties: true,
      ),
    },
    required: ['call'],
  );

  /// Schema for a validation check, including logic and an error message.
  static Schema validationCheck({String? description}) {
    return S.combined(
      $ref: '$_commonTypesUri#/\$defs/CheckRule',
      description: description,
    );
  }

  /// Schema for a value that can be either a literal string or a
  /// data-bound path to a string in the DataModel.
  static Schema stringReference({
    String? description,
    List<String>? enumValues,
  }) {
    if (enumValues != null) {
      return S.combined(
        allOf: [
          S.combined($ref: '$_commonTypesUri#/\$defs/DynamicString'),
          S.combined(
            anyOf: [
              S.string(enumValues: enumValues),
              S.object(),
            ],
          ),
        ],
        description: description,
      );
    }
    return S.combined(
      $ref: '$_commonTypesUri#/\$defs/DynamicString',
      description: description,
    );
  }

  /// Schema for a value that can be either a literal number or a
  /// data-bound path to a number in the DataModel.
  static Schema numberReference({String? description}) {
    return S.combined(
      $ref: '$_commonTypesUri#/\$defs/DynamicNumber',
      description: description,
    );
  }

  /// Schema for a value that can be either a literal boolean or a
  /// data-bound path to a boolean in the DataModel.
  static Schema booleanReference({String? description}) {
    return S.combined(
      $ref: '$_commonTypesUri#/\$defs/DynamicBoolean',
      description: description,
    );
  }

  /// Helper to create a DataBinding schema.
  static Schema dataBindingSchema({String? description}) {
    return S.object(
      description: description,
      properties: {
        'path': S.string(
          description: 'A relative or absolute path in the data model.',
        ),
      },
      required: ['path'],
    );
  }

  /// Schema for a property that holds a list of child components,
  /// either as an explicit list of IDs or a data-bound template.
  static Schema componentArrayReference({String? description}) {
    final idList = S.list(items: S.string(description: 'Component ID'));
    final template = S.object(
      properties: {
        'componentId': componentReference(),
        'path': S.string(
          description: 'A relative or absolute path in the data model.',
        ),
      },
      required: ['componentId', 'path'],
    );
    return S.combined(oneOf: [idList, template], description: description);
  }

  /// Schema for a list of validation checks.
  static Schema checkable({String? description}) {
    return S.list(
      description: description ?? 'Validation rules for this component.',
      items: validationCheck(),
    );
  }

  /// Schema for a user-initiated action.
  ///
  /// Can be either a server-side event or a client-side function call.
  static Schema action({String? description}) {
    return S.combined(
      $ref: '$_commonTypesUri#/\$defs/Action',
      description: description,
    );
  }

  /// Schema for a value that can be either a literal array of strings or a
  /// data-bound path to an array of strings.
  static Schema stringArrayReference({String? description}) {
    return S.combined(
      $ref: '$_commonTypesUri#/\$defs/DynamicStringList',
      description: description,
    );
  }

  /// Schema for a createSurface message.
  static Schema createSurfaceSchema() => S.object(
    description:
        'Signals the client to create a new surface and begin rendering it. '
        "When this message is sent, the client will expect 'updateComponents' "
        "and/or 'updateDataModel' messages for the same surfaceId that define "
        'the component tree.',
    properties: {
      surfaceIdKey: S.string(description: 'The unique ID for the surface.'),
      'catalogId': S.string(
        description:
            'A string that uniquely identifies this catalog. It is recommended '
            'to prefix this with an internet domain that you own, to avoid '
            "conflicts e.g. 'mycompany.com:somecatalog'.",
      ),
      'theme': S.object(
        description: 'Theme parameters for the surface.',
        additionalProperties: true,
      ),
      'sendDataModel': S.boolean(
        description: 'Whether to send the data model to every client request.',
      ),
    },
    required: [surfaceIdKey, 'catalogId'],
  );

  /// Schema for a deleteSurface message.
  static Schema deleteSurfaceSchema() => S.object(
    description:
        "Signals the client to delete the surface identified by 'surfaceId'. "
        'The createSurface message MUST have been previously sent with the '
        "'catalogId' that is in this message.",
    properties: {surfaceIdKey: S.string()},
    required: [surfaceIdKey],
  );

  /// Schema for a updateDataModel message.
  static Schema updateDataModelSchema() => S.object(
    description:
        'Updates the data model for an existing surface. This message can be '
        'sent multiple times to update the data model. The createSurface '
        "message MUST have been previously sent with the 'catalogId' that is "
        'in this message.',
    properties: {
      surfaceIdKey: S.string(),
      'path': S.combined(type: JsonType.string, defaultValue: '/'),
      'value': S.any(
        description:
            'The new value to write to the data model. If null/omitted, the key is removed.',
      ),
    },
    required: [surfaceIdKey],
  );

  /// Schema for a component reference (ID).
  ///
  /// The `$ref` to the shared `ComponentId` type marks the property as a
  /// child reference for a2ui_core: graph validation follows it, and the node
  /// resolver mounts the referenced component as a child node.
  static Schema componentReference({String? description}) {
    return S.combined(
      $ref: '$_commonTypesUri#/\$defs/ComponentId',
      description: description ?? 'The ID of a component.',
    );
  }

  /// Schema for a updateComponents message.
  static Schema updateComponentsSchema(Catalog catalog) {
    // Collect specific component schemas from the catalog.
    // We assume catalog items have updated schemas (flattened).
    final List<Schema> componentSchemas = catalog.items
        .map((item) => item.dataSchema)
        .toList();

    return S.object(
      description:
          'Updates a surface with a new set of components. This message can '
          'be sent multiple times to update the component tree of an existing '
          'surface. One of the components in one of the components lists MUST '
          "have an 'id' of 'root' to serve as the root of the component tree. "
          'The createSurface message MUST have been previously sent with the '
          "'catalogId' that is in this message.",
      properties: {
        surfaceIdKey: S.string(
          description: 'The unique identifier for the UI surface.',
        ),
        'components': S.list(
          description: 'A flat list of component definitions.',
          minItems: 1,
          items: componentSchemas.isEmpty
              ? S.object(description: 'No components in catalog.')
              : S.combined(
                  oneOf: componentSchemas,
                  description:
                      'Must match one of the component definitions in the '
                      'catalog.',
                ),
        ),
      },
      required: [surfaceIdKey, 'components'],
    );
  }

  /// Schema for a value that can be either a literal list or a reference.
  static Schema listOrReference({required Schema items, String? description}) {
    final literal = S.list(items: items);
    final Schema binding = dataBindingSchema(description: 'A path to a list.');
    final Schema function = functionCall();
    return S.combined(
      oneOf: [literal, binding, function],
      description: description,
    );
  }

  /// Schema for a generic property value (literal, binding, or function).
  static Schema propertyReference({String? description}) {
    final Schema binding = dataBindingSchema(description: 'A path to a value.');
    final Schema function = functionCall();
    // We allow any type for the literal value since we don't know it here.
    // Ideally usage would be more specific if possible.
    return S.combined(
      oneOf: [S.any(), binding, function],
      description: description,
    );
  }
}
