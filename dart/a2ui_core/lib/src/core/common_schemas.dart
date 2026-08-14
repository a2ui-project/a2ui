// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import 'package:json_schema_builder/json_schema_builder.dart';

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
}
