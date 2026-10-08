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

import 'dart:async';
import 'dart:math' as math;

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

/// The basic catalog under its own id, with the custom components the
/// examples name: `CustomGrid` and `CustomSlider`.
final WidgetCatalog demoCatalog = WidgetCatalog(
  id: BasicCatalog.v0_9Id,
  components: [...BasicComponents.all, customGrid, customSlider],
  functions: BasicCatalog.v0_9().functions.values.toList(),
  themeSchema: BasicComponents.api.themeSchema,
);

final Schema _dynamicNumber = Schema.fromMap({
  r'$ref':
      'https://a2ui.org/specification/v0_9/common_types.json#/\$defs/DynamicNumber',
});

/// A `CustomGrid`: its `title` and `description` over its `children` in two
/// columns.
final ComponentImplementation customGrid = ComponentImplementation(
  name: 'CustomGrid',
  schema: Schema.object(
    properties: {
      'title': CommonSchemas.dynamicString,
      'description': CommonSchemas.dynamicString,
      'children': CommonSchemas.childList,
    },
  ),
  builder: (context, node, props, buildChild) {
    final TextTheme text = Theme.of(context).textTheme;
    final List<ComponentNode<ComponentImplementation>> children = props
        .children('children');
    Widget cell(int index) => index < children.length
        ? KeyedSubtree(
            key: NodeKey(children[index].instanceId),
            child: Expanded(
              child: Card.outlined(
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: buildChild(children[index]),
                ),
              ),
            ),
          )
        : const Spacer();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (props.string('title') case final String title)
          Text(title, style: text.titleMedium),
        if (props.string('description') case final String description)
          Text(description, style: text.bodySmall),
        for (var row = 0; row < children.length; row += 2)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [cell(row), cell(row + 1)],
          ),
      ],
    );
  },
);

/// A `CustomSlider`: its `label` and `value` over a [Slider] from `min` to
/// `max` that writes each move to the path `value` is bound to.
final ComponentImplementation customSlider = ComponentImplementation(
  name: 'CustomSlider',
  schema: Schema.object(
    properties: {
      'label': CommonSchemas.dynamicString,
      'value': _dynamicNumber,
      'min': _dynamicNumber,
      'max': _dynamicNumber,
    },
  ),
  builder: (context, node, props, buildChild) {
    final double min = props.number('min') ?? 0;
    final double max = math.max(min, props.number('max') ?? 100);
    final double value = (props.number('value') ?? min).clamp(min, max);
    final WritableBinding<Object?>? binding = props.writable('value');
    final SurfaceModel<ComponentImplementation> surface = A2uiSurface.of(
      context,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('${props.string('label') ?? 'Value'}: ${value.round()}'),
        Slider(
          value: value,
          min: min,
          max: max,
          onChanged: binding == null
              ? null
              : (moved) {
                  try {
                    binding.set(moved.round());
                  } on A2uiDataError catch (error) {
                    unawaited(
                      surface.dispatchError(
                        A2uiClientError(
                          code: error.code,
                          surfaceId: surface.id,
                          message: error.message,
                          path: error.path,
                        ),
                      ),
                    );
                  }
                },
        ),
      ],
    );
  },
);
