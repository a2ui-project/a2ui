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

final Schema _dynamicStringList = Schema.combined(
  description: 'REF:common_types.json#/\$defs/DynamicStringList',
  anyOf: [
    Schema.list(items: Schema.string()),
    CommonSchemas.dataBinding,
    CommonSchemas.functionCall,
  ],
);

/// The basic catalog `ChoicePicker` component implementation.
final flutterChoicePickerImplementation = FlutterComponentImplementation(
  name: 'ChoicePicker',
  schema: Schema.combined(
    allOf: [
      CommonSchemas.checkable,
      Schema.object(
        properties: {
          'label': CommonSchemas.dynamicString,
          'variant': Schema.string(
            enumValues: ['multipleSelection', 'mutuallyExclusive'],
          ),
          'options': Schema.list(
            items: Schema.object(
              properties: {
                'label': CommonSchemas.dynamicString,
                'value': Schema.string(),
              },
              required: ['label', 'value'],
            ),
          ),
          'value': _dynamicStringList,
          'displayStyle': Schema.string(enumValues: ['checkbox', 'chips']),
          'filterable': Schema.boolean(),
        },
        required: ['options', 'value'],
      ),
    ],
  ),
  builder: (context, node, buildChild) {
    return _ChoicePickerWidget(node: node);
  },
);

class _ChoicePickerWidget extends StatefulWidget {
  final ComponentNode<FlutterComponentImplementation> node;

  const _ChoicePickerWidget({required this.node});

  @override
  State<_ChoicePickerWidget> createState() => _ChoicePickerWidgetState();
}

class _ChoicePickerWidgetState extends State<_ChoicePickerWidget> {
  String _filterQuery = '';

  @override
  Widget build(BuildContext context) {
    final ComponentNode<FlutterComponentImplementation> node = widget.node;
    final String? label = node.stringValue('label');
    final String variant = node.stringValue('variant') ?? 'mutuallyExclusive';
    final String displayStyle = node.stringValue('displayStyle') ?? 'checkbox';
    final bool filterable = node.boolValue('filterable') ?? false;
    final isMultiple = variant == 'multipleSelection';

    final WritableBinding<dynamic>? binding = node.writableBinding<dynamic>(
      'value',
    );

    // Extract selected values
    final Object? rawVal = node.rawProp('value');
    final List<String> selectedValues = [];
    final Object? valList = rawVal is ResolvedBinding ? rawVal.value : rawVal;
    if (valList is List) {
      for (final Object? item in valList) {
        if (item != null) selectedValues.add(item.toString());
      }
    } else if (valList is String) {
      selectedValues.add(valList);
    }

    // Extract options
    final Object? rawOptions = node.rawProp('options');
    final List<({String label, String value})> options = [];
    if (rawOptions is List) {
      for (final Object? opt in rawOptions) {
        if (opt is Map) {
          final Object? optVal = opt['value'];
          final Object? optLbl = opt['label'];
          final String optLabel = optLbl is ResolvedBinding
              ? optLbl.value?.toString() ?? ''
              : optLbl?.toString() ?? '';
          if (optVal != null) {
            options.add((label: optLabel, value: optVal.toString()));
          }
        }
      }
    }

    // Filter options if filterable
    final List<({String label, String value})> filteredOptions =
        _filterQuery.isEmpty
        ? options
        : options
              .where(
                (o) =>
                    o.label.toLowerCase().contains(_filterQuery.toLowerCase()),
              )
              .toList();

    void toggleOption(String optValue) {
      if (binding == null) return;
      if (isMultiple) {
        final next = List<String>.from(selectedValues);
        if (next.contains(optValue)) {
          next.remove(optValue);
        } else {
          next.add(optValue);
        }
        binding.set(next);
      } else {
        binding.set([optValue]);
      }
    }

    Widget contentWidget;
    if (displayStyle == 'chips') {
      contentWidget = Wrap(
        spacing: 8.0,
        runSpacing: 4.0,
        children: [
          for (final opt in filteredOptions)
            FilterChip(
              label: Text(opt.label),
              selected: selectedValues.contains(opt.value),
              onSelected: (_) => toggleOption(opt.value),
            ),
        ],
      );
    } else if (isMultiple) {
      contentWidget = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final opt in filteredOptions)
            CheckboxListTile(
              dense: true,
              title: Text(opt.label),
              value: selectedValues.contains(opt.value),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              onChanged: (_) => toggleOption(opt.value),
            ),
        ],
      );
    } else {
      contentWidget = RadioGroup<String>(
        groupValue: selectedValues.isNotEmpty ? selectedValues.first : null,
        onChanged: (v) {
          if (v != null) toggleOption(v);
        },
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final opt in filteredOptions)
              RadioListTile<String>(
                dense: true,
                title: Text(opt.label),
                value: opt.value,
                contentPadding: EdgeInsets.zero,
              ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (label != null && label.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 6.0),
            child: Text(label, style: Theme.of(context).textTheme.titleSmall),
          ),
        if (filterable)
          Padding(
            padding: const EdgeInsets.only(bottom: 8.0),
            child: TextField(
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search, size: 18),
                hintText: 'Filter options...',
                isDense: true,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 6,
                ),
                border: OutlineInputBorder(),
              ),
              onChanged: (q) => setState(() => _filterQuery = q),
            ),
          ),
        contentWidget,
      ],
    );
  }
}
