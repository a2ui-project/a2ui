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

final Schema _dynamicNumber = Schema.combined(
  description: 'REF:common_types.json#/\$defs/DynamicNumber',
  anyOf: [
    Schema.number(),
    CommonSchemas.dataBinding,
    CommonSchemas.functionCall,
  ],
);

/// The basic catalog `Slider` component implementation.
final flutterSliderImplementation = FlutterComponentImplementation(
  name: 'Slider',
  schema: Schema.combined(
    allOf: [
      CommonSchemas.checkable,
      Schema.object(
        properties: {
          'label': CommonSchemas.dynamicString,
          'min': Schema.number(),
          'max': Schema.number(),
          'value': _dynamicNumber,
        },
        required: ['value'],
      ),
    ],
  ),
  builder: (context, node, buildChild) {
    final String? label = node.stringValue('label');
    final double min = node.doubleValue('min') ?? 0.0;
    final double max = node.doubleValue('max') ?? 100.0;
    final double currentVal = (node.doubleValue('value') ?? min).clamp(
      min,
      max,
    );
    final WritableBinding<dynamic>? binding = node.writableBinding<dynamic>(
      'value',
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (label != null && label.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(left: 8.0, top: 4.0),
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
        Slider(
          value: currentVal,
          min: min,
          max: max,
          onChanged: binding == null
              ? null
              // ignore: unnecessary_lambdas - prevents runtime TypeError on dynamic binding tear-off.
              : (double val) => binding.set(val),
        ),
      ],
    );
  },
);
