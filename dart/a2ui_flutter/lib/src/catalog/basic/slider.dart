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

import 'dart:math' as math;

import 'package:a2ui_core/a2ui_core.dart';
import 'package:flutter/material.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';
import 'unbounded_width.dart';
import 'write_back.dart';

/// Builds the basic `Slider` component: a [Slider] from `min` (default 0) to
/// `max` (default 100 when absent) under its `label` and current `value`.
///
/// A range that is a whole number from 2 to 1000 moves in steps of 1 from
/// `min`. Any other range moves continuously. Each move is written to the
/// bound `value` path, a whole value below 2^53 in magnitude as an int. A
/// literal `value`, or a range too large for a double, renders the slider
/// disabled.
Widget buildSlider(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  final ThemeData theme = Theme.of(context);
  final double min = props.number('min') ?? 0;
  final double max = math.max(min, props.number('max') ?? 100);
  final double range = max - min;
  final int? divisions =
      range > 1 && range <= 1000 && (range - range.round()).abs() < 1e-9
      ? range.round()
      : null;
  final double raw = props.number('value') ?? min;
  final double value = raw.isFinite ? raw.clamp(min, max) : min;
  final String valueText = ComponentProps.asString(value)!;
  final String? error = props.validationErrors.firstOrNull;
  final void Function(Object?)? write = writerFor(context, props, 'value');
  return limitUnboundedWidth(
    context,
    Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                props.string('label') ?? '',
                style: theme.textTheme.titleSmall,
              ),
            ),
            Text(valueText, style: theme.textTheme.bodySmall),
          ],
        ),
        Slider(
          value: value,
          min: min,
          max: max,
          divisions: divisions,
          label: valueText,
          onChanged: write == null || !range.isFinite
              ? null
              : (moved) {
                  final double snapped = divisions == null
                      ? moved
                      : math.min(max, min + (moved - min).round());
                  write(
                    snapped == snapped.roundToDouble() &&
                            snapped.abs() < _twoTo53
                        ? snapped.toInt()
                        : snapped,
                  );
                },
        ),
        if (error != null)
          Text(
            error,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.error,
            ),
          ),
      ],
    ),
  );
}

/// 2^53, above which a double does not hold every whole number.
const double _twoTo53 = 9007199254740992;
