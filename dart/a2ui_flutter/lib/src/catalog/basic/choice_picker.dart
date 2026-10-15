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

typedef _Option = ({String value, String label});

/// Builds the basic `ChoicePicker` component: its `options` under its
/// `label`, as radio buttons or checkboxes, or as chips when `displayStyle`
/// is `chips`.
///
/// The `mutuallyExclusive` variant (the default) selects one value and
/// `multipleSelection` toggles each. `filterable` adds a field that filters
/// the options by label. Each selection is written to the bound `value` path
/// as a list of option values. A literal `value` renders the options
/// disabled.
Widget buildChoicePicker(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  return _ChoicePicker(
    label: props.string('label'),
    options: [
      for (final Object? item in props.list('options'))
        if (item case final Map<Object?, Object?> option)
          if (option['value'] case final String value)
            (
              value: value,
              label: ComponentProps.asString(option['label']) ?? value,
            ),
    ],
    selected: switch (props.value('value')) {
      final List<Object?> values => values.whereType<String>().toList(),
      final String value => [value],
      _ => const [],
    },
    multiple: props.string('variant') == 'multipleSelection',
    chips: props.string('displayStyle') == 'chips',
    filterable: props.boolean('filterable') ?? false,
    onChanged: writerFor(context, props, 'value'),
    error: props.validationErrors.firstOrNull,
  );
}

class _ChoicePicker extends StatefulWidget {
  const _ChoicePicker({
    required this.label,
    required this.options,
    required this.selected,
    required this.multiple,
    required this.chips,
    required this.filterable,
    required this.onChanged,
    required this.error,
  });

  final String? label;
  final List<_Option> options;
  final List<String> selected;
  final bool multiple;
  final bool chips;
  final bool filterable;
  final void Function(Object? value)? onChanged;
  final String? error;

  @override
  State<_ChoicePicker> createState() => _ChoicePickerState();
}

class _ChoicePickerState extends State<_ChoicePicker> {
  late final TextEditingController _filter;

  @override
  void initState() {
    super.initState();
    _filter = TextEditingController();
  }

  @override
  void dispose() {
    _filter.dispose();
    super.dispose();
  }

  bool get _enabled => widget.onChanged != null;

  void _toggle(String value) {
    final List<String> current = widget.selected;
    widget.onChanged?.call(
      !widget.multiple
          ? [value]
          : current.contains(value)
          ? [
              for (final v in current)
                if (v != value) v,
            ]
          : [...current, value],
    );
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final String query = widget.filterable ? _filter.text.toLowerCase() : '';
    final List<(int, _Option)> visible = [
      for (final (int i, _Option option) in widget.options.indexed)
        if (option.label.toLowerCase().contains(query)) (i, option),
    ];
    final List<String> selected = widget.selected;
    final String? label = widget.label;
    final String? error = widget.error;
    return limitUnboundedWidth(
      context,
      Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (label != null) Text(label, style: theme.textTheme.titleSmall),
          if (widget.filterable)
            TextField(
              controller: _filter,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                hintText: 'Filter options...',
                prefixIcon: Icon(Icons.search),
                isDense: true,
              ),
            ),
          if (widget.chips)
            _chips(visible, selected)
          else if (widget.multiple)
            _checkboxes(visible, selected)
          else
            _radios(visible, selected),
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

  Widget _chips(List<(int, _Option)> visible, List<String> selected) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [
      for (final (int i, _Option option) in visible)
        widget.multiple
            ? FilterChip(
                key: ValueKey<int>(i),
                label: Text(option.label),
                selected: selected.contains(option.value),
                onSelected: _enabled ? (_) => _toggle(option.value) : null,
              )
            : ChoiceChip(
                key: ValueKey<int>(i),
                label: Text(option.label),
                selected: selected.contains(option.value),
                onSelected: _enabled ? (_) => _toggle(option.value) : null,
              ),
    ],
  );

  Widget _checkboxes(List<(int, _Option)> visible, List<String> selected) =>
      Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (int i, _Option option) in visible)
            CheckboxListTile(
              key: ValueKey<int>(i),
              value: selected.contains(option.value),
              onChanged: _enabled ? (_) => _toggle(option.value) : null,
              title: Text(option.label),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
            ),
        ],
      );

  Widget _radios(List<(int, _Option)> visible, List<String> selected) =>
      RadioGroup<String>(
        groupValue: selected.firstOrNull,
        onChanged: (value) {
          if (value != null) _toggle(value);
        },
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final (int i, _Option option) in visible)
              RadioListTile<String>(
                key: ValueKey<int>(i),
                value: option.value,
                enabled: _enabled,
                title: Text(option.label),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
              ),
          ],
        ),
      );
}
