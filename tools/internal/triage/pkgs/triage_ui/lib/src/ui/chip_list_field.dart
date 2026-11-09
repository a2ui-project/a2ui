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
    required this.values,
    required this.onChanged,
    required this.label,
    required this.chooseTooltip,
    this.options = const [],
  });

  /// The title on the field's border, such as "Add labels".
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

/// The dropdown has a search field when it has more choices than this.
const int _searchThreshold = 7;

class _ChipListFieldState extends State<ChipListField> {
  final TextEditingController _text = TextEditingController();
  final FocusNode _focus = FocusNode();

  /// The text in the dropdown's search field.
  final TextEditingController _search = TextEditingController();

  /// The values when the dropdown opened, which it lists first. They are
  /// not updated while it is open, so that the choices do not move as the
  /// triager checks and unchecks them.
  Set<String> _checkedOnOpen = const {};

  @override
  void initState() {
    super.initState();
    _search.addListener(() => setState(() {}));
  }

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
    _search.dispose();
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // The options, and the values that are not among them, such as names
    // that the triager typed, so that they can be unchecked too.
    final List<String> all = [
      for (final v in widget.values)
        if (!widget.options.contains(v)) v,
      ...widget.options,
    ];
    // The checked choices first.
    final List<String> choices = [
      for (final c in all)
        if (_checkedOnOpen.contains(c)) c,
      for (final c in all)
        if (!_checkedOnOpen.contains(c)) c,
    ];
    final bool searchable = choices.length > _searchThreshold;
    final String query = searchable ? _search.text.trim().toLowerCase() : '';
    final List<String> shown = [
      for (final c in choices)
        if (c.toLowerCase().contains(query)) c,
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
                    decoration: const InputDecoration.collapsed(hintText: null),
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
            onOpen: () => setState(() => _checkedOnOpen = {...widget.values}),
            onClose: _search.clear,
            menuChildren: [
              if (searchable)
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
                  child: SizedBox(
                    width: 280,
                    child: TextField(
                      controller: _search,
                      autofocus: true,
                      decoration: const InputDecoration(
                        hintText: 'Filter',
                        prefixIcon: Icon(Icons.search, size: 20),
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                ),
              if (shown.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Text('Nothing matches'),
                ),
              for (final String choice in shown)
                _Choice(
                  choice,
                  checked: widget.values.contains(choice),
                  // A choice under the mouse would take the cursor from
                  // the search field.
                  requestFocusOnHover: !searchable,
                  onChanged: (bool checked) =>
                      _toggle(choice, checked: checked),
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

/// A choice in the dropdown, with a checkbox. Unlike [CheckboxMenuButton],
/// it can keep the mouse from taking the focus.
class _Choice extends StatelessWidget {
  const _Choice(
    this.name, {
    required this.checked,
    required this.requestFocusOnHover,
    required this.onChanged,
  });

  final String name;
  final bool checked;
  final bool requestFocusOnHover;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => Semantics(
    checked: checked,
    child: MenuItemButton(
      closeOnActivate: false,
      requestFocusOnHover: requestFocusOnHover,
      leadingIcon: Icon(
        checked ? Icons.check_box : Icons.check_box_outline_blank,
        color: checked ? Theme.of(context).colorScheme.primary : null,
      ),
      onPressed: () => onChanged(!checked),
      child: Text(name),
    ),
  );
}
