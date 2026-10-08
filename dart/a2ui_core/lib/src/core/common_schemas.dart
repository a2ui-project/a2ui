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

/// Hand-built schemas for the v0.9 `common_types.json` wire shapes.
///
/// These describe what a v0.9 message may carry. `functionCall.returnType`
/// therefore accepts only the seven v0.9 return types: v1.0 function calls
/// carry no `returnType` on the wire, and the v1.0 return-type enum (which
/// adds `validationResult`) belongs to the catalog definition, not to the
/// common types. `A2uiReturnType` is the API-level counterpart and is not
/// gated by version.
class CommonSchemas {
  static const String _commonTypesUri = 'common_types.json#/\$defs';

  static Schema _withRef(Schema schema, String name) =>
      Schema.fromMap(<String, Object?>{
        ...schema.value,
        'commonTypesRef': '$_commonTypesUri/$name',
      });

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
}
