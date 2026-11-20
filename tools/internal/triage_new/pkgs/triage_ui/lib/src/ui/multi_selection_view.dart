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

import '../model/draft_changes.dart';
import '../model/suggestion_draft.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'group_actions.dart';
import 'item_list.dart';
import 'label_colors.dart';
import 'triage_scope.dart';

/// The details when the triager selected several [items] with Shift-click:
/// the changes that **Apply** makes to all of them, then each item's other
/// changes, not editable, and **Apply** below them. See "Several selected
/// items" in `ui.blueprint.md`.
class MultiSelectionView extends StatelessWidget {
  const MultiSelectionView({super.key, required this.items});

  /// The selected items, in the order the triager selected them.
  final List<TriageItem> items;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final List<SuggestionDraft> drafts = [
      for (final i in items) controller.draftFor(i),
    ];
    final TextTheme text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: ListenableBuilder(
            listenable: Listenable.merge(drafts),
            builder: (context, _) {
              final List<List<DraftChange>> changes = [
                for (var k = 0; k < items.length; k++)
                  draftChanges(items[k], drafts[k]),
              ];
              final List<DraftChange> shared = sharedChanges(changes);
              return ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  Text(
                    '${items.length} items selected',
                    style: text.titleLarge,
                  ),
                  const SizedBox(height: 24),
                  Text('Shared changes', style: text.titleMedium),
                  const SizedBox(height: 8),
                  if (shared.isEmpty)
                    const Text('No changes are shared by all the items.')
                  else
                    _ChangeList(shared, item: items.first),
                  const SizedBox(height: 24),
                  Text('Individual changes', style: text.titleMedium),
                  for (var k = 0; k < items.length; k++) ...[
                    const SizedBox(height: 16),
                    _ItemHeading(items[k]),
                    const SizedBox(height: 8),
                    if (changes[k].isEmpty)
                      const Text('No changes. Apply skips this item.')
                    else if (changes[k].every(shared.contains))
                      const Text('No other changes.')
                    else
                      _ChangeList([
                        for (final c in changes[k])
                          if (!shared.contains(c)) c,
                      ], item: items[k]),
                  ],
                ],
              );
            },
          ),
        ),
        const Divider(height: 1),
        GroupActions(items: items),
      ],
    );
  }
}

/// An item's icon, short name and title, above its changes.
class _ItemHeading extends StatelessWidget {
  const _ItemHeading(this.item);

  final TriageItem item;

  @override
  Widget build(BuildContext context) {
    final (String kind, IconData icon, Color color) = kindStyle(
      context,
      item.kind,
    );
    return Row(
      spacing: 8,
      children: [
        Icon(icon, size: 18, color: color, semanticLabel: kind),
        Expanded(
          child: Text(
            '${item.shortName} ${item.title}',
            style: Theme.of(context).textTheme.titleSmall,
          ),
        ),
      ],
    );
  }
}

/// [changes], one per line, with labels in their colors in the repository
/// of [item] and replies quoted.
class _ChangeList extends StatelessWidget {
  const _ChangeList(this.changes, {required this.item});

  final List<DraftChange> changes;
  final TriageItem item;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final Map<String, String> colors = TriageScope.of(
      context,
    ).repositoryInfo(item.repository).labelColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 6,
      children: [
        for (final (:String kind, :String value) in changes)
          switch (kind) {
            'Reply' => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 4,
              children: [
                const Text('Reply:'),
                DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border(
                      left: BorderSide(
                        color: theme.colorScheme.outlineVariant,
                        width: 3,
                      ),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.only(left: 12),
                    child: Text(value),
                  ),
                ),
              ],
            ),
            'Add label' || 'Remove label' => Row(
              spacing: 8,
              children: [
                Text('$kind:'),
                Flexible(
                  child: LabelPill(value, colors: labelColors(colors[value])),
                ),
              ],
            ),
            'Close' => Text(value.isEmpty ? 'Close' : 'Close $value'),
            _ => Text('$kind: $value'),
          },
      ],
    );
  }
}
