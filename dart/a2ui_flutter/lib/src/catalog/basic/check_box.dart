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

import '../../component_implementation.dart';
import '../../component_props.dart';
import 'unbounded_width.dart';
import 'write_back.dart';

/// Builds the basic `CheckBox` component: a checkbox labelled `label` that
/// writes every toggle to the path `value` is bound to. A literal `value`
/// renders it disabled.
Widget buildCheckBox(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  final String label = props.string('label') ?? '';
  final bool checked = props.boolean('value') ?? false;
  final String? error = props.validationErrors.firstOrNull;
  final void Function(Object?)? write = writerFor(context, props, 'value');
  final VoidCallback? toggle = write == null ? null : () => write(!checked);
  final ThemeData theme = Theme.of(context);
  final Color? errorColor = error == null ? null : theme.colorScheme.error;
  return limitUnboundedWidth(
    context,
    Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        MergeSemantics(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Checkbox(
                value: checked,
                isError: error != null,
                onChanged: toggle == null ? null : (_) => toggle(),
              ),
              if (label.isNotEmpty)
                Flexible(
                  child: GestureDetector(
                    onTap: toggle,
                    child: Text(label, style: TextStyle(color: errorColor)),
                  ),
                ),
            ],
          ),
        ),
        if (error != null)
          Text(
            error,
            style: theme.textTheme.bodySmall?.copyWith(color: errorColor),
          ),
      ],
    ),
  );
}
