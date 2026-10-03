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

/// Dart builders for the v0.9 `common_types.json` definitions.
///
/// Each schema's description starts with a `REF:common_types.json#/...`
/// marker naming the definition it mirrors, which is how a hand-built catalog
/// tells `Catalog.refMap` and the prompt generators which shared type a
/// property uses. [CommonSchemasV1] holds the v1.0 shapes.
class CommonSchemas {
  static final dataBinding = Schema.object(
    description:
        'REF:common_types.json#/\$defs/DataBinding|A JSON Pointer path to a value in the data model.',
    properties: {
      'path': Schema.string(
        description: 'A JSON Pointer path to a value in the data model.',
      ),
    },
    required: ['path'],
  );

  static final functionCall = Schema.object(
    description:
        'REF:common_types.json#/\$defs/FunctionCall|Invokes a named function on the client.',
    properties: {
      'call': Schema.string(description: 'The name of the function to call.'),
      'args': Schema.object(
        description: 'Arguments passed to the function.',
        additionalProperties: true,
      ),
      'returnType': Schema.string(
        description: 'The expected return type of the function call.',
        enumValues: [
          'string',
          'number',
          'boolean',
          'array',
          'object',
          'any',
          'void',
        ],
      ),
    },
    required: ['call'],
  );

  static final dynamicString = Schema.combined(
    description:
        'REF:common_types.json#/\$defs/DynamicString|Represents a string',
    anyOf: [Schema.string(), dataBinding, functionCall],
  );

  static final dynamicBoolean = Schema.combined(
    description: 'REF:common_types.json#/\$defs/DynamicBoolean|A boolean value',
    anyOf: [Schema.boolean(), dataBinding, functionCall],
  );

  static final componentId = Schema.string(
    description:
        'REF:common_types.json#/\$defs/ComponentId|The unique identifier for a component.',
  );

  static final childList = Schema.combined(
    description: 'REF:common_types.json#/\$defs/ChildList',
    anyOf: [
      Schema.list(items: componentId),
      Schema.object(
        properties: {'componentId': componentId, 'path': Schema.string()},
        required: ['componentId', 'path'],
      ),
    ],
  );

  static final action = Schema.combined(
    description: 'REF:common_types.json#/\$defs/Action',
    anyOf: [
      Schema.object(
        properties: {
          'event': Schema.object(
            properties: {
              'name': Schema.string(),
              'context': Schema.object(additionalProperties: true),
            },
            required: ['name'],
          ),
        },
        required: ['event'],
      ),
      Schema.object(
        properties: {'functionCall': functionCall},
        required: ['functionCall'],
      ),
    ],
  );

  static final checkable = Schema.object(
    description: 'REF:common_types.json#/\$defs/Checkable',
    properties: {
      'checks': Schema.list(
        items: Schema.object(
          properties: {'condition': dynamicBoolean, 'message': Schema.string()},
          required: ['condition', 'message'],
        ),
      ),
    },
  );

  static final dynamicNumber = Schema.combined(
    description: 'REF:common_types.json#/\$defs/DynamicNumber|A number value',
    anyOf: [Schema.number(), dataBinding, functionCall],
  );

  static final dynamicStringList = Schema.combined(
    description:
        'REF:common_types.json#/\$defs/DynamicStringList|A list of strings',
    anyOf: [Schema.list(items: Schema.string()), dataBinding, functionCall],
  );

  static final dynamicValue = Schema.combined(
    description: 'REF:common_types.json#/\$defs/DynamicValue|Any value',
    anyOf: [
      Schema.string(),
      Schema.number(),
      Schema.boolean(),
      Schema.list(),
      dataBinding,
      functionCall,
    ],
  );

  static final accessibilityAttributes = Schema.object(
    description: 'REF:common_types.json#/\$defs/AccessibilityAttributes',
    properties: {'label': dynamicString, 'description': dynamicString},
  );

  static final checkRule = Schema.object(
    description: 'REF:common_types.json#/\$defs/CheckRule',
    properties: {'condition': dynamicBoolean, 'message': Schema.string()},
    required: ['condition', 'message'],
    additionalProperties: false,
  );

  static final componentCommon = Schema.object(
    description: 'REF:common_types.json#/\$defs/ComponentCommon',
    properties: {
      'id': componentId,
      'accessibility': accessibilityAttributes,
    },
    required: ['id'],
  );
}

/// Dart builders for the v1.0 `common_types.json` definitions.
///
/// v1.0 marks data bindings and function calls with the reserved `@path` and
/// `@call` keys, so these differ from [CommonSchemas] wherever a value may be
/// dynamic. A literal object in a [dynamicValue] may not use any other key
/// starting with a single `@`; such keys are reserved for protocol directives
/// and must be escaped as `@@`.
class CommonSchemasV1 {
  static final dataBinding = Schema.object(
    description:
        'REF:common_types.json#/\$defs/DataBinding|A JSON Pointer path to a value in the data model.',
    properties: {
      '@path': Schema.string(
        description: 'A JSON Pointer path to a value in the data model.',
      ),
    },
    required: ['@path'],
    additionalProperties: false,
  );

  static final functionCall = Schema.object(
    description:
        'REF:common_types.json#/\$defs/FunctionCall|Invokes a named function.',
    properties: {
      '@call': Schema.string(description: 'The name of the function to call.'),
      'args': Schema.object(
        description: 'Arguments passed to the function.',
        additionalProperties: true,
      ),
      'catalogId': Schema.string(
        description: 'The catalog ID for this function, overriding any '
            'surface-level default catalogId.',
      ),
    },
    required: ['@call'],
  );

  static final dynamicString = Schema.combined(
    description:
        'REF:common_types.json#/\$defs/DynamicString|Represents a string',
    oneOf: [Schema.string(), dataBinding, functionCall],
  );

  static final dynamicNumber = Schema.combined(
    description: 'REF:common_types.json#/\$defs/DynamicNumber|A number value',
    oneOf: [Schema.number(), dataBinding, functionCall],
  );

  static final dynamicBoolean = Schema.combined(
    description: 'REF:common_types.json#/\$defs/DynamicBoolean|A boolean value',
    oneOf: [Schema.boolean(), dataBinding, functionCall],
  );

  static final dynamicStringList = Schema.combined(
    description:
        'REF:common_types.json#/\$defs/DynamicStringList|A list of strings',
    oneOf: [Schema.list(items: Schema.string()), dataBinding, functionCall],
  );

  /// A literal, a data binding, or a function call returning any type.
  ///
  /// The literal-object alternative rejects reserved single-`@` keys and any
  /// object carrying `@path` or `@call`, so exactly one alternative matches.
  static final dynamicValue = Schema.combined(
    description: 'REF:common_types.json#/\$defs/DynamicValue|Any value',
    oneOf: [
      Schema.string(),
      Schema.number(),
      Schema.boolean(),
      Schema.list(),
      Schema.fromMap(<String, Object?>{
        'type': 'object',
        'propertyNames': <String, Object?>{
          'not': <String, Object?>{'pattern': r'^@([^@]|$)'},
        },
        'not': <String, Object?>{
          'anyOf': <Object?>[
            <String, Object?>{
              'required': <Object?>['@path'],
            },
            <String, Object?>{
              'required': <Object?>['@call'],
            },
          ],
        },
      }),
      dataBinding,
      functionCall,
    ],
  );

  static final accessibilityAttributes = Schema.object(
    description: 'REF:common_types.json#/\$defs/AccessibilityAttributes',
    properties: {
      'label': dynamicString,
      'description': dynamicString,
      'live': Schema.string(enumValues: ['off', 'polite', 'assertive']),
      'hidden': dynamicBoolean,
    },
    additionalProperties: false,
  );

  static final checkRule = Schema.object(
    description: 'REF:common_types.json#/\$defs/CheckRule',
    properties: {
      'condition': Schema.combined(oneOf: [dataBinding, functionCall]),
      'message': Schema.string(),
    },
    required: ['condition'],
    additionalProperties: false,
  );

  static final componentCommon = Schema.object(
    description: 'REF:common_types.json#/\$defs/ComponentCommon',
    properties: {
      'id': CommonSchemas.componentId,
      'catalogId': Schema.string(),
      'accessibility': accessibilityAttributes,
      'metadata': Schema.object(
        properties: {'extensions': Schema.object(additionalProperties: true)},
        additionalProperties: false,
      ),
    },
    required: ['id'],
  );
}
