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
import 'package:triage/triage.dart';

import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'label_colors.dart';
import 'links.dart';
import 'suggestion_editor.dart';
import 'suggestion_surface.dart';
import 'triage_scope.dart';

/// The selected item, and the items linked to it that need triage, each
/// with its editable suggestion.
class ItemDetails extends StatelessWidget {
  const ItemDetails({super.key});

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final TriageItem? item = controller.selected;
    if (item == null) {
      return const Center(child: Text('Select an item.'));
    }
    final List<TriageItem> related = controller.relatedInQueue(item);
    return ListView(
      key: ValueKey(item.number),
      padding: const EdgeInsets.all(24),
      children: [
        ItemCard(key: ValueKey(item.number), item: item),
        for (final TriageItem other in related) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(0, 32, 0, 8),
            child: Text(
              'Linked ${other.isPullRequest ? 'PR' : 'issue'} that needs '
              'triage',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          ItemCard(key: ValueKey(other.number), item: other),
        ],
      ],
    );
  }
}

/// One item, what the triager should know about it, and its suggestion.
class ItemCard extends StatelessWidget {
  const ItemCard({super.key, required this.item});

  final TriageItem item;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final ThemeData theme = Theme.of(context);
    final SuggestionPayload? payload = item.suggestion;
    final String? suggestionUrl = item.suggestionUrl;
    String none(List<String> names) =>
        names.isEmpty ? 'none' : names.join(', ');

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 12,
          children: [
            LinkText(
              '${item.name}: ${item.title}',
              url: item.url,
              style: theme.textTheme.titleLarge,
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 4,
              children: [
                Text('Age: ${age(item.createdAt)}.'),
                Text('Author: ${item.author ?? 'a deleted account'}.'),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    const Text('Labels:'),
                    if (item.labels.isEmpty) const Text('none.'),
                    for (final String label in item.labels)
                      LabelPill(
                        label,
                        colors: labelColors(
                          controller.repositoryInfo.labelColors[label],
                        ),
                      ),
                  ],
                ),
                Text('Assignees: ${none(item.assignees)}.'),
              ],
            ),
            if (controller.session.isApplied(item.number))
              const _Notice(
                'You applied a suggestion to this item in this session.',
                icon: Icons.check_circle_outline,
              ),
            if (controller.session.isSentToTeam(item.number))
              const _Notice(
                'You sent this item to the team in this session.',
                icon: Icons.groups_outlined,
              ),
            if (!item.isOpen) const _Notice('The item is closed.'),
            if (item.needsTeamInput)
              const _Notice(
                'The item has "$needsTeamInputLabel". Apply removes the '
                'label, unless the suggestion adds it.',
              )
            else if (!item.needsTriage)
              const _Notice('The item does not have "$needsTriageLabel".'),
            if (controller.changedOnGitHub(item.number))
              const _Notice(
                'The item changed on GitHub, so the suggestion below shows '
                'its current state, and your edits to it are gone.',
                warning: true,
              ),
            switch (item.suggestionStatus) {
              // The list already says that the item has no suggestion.
              SuggestionStatus.current ||
              SuggestionStatus.none => const SizedBox.shrink(),
              SuggestionStatus.invalid => _Notice(
                'The suggestion comment does not hold a valid suggestion, '
                'so the one below is empty. ${item.suggestionError}',
                warning: true,
                url: suggestionUrl,
                linkText: 'Open the comment',
              ),
              SuggestionStatus.outdated => _Notice(
                'The suggestion is outdated: something happened on the item '
                'after the advisor commented. Read the new activity before '
                'you apply it.',
                warning: true,
                url: item.url,
                linkText: 'Open the item',
              ),
            },
            const Divider(),
            if (payload != null)
              SuggestionSurface(item: item, payload: payload)
            else
              SuggestionEditor(item: item),
          ],
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice(
    this.text, {
    this.warning = false,
    this.icon,
    this.url,
    this.linkText,
  });

  final String text;
  final bool warning;
  final IconData? icon;
  final String? url;
  final String? linkText;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    final String? url = this.url;
    return Row(
      spacing: 8,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          icon ?? (warning ? Icons.warning_amber : Icons.info_outline),
          size: 20,
          color: warning ? colors.tertiary : colors.primary,
        ),
        Expanded(
          child: Wrap(
            spacing: 8,
            children: [
              Text(text),
              if (url != null) LinkText(linkText ?? url, url: url),
            ],
          ),
        ),
      ],
    );
  }
}
