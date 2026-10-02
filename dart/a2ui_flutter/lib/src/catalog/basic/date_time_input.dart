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

/// The basic catalog `DateTimeInput` component implementation.
final flutterDateTimeInputImplementation = FlutterComponentImplementation(
  name: 'DateTimeInput',
  schema: Schema.combined(
    allOf: [
      CommonSchemas.checkable,
      Schema.object(
        properties: {
          'label': CommonSchemas.dynamicString,
          'value': CommonSchemas.dynamicString,
          'enableDate': Schema.boolean(),
          'enableTime': Schema.boolean(),
          'min': CommonSchemas.dynamicString,
          'max': CommonSchemas.dynamicString,
        },
        required: ['value'],
      ),
    ],
  ),
  builder: (context, node, buildChild) {
    return _DateTimeInputWidget(node: node);
  },
);

class _DateTimeInputWidget extends StatefulWidget {
  final ComponentNode<FlutterComponentImplementation> node;

  const _DateTimeInputWidget({required this.node});

  @override
  State<_DateTimeInputWidget> createState() => _DateTimeInputWidgetState();
}

class _DateTimeInputWidgetState extends State<_DateTimeInputWidget> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: widget.node.stringValue('value') ?? '',
    );
  }

  @override
  void didUpdateWidget(_DateTimeInputWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    final String current = widget.node.stringValue('value') ?? '';
    if (_controller.text != current) {
      _controller.text = current;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _pickDate(BuildContext context) async {
    final first = DateTime(1900);
    final last = DateTime(2100);
    DateTime initial = DateTime.tryParse(_controller.text) ?? DateTime.now();
    if (initial.isBefore(first)) {
      initial = first;
    } else if (initial.isAfter(last)) {
      initial = last;
    }
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: last,
    );

    if (picked != null) {
      final formatted =
          '${picked.year.toString().padLeft(4, '0')}-'
          '${picked.month.toString().padLeft(2, '0')}-'
          '${picked.day.toString().padLeft(2, '0')}';
      _updateValue(formatted);
    }
  }

  Future<void> _pickTime(BuildContext context) async {
    final initial = TimeOfDay.now();
    final TimeOfDay? picked = await showTimePicker(
      context: context,
      initialTime: initial,
    );

    if (picked != null) {
      final formatted =
          '${picked.hour.toString().padLeft(2, '0')}:'
          '${picked.minute.toString().padLeft(2, '0')}:00';
      _updateValue(formatted);
    }
  }

  void _updateValue(String newValue) {
    _controller.text = newValue;
    final WritableBinding<dynamic>? binding = widget.node
        .writableBinding<dynamic>('value');
    binding?.set(newValue);
  }

  @override
  Widget build(BuildContext context) {
    final String? label = widget.node.stringValue('label');
    final bool enableDate = widget.node.boolValue('enableDate') ?? true;
    final bool enableTime = widget.node.boolValue('enableTime') ?? false;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: TextField(
        controller: _controller,
        readOnly: enableDate || enableTime,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 8,
          ),
          suffixIcon: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (enableDate)
                IconButton(
                  icon: const Icon(Icons.calendar_today, size: 20),
                  tooltip: 'Pick Date',
                  onPressed: () => _pickDate(context),
                ),
              if (enableTime)
                IconButton(
                  icon: const Icon(Icons.access_time, size: 20),
                  tooltip: 'Pick Time',
                  onPressed: () => _pickTime(context),
                ),
            ],
          ),
        ),
        onChanged: _updateValue,
      ),
    );
  }
}
