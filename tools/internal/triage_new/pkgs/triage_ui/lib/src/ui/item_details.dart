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

import '../model/suggestion_draft.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'group_actions.dart';
import 'item_list.dart';
import 'label_colors.dart';
import 'links.dart';
import 'suggestion_editor.dart';
import 'suggestion_surface.dart';
import 'triage_scope.dart';

/// The selected item and the items linked to it, each in a tab with its
/// editable suggestion, and the buttons that act on all of them.
class ItemDetails extends StatelessWidget {
  const ItemDetails({super.key});

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final TriageItem? item = controller.selected;
    if (item == null) {
      return const Center(child: Text('Select an item.'));
    }
    final List<TriageItem> items = controller.group(item);
    return DefaultTabController(
      // A new controller when the items change, such as after a refresh.
      key: ValueKey(items.map((i) => i.url).join(',')),
      length: items.length,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [for (final i in items) _ItemTab(i)],
          ),
          Expanded(
            child: TabBarView(
              children: [
                for (final i in items)
                  ListView(
                    padding: const EdgeInsets.all(24),
                    children: [ItemView(key: ValueKey(i.ref), item: i)],
                  ),
              ],
            ),
          ),
          const Divider(height: 1),
          GroupActions(items: items),
        ],
      ),
    );
  }
}

/// The tab of [item]: its icon and short name, and a blue dot if the triager
/// edited its suggestion.
class _ItemTab extends StatelessWidget {
  const _ItemTab(this.item);

  final TriageItem item;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final SuggestionDraft draft = controller.draftFor(item);
    final (String kind, IconData icon, Color color) = kindStyle(
      context,
      item.kind,
    );
    return Tooltip(
      message: '${item.name}: ${item.title}',
      child: Tab(
        child: ListenableBuilder(
          listenable: draft,
          builder: (context, _) => Row(
            mainAxisSize: MainAxisSize.min,
            spacing: 6,
            children: [
              Icon(icon, size: 18, color: color, semanticLabel: kind),
              Text(item.shortName),
              if (draft.isEdited)
                const Tooltip(
                  message: 'Edited',
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Colors.blue,
                      shape: BoxShape.circle,
                    ),
                    child: SizedBox.square(dimension: 8),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One item, what the triager should know about it, and its suggestion.
class ItemView extends StatelessWidget {
  const ItemView({super.key, required this.item});

  final TriageItem item;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final ThemeData theme = Theme.of(context);
    final SuggestionPayload? payload = item.suggestion;
    final String? suggestionUrl = item.suggestionUrl;
    String none(List<String> names) =>
        names.isEmpty ? 'none' : names.join(', ');

    return Column(
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
                      controller
                          .repositoryInfo(item.repository)
                          .labelColors[label],
                    ),
                  ),
              ],
            ),
            Text('Assignees: ${none(item.assignees)}.'),
          ],
        ),
        if (controller.session.isApplied(item.ref))
          const _Notice(
            'You applied a suggestion to this item in this session.',
            icon: Icons.check_circle_outline,
          ),
        if (controller.session.isSentToTeam(item.ref))
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
        if (controller.changedOnGitHub(item.ref))
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
        if (payload != null)
          SuggestionSurface(item: item, payload: payload)
        else
          SuggestionEditor(item: item),
      ],
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
