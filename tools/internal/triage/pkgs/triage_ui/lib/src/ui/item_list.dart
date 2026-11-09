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
      Icons.call_merge,
      shade(Colors.orange),
    ),
  };
}

/// The items, in the groups `ui.blueprint.md` describes: **New**, **Needs
/// team input**, and the items opened by URL that are not in the queue.
class ItemList extends StatelessWidget {
  const ItemList({super.key});

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final sections = <(String, List<TriageItem>)>[
      ('New', controller.newItems),
      ('Needs team input', controller.teamInputItems),
      if (controller.opened.isNotEmpty) ('Not in the queue', controller.opened),
    ];
    return ListView(
      children: [
        const _Legend(),
        for (final (String title, List<TriageItem> items) in sections) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
            child: Text(
              '$title (${items.length})',
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          for (final TriageItem item in items) _ItemTile(item),
        ],
      ],
    );
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile(this.item);

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
    return ListTile(
      selected: controller.selected?.number == item.number,
      tileColor: color.withValues(alpha: 0.06),
      selectedTileColor: theme.colorScheme.secondaryContainer,
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
      onTap: () => controller.select(item.number),
    );
  }
}

/// What the colors of the items mean.
class _Legend extends StatelessWidget {
  const _Legend();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
    child: Wrap(
      spacing: 16,
      runSpacing: 4,
      children: [
        for (final ItemKind kind in ItemKind.values)
          if (kindStyle(context, kind) case (
            final String name,
            final IconData icon,
            final Color color,
          ))
            Row(
              mainAxisSize: MainAxisSize.min,
              spacing: 4,
              children: [
                Icon(icon, size: 16, color: color),
                Text(name, style: Theme.of(context).textTheme.labelMedium),
              ],
            ),
      ],
    ),
  );
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
