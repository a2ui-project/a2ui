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

import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'links.dart';
import 'triage_scope.dart';

/// How the list shows an item of [kind]: its name, icon and color.
(String, IconData, Color) kindStyle(BuildContext context, ItemKind kind) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  Color shade(MaterialColor color) => dark ? color.shade300 : color.shade700;
  return switch (kind) {
    ItemKind.issue => ('Issue', Icons.adjust, shade(Colors.green)),
    ItemKind.prWithIssues => (
      'PR with issues',
      Icons.call_merge,
      shade(Colors.deepPurple),
    ),
    ItemKind.prWithoutIssues => (
      'PR without issues',
      Icons.link_off,
      shade(Colors.orange),
    ),
  };
}

/// The background of an item of a kind with [color].
Color kindBackground(Color color) => color.withValues(alpha: 0.08);

/// The items, in the groups `ui.blueprint.md` describes: **New**, **Needs
/// team input**, and the items opened by URL that are not in the queue.
///
/// The groups start collapsed. When the controller selects an item on its
/// own, such as an item opened by URL, the list expands the item's group
/// and scrolls to the item.
class ItemList extends StatefulWidget {
  const ItemList({super.key});

  @override
  State<ItemList> createState() => _ItemListState();
}

class _ItemListState extends State<ItemList> {
  final Set<String> _expanded = {};
  final GlobalKey _selectedKey = GlobalKey();
  var _revealCount = 0;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final int? selected = controller.selected?.number;
    final sections = <(String, List<TriageItem>)>[
      ('New', controller.newItems),
      ('Needs team input', controller.teamInputItems),
      if (controller.opened.isNotEmpty) ('Not in the queue', controller.opened),
    ];
    if (controller.revealCount != _revealCount) {
      _revealCount = controller.revealCount;
      for (final (String title, List<TriageItem> items) in sections) {
        for (final i in items) {
          if (i.number == selected) {
            _expanded.addAll([title, _subgroupKey(title, i.kind)]);
          }
        }
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final BuildContext? tile = _selectedKey.currentContext;
        if (tile != null && tile.mounted) {
          Scrollable.ensureVisible(
            tile,
            alignment: 0.3,
            duration: const Duration(milliseconds: 200),
          );
        }
      });
    }

    // Not a lazy list, so that every tile exists to scroll to.
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (String title, List<TriageItem> items) in sections) ...[
            _GroupHeader(
              '$title (${items.length})',
              expanded: _expanded.contains(title),
              onTap: () => setState(() {
                if (!_expanded.remove(title)) _expanded.add(title);
              }),
            ),
            if (_expanded.contains(title))
              for (final ItemKind kind in ItemKind.values)
                ..._subgroup(_subgroupKey(title, kind), kind, [
                  for (final i in items)
                    if (i.kind == kind) i,
                ], selected: selected),
          ],
        ],
      ),
    );
  }

  /// The header of the subgroup of [kind] with [key], and its [items] if it
  /// is expanded. Nothing if there are no [items].
  List<Widget> _subgroup(
    String key,
    ItemKind kind,
    List<TriageItem> items, {
    required int? selected,
  }) {
    if (items.isEmpty) return const [];
    final bool expanded = _expanded.contains(key);
    final (_, IconData icon, Color color) = kindStyle(context, kind);
    return [
      _GroupHeader(
        '${switch (kind) {
          ItemKind.issue => 'Issues',
          ItemKind.prWithIssues => 'PRs with issues',
          ItemKind.prWithoutIssues => 'PRs without issues',
        }} (${items.length})',
        expanded: expanded,
        indent: 24,
        icon: Icon(icon, size: 18, color: color),
        onTap: () => setState(() {
          if (!_expanded.remove(key)) _expanded.add(key);
        }),
      ),
      if (expanded)
        for (final TriageItem item in items)
          _ItemTile(
            item,
            key: item.number == selected ? _selectedKey : ValueKey(item.number),
          ),
    ];
  }
}

/// The key of the subgroup of [kind] in the group [title], in
/// `_ItemListState._expanded`.
String _subgroupKey(String title, ItemKind kind) => '$title/${kind.name}';

class _GroupHeader extends StatelessWidget {
  const _GroupHeader(
    this.title, {
    required this.expanded,
    required this.onTap,
    this.indent = 0,
    this.icon,
  });

  final String title;
  final bool expanded;
  final VoidCallback onTap;

  /// How far the header is indented, for a subgroup.
  final double indent;

  /// The icon of the subgroup's kind of items.
  final Widget? icon;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: expanded ? 'Collapse the group' : 'Expand the group',
    child: InkWell(
      onTap: onTap,
      child: Padding(
        padding: EdgeInsets.fromLTRB(8 + indent, indent > 0 ? 6 : 12, 16, 6),
        child: Row(
          spacing: 4,
          children: [
            Icon(expanded ? Icons.expand_more : Icons.chevron_right),
            ?icon,
            Text(
              title,
              style: indent > 0
                  ? Theme.of(context).textTheme.labelLarge
                  : Theme.of(context).textTheme.titleSmall,
            ),
          ],
        ),
      ),
    ),
  );
}

class _ItemTile extends StatelessWidget {
  const _ItemTile(this.item, {super.key});

  final TriageItem item;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final ThemeData theme = Theme.of(context);
    final bool applied = controller.session.isApplied(item.number);
    final bool sentToTeam = controller.session.isSentToTeam(item.number);
    final (String kind, IconData icon, Color color) = kindStyle(
      context,
      item.kind,
    );
    final selected = controller.selected?.number == item.number;
    // The selected item has a border. Its colors stay the same, so that the
    // kind's background still shows; ListTile.selected would change them.
    final tile = ListTile(
      tileColor: kindBackground(color),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(6),
        side: selected
            ? BorderSide(color: theme.colorScheme.primary, width: 2)
            : BorderSide.none,
      ),
      leading: Tooltip(
        message: kind,
        child: Icon(icon, color: color, semanticLabel: kind),
      ),
      title: Text(
        '#${item.number} ${item.title}',
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Wrap(
          spacing: 6,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text('updated ${ago(item.updatedAt)}'),
            switch (item.suggestionStatus) {
              SuggestionStatus.current => const _Flag('suggestion'),
              SuggestionStatus.outdated => const _Flag(
                'outdated suggestion',
                warning: true,
              ),
              SuggestionStatus.invalid => const _Flag(
                'invalid suggestion',
                warning: true,
              ),
              SuggestionStatus.none => const _Flag(
                'no suggestion',
                warning: true,
              ),
            },
            for (final int n in item.linkedItems)
              _Flag(item.isPullRequest ? 'issue #$n' : 'PR #$n'),
            if (item.needsTeamInput) const _Flag('needs team input'),
          ],
        ),
      ),
      trailing: applied
          ? Icon(
              Icons.check_circle,
              color: theme.colorScheme.primary,
              semanticLabel: 'Applied',
            )
          : sentToTeam
          ? Icon(
              Icons.groups,
              color: theme.colorScheme.primary,
              semanticLabel: 'Sent to the team',
            )
          : null,
      // A second click on the selected item deselects it.
      onTap: () =>
          selected ? controller.deselect() : controller.select(item.number),
    );
    return Semantics(selected: selected, child: tile);
  }
}

class _Flag extends StatelessWidget {
  const _Flag(this.text, {this.warning = false});

  final String text;
  final bool warning;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: warning ? colors.tertiaryContainer : colors.secondaryContainer,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
        child: Text(
          text,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: warning
                ? colors.onTertiaryContainer
                : colors.onSecondaryContainer,
          ),
        ),
      ),
    );
  }
}
