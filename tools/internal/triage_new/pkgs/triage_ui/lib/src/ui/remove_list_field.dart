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

import 'package:flutter/material.dart';

import 'label_colors.dart';

/// A field that lists what the item has, such as its labels, with a
/// checkbox by each to remove it. A checked name is grayed out.
///
/// Shows nothing if [names] is empty, since there is nothing to remove.
class RemoveListField extends StatelessWidget {
  const RemoveListField({
    super.key,
    required this.label,
    required this.names,
    required this.removed,
    required this.onChanged,
    this.colorsOf,
  });

  /// The title on the field's border, such as "Remove labels".
  final String label;

  /// What the item has.
  final List<String> names;

  /// The checked [names].
  final List<String> removed;

  final ValueChanged<List<String>> onChanged;

  /// The colors to show a name in, such as a label's colors on GitHub.
  /// If it is set, the names are shown as labels.
  final LabelColors? Function(String name)? colorsOf;

  @override
  Widget build(BuildContext context) {
    if (names.isEmpty) return const SizedBox.shrink();
    return InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
      ),
      child: Wrap(
        spacing: 16,
        runSpacing: 4,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          for (final String name in names)
            _Entry(
              name,
              checked: removed.contains(name),
              asLabel: colorsOf != null,
              colors: colorsOf?.call(name),
              onChanged: (bool checked) => onChanged([
                for (final r in removed)
                  if (r != name) r,
                if (checked) name,
              ]),
            ),
        ],
      ),
    );
  }
}

class _Entry extends StatelessWidget {
  const _Entry(
    this.name, {
    required this.checked,
    required this.asLabel,
    required this.onChanged,
    this.colors,
  });

  final String name;
  final bool checked;

  /// Whether to show [name] as a label, in [colors] or, without them, in
  /// the theme's colors.
  final bool asLabel;
  final LabelColors? colors;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: checked ? 'Keep $name' : 'Remove $name',
    child: InkWell(
      onTap: () => onChanged(!checked),
      borderRadius: BorderRadius.circular(4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Checkbox(
            value: checked,
            onChanged: (bool? value) => onChanged(value ?? false),
            semanticLabel: 'Remove $name',
          ),
          Opacity(
            opacity: checked ? 0.38 : 1,
            child: asLabel ? LabelPill(name, colors: colors) : Text(name),
          ),
          const SizedBox(width: 4),
        ],
      ),
    ),
  );
}
