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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../binding/node_props_accessors.dart';
import '../component_implementation.dart';

/// The basic catalog `CheckBox` component implementation.
final flutterCheckBoxImplementation = FlutterComponentImplementation(
  name: 'CheckBox',
  schema: Schema.combined(
    allOf: [
      CommonSchemas.checkable,
      Schema.object(
        properties: {
          'label': CommonSchemas.dynamicString,
          'value': CommonSchemas.dynamicBoolean,
        },
        required: ['label', 'value'],
      ),
    ],
  ),
  builder: (context, node, buildChild) {
    final String label = node.stringValue('label') ?? '';
    final bool isChecked = node.boolValue('value') ?? false;
    final WritableBinding<dynamic>? binding = node.writableBinding<dynamic>(
      'value',
    );

    return CheckboxListTile(
      title: Text(label),
      value: isChecked,
      controlAffinity: ListTileControlAffinity.leading,
      contentPadding: EdgeInsets.zero,
      onChanged: binding == null
          ? null
          : (bool? newVal) {
              if (newVal != null) {
                binding.set(newVal);
              }
            },
    );
  },
);
