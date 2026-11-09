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
/// The triager adds a name by typing it and pressing Enter, by picking one
/// of [options] as they type, or by checking it in the dropdown of
/// [options]. They remove a name with its chip's delete button, or by
/// unchecking it in the dropdown.
class ChipListField extends StatefulWidget {
  const ChipListField({
    super.key,
    required this.label,
    required this.values,
    required this.onChanged,
    required this.chooseTooltip,
    this.options = const [],
  });

  final String label;
  final List<String> values;
  final ValueChanged<List<String>> onChanged;

  /// The tooltip of the button that opens the dropdown, such as "Choose
  /// labels to add".
  final String chooseTooltip;

  /// The names to suggest as the triager types, and to show in the
  /// dropdown.
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

  void _toggle(String name, {required bool checked}) => widget.onChanged(
    checked
        ? [...widget.values, name]
        : [
            for (final v in widget.values)
              if (v != name) v,
          ],
  );

  @override
  void dispose() {
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // The values that are not among the options, such as names that the
    // triager typed, come first, so that they can be unchecked too.
    final List<String> choices = [
      for (final v in widget.values)
        if (!widget.options.contains(v)) v,
      ...widget.options,
    ];
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
          MenuAnchor(
            menuChildren: [
              for (final String choice in choices)
                CheckboxMenuButton(
                  value: widget.values.contains(choice),
                  closeOnActivate: false,
                  onChanged: (bool? checked) =>
                      _toggle(choice, checked: checked ?? false),
                  child: Text(choice),
                ),
            ],
            builder: (context, menu, _) => IconButton(
              icon: const Icon(Icons.arrow_drop_down),
              tooltip: widget.chooseTooltip,
              onPressed: choices.isEmpty
                  ? null
                  : () => menu.isOpen ? menu.close() : menu.open(),
            ),
          ),
        ],
      ),
    );
  }
}
