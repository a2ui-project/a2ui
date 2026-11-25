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

import 'package:material_ui/material_ui.dart';

import 'label_colors.dart';

/// The names that a [ChipListField] adds to an item and removes from it.
typedef ChipListChange = ({List<String> added, List<String> removed});

/// A field that shows the names an item will have once the draft is
/// applied, such as its labels or assignees, as chips, with what changes
/// marked.
///
/// A name the item keeps is a plain chip, a name to add has a `+`, and a
/// name to remove is struck through; clicking it keeps the name. The
/// triager adds and removes names by checking them in a dropdown of
/// [options], which opens from anywhere in the field, or removes a name
/// with its chip's delete button.
class ChipListField extends StatefulWidget {
  const ChipListField({
    super.key,
    required this.label,
    required this.chooseTooltip,
    required this.current,
    required this.added,
    required this.removed,
    required this.onChanged,
    this.options = const [],
    this.fixedRemovals = const [],
    this.fixedRemovalTooltip = _fixedTooltip,
    this.colorsOf,
    this.single = false,
    this.enabled = true,
  });

  static String _fixedTooltip(String name) => 'Apply removes $name';

  /// The title on the field's border, such as "Labels".
  final String label;

  /// The tooltip of the button that opens the dropdown, such as "Choose
  /// labels".
  final String chooseTooltip;

  /// The names the item has now.
  final List<String> current;

  /// The names to add. A name the item already has counts as kept.
  final List<String> added;

  /// The names to remove. One the item does not have is shown struck
  /// through too, so that the triager sees it and can drop it.
  final List<String> removed;

  final ValueChanged<ChipListChange> onChanged;

  /// The names to offer in the dropdown, besides [current] and [added].
  final List<String> options;

  /// Names that apply removes whatever the triager does, such as
  /// `status: needs-triage`. They are struck through, cannot be kept, and
  /// are not in the dropdown.
  final List<String> fixedRemovals;

  /// The tooltip of a name in [fixedRemovals].
  final String Function(String name) fixedRemovalTooltip;

  /// The colors to show a name in, such as a label's colors on GitHub.
  /// Names without colors, and every name if this is null, have the theme's
  /// colors.
  final LabelColors? Function(String name)? colorsOf;

  /// Whether the item has at most one of the names, such as a milestone.
  /// Adding a name then replaces the one the item has.
  final bool single;

  /// Whether the triager can change the field.
  final bool enabled;

  @override
  State<ChipListField> createState() => _ChipListFieldState();
}

/// The dropdown has a search field when it has more choices than this.
const int _searchThreshold = 7;

class _ChipListFieldState extends State<ChipListField> {
  final MenuController _menu = MenuController();

  /// The text in the dropdown's search field.
  final TextEditingController _search = TextEditingController();

  /// The names that were checked when the dropdown opened, which it lists
  /// first. They are not updated while it is open, so that the choices do
  /// not move as the triager checks and unchecks them.
  Set<String> _checkedOnOpen = const {};

  @override
  void initState() {
    super.initState();
    _search.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  /// Whether a name the item has is replaced by an added one.
  bool get _replaced => widget.single && _added.isNotEmpty;

  /// The added names that the item does not have yet.
  List<String> get _added => [
    for (final a in widget.added)
      if (!widget.current.contains(a)) a,
  ];

  bool _isRemoved(String name) => _replaced || widget.removed.contains(name);

  /// The names the item has once the draft is applied.
  Set<String> get _final => {
    for (final c in widget.current)
      if (!_isRemoved(c)) c,
    ..._added,
  };

  void _change({required List<String> added, required List<String> removed}) =>
      widget.onChanged((added: added, removed: removed));

  void _check(String name) {
    if (widget.current.contains(name)) {
      _change(
        added: widget.single ? const [] : widget.added,
        removed: [
          for (final r in widget.removed)
            if (r != name) r,
        ],
      );
    } else if (widget.single) {
      _change(added: [name], removed: const []);
    } else {
      _change(added: [...widget.added, name], removed: widget.removed);
    }
  }

  void _uncheck(String name) => _change(
    added: [
      for (final a in widget.added)
        if (a != name) a,
    ],
    removed: [
      ...widget.removed,
      if (widget.current.contains(name) && !widget.removed.contains(name)) name,
    ],
  );

  /// Keeps [name], which the draft removes.
  void _keep(String name) {
    if (_replaced && widget.current.contains(name)) {
      _change(added: const [], removed: widget.removed);
    } else {
      _change(
        added: widget.added,
        removed: [
          for (final r in widget.removed)
            if (r != name) r,
        ],
      );
    }
  }

  void _toggleMenu() => _menu.isOpen ? _menu.close() : _menu.open();

  @override
  Widget build(BuildContext context) {
    final bool enabled = widget.enabled;
    final Set<String> finalNames = _final;
    // Every name the triager can check: the item's, the added ones, which
    // can be names the repository does not have, and the options.
    final List<String> all = [
      for (final n in {...widget.current, ...widget.added})
        if (!widget.options.contains(n)) n,
      ...widget.options,
    ].where((n) => !widget.fixedRemovals.contains(n)).toList();
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
    final bool canChoose = enabled && choices.isNotEmpty;

    final List<Widget> chips = [
      for (final c in widget.current)
        if (_isRemoved(c))
          _RemovedChip(c, onKeep: enabled ? () => _keep(c) : null)
        else
          _KeptChip(
            c,
            colors: widget.colorsOf?.call(c),
            onRemove: enabled ? () => _uncheck(c) : null,
          ),
      for (final r in widget.removed)
        if (!widget.current.contains(r))
          _RemovedChip(r, onKeep: enabled ? () => _keep(r) : null),
      for (final f in widget.fixedRemovals)
        _RemovedChip(f, tooltip: widget.fixedRemovalTooltip(f)),
      for (final a in _added)
        _KeptChip(
          a,
          added: true,
          colors: widget.colorsOf?.call(a),
          onRemove: enabled ? () => _uncheck(a) : null,
        ),
    ];

    return MenuAnchor(
      controller: _menu,
      onOpen: () => setState(() => _checkedOnOpen = finalNames),
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
            colors: widget.colorsOf?.call(choice),
            checked: finalNames.contains(choice),
            // A choice under the mouse would take the cursor from the
            // search field.
            requestFocusOnHover: !searchable,
            onChanged: (bool checked) =>
                checked ? _check(choice) : _uncheck(choice),
          ),
      ],
      builder: (context, _, _) => InkWell(
        onTap: canChoose ? _toggleMenu : null,
        borderRadius: BorderRadius.circular(4),
        child: InputDecorator(
          isEmpty: chips.isEmpty,
          decoration: InputDecoration(
            labelText: widget.label,
            enabled: enabled,
            border: const OutlineInputBorder(),
            suffixIcon: IconButton(
              icon: const Icon(Icons.arrow_drop_down),
              tooltip: widget.chooseTooltip,
              onPressed: canChoose ? _toggleMenu : null,
            ),
          ),
          child: chips.isEmpty
              ? null
              : Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: chips,
                ),
        ),
      ),
    );
  }
}

/// A name the item keeps or gets, with a delete button. An [added] name has
/// a `+` before it.
class _KeptChip extends StatelessWidget {
  const _KeptChip(
    this.name, {
    required this.onRemove,
    this.colors,
    this.added = false,
  });

  final String name;
  final LabelColors? colors;
  final bool added;

  /// Removes the name, or null if the field is disabled.
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final LabelColors? colors = this.colors;
    final chip = InputChip(
      avatar: added
          ? Icon(Icons.add, size: 16, color: colors?.foreground)
          : null,
      label: Text(name),
      backgroundColor: colors?.background,
      labelStyle: colors == null ? null : TextStyle(color: colors.foreground),
      deleteIconColor: colors?.foreground,
      side: colors == null ? null : BorderSide.none,
      onDeleted: onRemove,
      deleteButtonTooltipMessage: 'Remove $name',
    );
    // A chip without a tap action shows no tooltip of its own.
    return added ? Tooltip(message: 'Apply adds $name', child: chip) : chip;
  }
}

/// A name that apply removes, struck through. Clicking it keeps the name,
/// unless [onKeep] is null.
class _RemovedChip extends StatelessWidget {
  const _RemovedChip(this.name, {this.onKeep, this.tooltip});

  final String name;
  final VoidCallback? onKeep;

  /// The tooltip, which defaults to what clicking the chip does.
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final Color muted = Theme.of(context).colorScheme.onSurfaceVariant;
    // A disabled chip shows no tooltip of its own.
    return Tooltip(
      message:
          tooltip ?? (onKeep == null ? 'Apply removes $name' : 'Keep $name'),
      child: ActionChip(
        avatar: onKeep == null
            ? null
            : Icon(Icons.undo, size: 16, color: muted),
        label: Text(
          name,
          style: TextStyle(
            color: muted,
            decoration: TextDecoration.lineThrough,
          ),
        ),
        onPressed: onKeep,
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
    this.colors,
  });

  final String name;

  /// The colors of the name, shown as a dot before it, as GitHub does.
  final LabelColors? colors;
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
      child: Row(
        mainAxisSize: MainAxisSize.min,
        spacing: 8,
        children: [
          if (colors case final LabelColors colors)
            DecoratedBox(
              decoration: BoxDecoration(
                color: colors.background,
                shape: BoxShape.circle,
              ),
              child: const SizedBox.square(dimension: 12),
            ),
          Text(name),
        ],
      ),
    ),
  );
}
