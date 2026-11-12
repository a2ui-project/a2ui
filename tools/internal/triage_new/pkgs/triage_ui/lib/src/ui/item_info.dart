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
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import '../model/suggestion_draft.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'dates.dart';
import 'label_colors.dart';
import 'links.dart';
import 'triage_scope.dart';

/// What the triager should know about [item]: its title, age, author,
/// labels and assignees, notices about its state, the triage bot's summary,
/// reason and suggestion, the comment for the team, and the related items.
///
/// The details show it in their left column, next to the editable
/// suggestion.
class ItemInfo extends StatelessWidget {
  const ItemInfo({super.key, required this.item});

  final TriageItem item;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final SuggestionDraft draft = controller.draftFor(item);
    final String? suggestionUrl = item.suggestionUrl;
    String none(List<String> names) =>
        names.isEmpty ? 'none' : names.join(', ');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 12,
      children: [
        LinkText('${item.name}: ${item.title}', url: item.url),
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
            'The item changed on GitHub, so the suggestion shows its '
            'current state, and your edits to it are gone.',
            warning: true,
          ),
        // The list already says that the item has no suggestion, and the
        // suggestion heading shows that it is outdated.
        if (item.suggestionStatus == SuggestionStatus.invalid)
          _Notice(
            'The suggestion comment does not hold a valid suggestion, '
            'so the suggestion is empty. ${item.suggestionError}',
            warning: true,
            url: suggestionUrl,
            linkText: 'Open the comment',
          ),
        if (draft.summary case final String summary) _Text('Summary', summary),
        if (draft.reason case final String reason)
          _Text('Why flagged for triage', reason),
        if (draft.suggestion case final String suggestion)
          _Text(
            'Suggestion',
            suggestion,
            label: item.suggestionStatus == SuggestionStatus.outdated
                ? const _OutdatedLabel()
                : null,
          ),
        if (item.teamNote case final TeamNote note)
          _Text(
            'From ${note.author == null ? 'triager' : '@${note.author}'} '
            'for team discussion',
            note.text,
          ),
        // The duplicate changes as the triager edits it.
        ListenableBuilder(
          listenable: draft,
          builder: (context, _) => _RelatedItems(item: item, draft: draft),
        ),
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

/// [text], rendered as Markdown, under [title].
class _Text extends StatelessWidget {
  const _Text(this.title, this.text, {this.label});

  final String title;
  final String text;

  /// Shown after [title], such as [_OutdatedLabel].
  final Widget? label;

  @override
  Widget build(BuildContext context) {
    final Widget? label = this.label;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 4,
      children: [
        Wrap(
          spacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleSmall),
            ?label,
          ],
        ),
        MarkdownBody(
          data: text,
          onTapLink: (String text, String? href, String title) {
            if (href != null) openUrl(href);
          },
        ),
      ],
    );
  }
}

/// Marks an outdated suggestion, as GitHub marks an outdated review
/// comment: a small yellow label.
class _OutdatedLabel extends StatelessWidget {
  const _OutdatedLabel();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final yellow = dark ? const Color(0xFFD29922) : const Color(0xFF9A6700);
    return Tooltip(
      message: 'Something happened on the item after the triage bot commented.',
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: yellow.withValues(alpha: dark ? 0.15 : 0.1),
          border: Border.all(color: yellow.withValues(alpha: 0.4)),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
          child: Text(
            'Outdated',
            style: Theme.of(
              context,
            ).textTheme.labelSmall?.copyWith(color: yellow),
          ),
        ),
      ),
    );
  }
}

/// Links to the items that the item is linked to, and to the ones the
/// suggestion names.
class _RelatedItems extends StatelessWidget {
  const _RelatedItems({required this.item, required this.draft});

  final TriageItem item;
  final SuggestionDraft draft;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final int? duplicateOf = draft.toSuggestion().duplicateOf;
    // "(closed)" or "(merged)" once the item is known to be.
    // The numbers are in the item's repository.
    String closed(int n) => switch (controller.closedAs(item.refTo(n))) {
      final String state => ' ($state)',
      null => '',
    };
    String issue(int n) => issueUrl(item.refTo(n));
    String pullRequest(int n) => pullRequestUrl(item.refTo(n));
    final links = <(String, String)>[
      for (final int n in item.linkedItems)
        item.isPullRequest
            ? ('Fixes issue #$n${closed(n)}', issue(n))
            : ('Fixed by PR #$n${closed(n)}', pullRequest(n)),
      if (duplicateOf != null)
        (
          'Duplicate of #$duplicateOf${closed(duplicateOf)}',
          issue(duplicateOf),
        ),
      for (final int n in draft.relatedIssues)
        ('Issue #$n${closed(n)}', issue(n)),
      for (final int n in draft.relatedPrs)
        ('PR #$n${closed(n)}', pullRequest(n)),
    ];
    if (links.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 4,
      children: [
        Text('Related items', style: Theme.of(context).textTheme.titleSmall),
        Wrap(
          spacing: 12,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            for (final (String text, String url) in links)
              Row(
                mainAxisSize: MainAxisSize.min,
                spacing: 2,
                children: [
                  ActionChip(
                    label: Text(text),
                    tooltip: url,
                    onPressed: () => openUrl(url),
                  ),
                  CopyLinkButton(url),
                ],
              ),
          ],
        ),
      ],
    );
  }
}
