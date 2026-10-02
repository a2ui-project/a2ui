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

/// The basic catalog `TextField` component implementation.
final flutterTextFieldImplementation = FlutterComponentImplementation(
  name: 'TextField',
  schema: Schema.combined(
    allOf: [
      CommonSchemas.checkable,
      Schema.object(
        properties: {
          'label': CommonSchemas.dynamicString,
          'value': CommonSchemas.dynamicString,
          'variant': Schema.string(
            enumValues: ['longText', 'number', 'shortText', 'obscured'],
          ),
          'validationRegexp': Schema.string(),
        },
        required: ['label'],
      ),
    ],
  ),
  builder: (context, node, buildChild) {
    return _A2uiTextFieldWidget(node: node);
  },
);

class _A2uiTextFieldWidget extends StatefulWidget {
  final ComponentNode<FlutterComponentImplementation> node;

  const _A2uiTextFieldWidget({required this.node});

  @override
  State<_A2uiTextFieldWidget> createState() => _A2uiTextFieldWidgetState();
}

class _A2uiTextFieldWidgetState extends State<_A2uiTextFieldWidget> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    final String initialText = widget.node.stringValue('value') ?? '';
    _controller = TextEditingController(text: initialText);
  }

  @override
  void didUpdateWidget(_A2uiTextFieldWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    final String currentModelValue = widget.node.stringValue('value') ?? '';
    if (_controller.text != currentModelValue) {
      _controller.text = currentModelValue;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final String label = widget.node.stringValue('label') ?? '';
    final String? variant = widget.node.stringValue('variant');
    final isObscured = variant == 'obscured';
    final isLongText = variant == 'longText';
    final isNumber = variant == 'number';

    final WritableBinding<dynamic>? binding = widget.node
        .writableBinding<dynamic>('value');

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: TextField(
        controller: _controller,
        obscureText: isObscured,
        maxLines: isLongText ? 4 : 1,
        keyboardType: isNumber ? TextInputType.number : TextInputType.text,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 8,
          ),
        ),
        onChanged: (newText) {
          if (binding != null) {
            binding.set(newText);
          }
        },
      ),
    );
  }
}
