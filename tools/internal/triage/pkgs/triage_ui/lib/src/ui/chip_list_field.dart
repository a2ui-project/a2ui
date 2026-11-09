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

/// A field that holds a list of names, such as labels or logins, as chips.
///
/// The triager adds a name by picking one of [options] or by typing it and
/// pressing Enter, and removes one with its chip's delete button.
class ChipListField extends StatefulWidget {
  const ChipListField({
    super.key,
    required this.label,
    required this.values,
    required this.onChanged,
    this.options = const [],
  });

  final String label;
  final List<String> values;
  final ValueChanged<List<String>> onChanged;

  /// The names to suggest as the triager types.
  final List<String> options;

  @override
  State<ChipListField> createState() => _ChipListFieldState();
}

class _ChipListFieldState extends State<ChipListField> {
  final TextEditingController _text = TextEditingController();
  final FocusNode _focus = FocusNode();

  void _add(String value) {
    final String name = value.trim();
    _text.clear();
    if (name.isEmpty || widget.values.contains(name)) return;
    widget.onChanged([...widget.values, name]);
  }

  @override
  void dispose() {
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return InputDecorator(
      decoration: InputDecoration(
        labelText: widget.label,
        border: const OutlineInputBorder(),
      ),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          for (final String value in widget.values)
            InputChip(
              label: Text(value),
              onDeleted: () =>
                  widget.onChanged([...widget.values]..remove(value)),
              deleteButtonTooltipMessage: 'Remove $value',
            ),
          SizedBox(
            width: 240,
            child: RawAutocomplete<String>(
              textEditingController: _text,
              focusNode: _focus,
              optionsBuilder: (TextEditingValue typed) {
                final String query = typed.text.trim().toLowerCase();
                if (query.isEmpty) return const [];
                return widget.options.where(
                  (String o) =>
                      !widget.values.contains(o) &&
                      o.toLowerCase().contains(query),
                );
              },
              onSelected: _add,
              fieldViewBuilder: (context, controller, focusNode, _) =>
                  TextField(
                    controller: controller,
                    focusNode: focusNode,
                    decoration: InputDecoration.collapsed(
                      hintText: 'Add to ${widget.label.toLowerCase()}',
                    ),
                    onSubmitted: (String text) {
                      _add(text);
                      focusNode.requestFocus();
                    },
                  ),
              optionsViewBuilder: (context, onSelected, options) => Align(
                alignment: Alignment.topLeft,
                child: Material(
                  elevation: 4,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(
                      maxHeight: 240,
                      maxWidth: 320,
                    ),
                    child: ListView(
                      padding: EdgeInsets.zero,
                      shrinkWrap: true,
                      children: [
                        for (final String option in options)
                          ListTile(
                            dense: true,
                            title: Text(option),
                            onTap: () => onSelected(option),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
