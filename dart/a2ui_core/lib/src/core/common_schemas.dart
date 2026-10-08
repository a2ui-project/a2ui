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

const String _commonTypesUri = 'common_types.json#/\$defs';

/// Marks [schema] as mirroring the common type [name] through
/// `commonTypesRef` metadata, which is how a hand-built catalog tells
/// `Catalog.refMap` and the prompt generators which shared type a property
/// uses.
Schema _withRef(Schema schema, String name) => Schema.fromMap(<String, Object?>{
      ...schema.value,
      'commonTypesRef': '$_commonTypesUri/$name',
    });

/// Dart builders for the v0.9 `common_types.json` definitions.
///
/// Each schema carries `commonTypesRef` metadata naming the definition it
/// mirrors. [CommonSchemasV1] holds the v1.0 shapes.
///
/// These describe what a v0.9 message may carry. `functionCall.returnType`
/// therefore accepts only the seven v0.9 return types: v1.0 function calls
/// carry no `returnType` on the wire, and the v1.0 return-type enum (which
/// adds `validationResult`) belongs to the catalog definition, not to the
/// common types. `A2uiReturnType` is the API-level counterpart and is not
/// gated by version.
class CommonSchemas {
  static final Schema dataBinding = _withRef(
    Schema.object(
      description: 'A JSON Pointer path to a value in the data model.',
      properties: {
        'path': Schema.string(
          description: 'A JSON Pointer path to a value in the data model.',
        ),
      },
      required: ['path'],
    ),
    'DataBinding',
  );

  static final Schema functionCall = _withRef(
    Schema.object(
      description: 'Invokes a named function on the client.',
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
    ),
    'FunctionCall',
  );

  static final Schema dynamicString = _withRef(
    Schema.combined(
      description:
          'Represents a string that can be static, bound, or computed.',
      anyOf: [Schema.string(), dataBinding, functionCall],
    ),
    'DynamicString',
  );

  static final Schema dynamicBoolean = _withRef(
    Schema.combined(
      description: 'A boolean value that can be static, bound, or computed.',
      anyOf: [Schema.boolean(), dataBinding, functionCall],
    ),
    'DynamicBoolean',
  );

  static final Schema componentId = _withRef(
    Schema.string(
      description: 'The unique identifier for a component.',
    ),
    'ComponentId',
  );

  static final Schema childList = _withRef(
    Schema.combined(
      description: 'A component id or list of child component ids.',
      anyOf: [
        Schema.list(items: componentId),
        Schema.object(
          properties: {'componentId': componentId, 'path': Schema.string()},
          required: ['componentId', 'path'],
        ),
      ],
    ),
    'ChildList',
  );

  static final Schema action = _withRef(
    Schema.combined(
      description: 'An event or function call to execute.',
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
    ),
    'Action',
  );

  static final Schema checkable = _withRef(
    Schema.object(
      description: 'Validation checks to perform on this component.',
      properties: {
        'checks': Schema.list(
          items: Schema.object(
            properties: {
              'condition': dynamicBoolean,
              'message': Schema.string()
            },
            required: ['condition', 'message'],
          ),
        ),
      },
    ),
    'Checkable',
  );

  static final Schema dynamicNumber = _withRef(
    Schema.combined(
      description: 'A number value',
      anyOf: [Schema.number(), dataBinding, functionCall],
    ),
    'DynamicNumber',
  );

  static final Schema dynamicStringList = _withRef(
    Schema.combined(
      description: 'A list of strings',
      anyOf: [Schema.list(items: Schema.string()), dataBinding, functionCall],
    ),
    'DynamicStringList',
  );

  static final Schema dynamicValue = _withRef(
    Schema.combined(
      description: 'Any value',
      anyOf: [
        Schema.string(),
        Schema.number(),
        Schema.boolean(),
        Schema.list(),
        dataBinding,
        functionCall,
      ],
    ),
    'DynamicValue',
  );

  static final Schema accessibilityAttributes = _withRef(
    Schema.object(
      properties: {'label': dynamicString, 'description': dynamicString},
    ),
    'AccessibilityAttributes',
  );

  static final Schema checkRule = _withRef(
    Schema.object(
      properties: {'condition': dynamicBoolean, 'message': Schema.string()},
      required: ['condition', 'message'],
      additionalProperties: false,
    ),
    'CheckRule',
  );

  static final Schema componentCommon = _withRef(
    Schema.object(
      properties: {
        'id': componentId,
        'accessibility': accessibilityAttributes,
      },
      required: ['id'],
    ),
    'ComponentCommon',
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
  static final Schema dataBinding = _withRef(
    Schema.object(
      description: 'A JSON Pointer path to a value in the data model.',
      properties: {
        '@path': Schema.string(
          description: 'A JSON Pointer path to a value in the data model.',
        ),
      },
      required: ['@path'],
      additionalProperties: false,
    ),
    'DataBinding',
  );

  static final Schema functionCall = _withRef(
    Schema.object(
      description: 'Invokes a named function.',
      properties: {
        '@call':
            Schema.string(description: 'The name of the function to call.'),
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
    ),
    'FunctionCall',
  );

  static final Schema dynamicString = _withRef(
    Schema.combined(
      description: 'Represents a string',
      oneOf: [Schema.string(), dataBinding, functionCall],
    ),
    'DynamicString',
  );

  static final Schema dynamicNumber = _withRef(
    Schema.combined(
      description: 'A number value',
      oneOf: [Schema.number(), dataBinding, functionCall],
    ),
    'DynamicNumber',
  );

  static final Schema dynamicBoolean = _withRef(
    Schema.combined(
      description: 'A boolean value',
      oneOf: [Schema.boolean(), dataBinding, functionCall],
    ),
    'DynamicBoolean',
  );

  static final Schema dynamicStringList = _withRef(
    Schema.combined(
      description: 'A list of strings',
      oneOf: [Schema.list(items: Schema.string()), dataBinding, functionCall],
    ),
    'DynamicStringList',
  );

  /// A literal, a data binding, or a function call returning any type.
  ///
  /// The literal-object alternative rejects reserved single-`@` keys and any
  /// object carrying `@path` or `@call`, so exactly one alternative matches.
  static final Schema dynamicValue = _withRef(
    Schema.combined(
      description: 'Any value',
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
    ),
    'DynamicValue',
  );

  static final Schema accessibilityAttributes = _withRef(
    Schema.object(
      properties: {
        'label': dynamicString,
        'description': dynamicString,
        'live': Schema.string(enumValues: ['off', 'polite', 'assertive']),
        'hidden': dynamicBoolean,
      },
      additionalProperties: false,
    ),
    'AccessibilityAttributes',
  );

  static final Schema checkRule = _withRef(
    Schema.object(
      properties: {
        'condition': Schema.combined(oneOf: [dataBinding, functionCall]),
        'message': Schema.string(),
      },
      required: ['condition'],
      additionalProperties: false,
    ),
    'CheckRule',
  );

  static final Schema componentCommon = _withRef(
    Schema.object(
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
    ),
    'ComponentCommon',
  );
}
