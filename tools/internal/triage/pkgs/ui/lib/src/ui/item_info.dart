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

import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared/shared.dart';

import '../model/suggestion_draft.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'dates.dart';
import 'label_colors.dart';
import 'links.dart';
import 'triage_scope.dart';

/// What the triager should know about [item]: its title, age, author,
/// labels and assignees, notices about its state, the triage bot's TL;DR,
/// summary, reason and suggestion, the comment for the team, and the related
/// items.
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
        if (!item.needsTriage && !item.needsTeamInput)
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
        if (draft.tldr case final String tldr) _Text('TL;DR', tldr),
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
          // As GitHub shows a comment: a line break starts a new line.
          softLineBreak: true,
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
            style: Theme.of(context).textTheme.labelSmall
                ?.copyWith(color: yellow),
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
    final int? duplicateOf = draft.toSuggestion().duplicateOf;
    // The number, its label, and whether it is a PR, if the label says.
    // The numbers are in the item's repository.
    final links = <(int, String, bool?)>[
      for (final int n in item.linkedItems)
        item.isPullRequest
            ? (n, 'Fixes issue #$n', false)
            : (n, 'Fixed by PR #$n', true),
      if (duplicateOf != null)
        (duplicateOf, 'Duplicate of #$duplicateOf', false),
      // The PRs and issues that GitHub links already have a link above.
      for (final int n in draft.targetingPrs)
        if (!item.linkedItems.contains(n)) (n, 'Targeted by PR #$n', true),
      for (final int n in draft.targetedIssues)
        if (!item.linkedItems.contains(n)) (n, 'Targets issue #$n', false),
      for (final int n in draft.relatedItems) (n, '#$n', null),
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
            for (final (int n, String text, bool? isPullRequest) in links)
              _RelatedItem(
                ref: item.refTo(n),
                text: text,
                isPullRequest: isPullRequest,
              ),
          ],
        ),
      ],
    );
  }
}

/// A link to the item that [ref] refers to, with an icon for its type, in
/// the color of its state, as GitHub shows them: green while it is open,
/// purple once it is merged, or closed for an issue, and red for a PR
/// closed without merging.
class _RelatedItem extends StatelessWidget {
  const _RelatedItem({
    required this.ref,
    required this.text,
    required this.isPullRequest,
  });

  final ItemRef ref;
  final String text;

  /// Whether the item is a PR, as [text] says, or null if it does not say.
  /// Once the item is loaded, the item says.
  final bool? isPullRequest;

  @override
  Widget build(BuildContext context) {
    final TriageItem? related = TriageScope.of(context).relatedItem(ref);
    final bool? pr = related?.isPullRequest ?? isPullRequest;
    // GitHub redirects the issue URL of a PR to the PR.
    final String url = pr ?? false ? pullRequestUrl(ref) : issueUrl(ref);
    final dark = Theme.of(context).brightness == Brightness.dark;
    Color shade(MaterialColor color) => dark ? color.shade300 : color.shade700;
    final (String? state, Color? color) = switch (related) {
      null => (null, null),
      TriageItem(isOpen: true) => ('Open', shade(Colors.green)),
      TriageItem(isMerged: true) => ('Merged', shade(Colors.purple)),
      TriageItem(isPullRequest: true) => ('Closed', shade(Colors.red)),
      TriageItem() => ('Closed', shade(Colors.purple)),
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      spacing: 2,
      children: [
        ActionChip(
          avatar: switch (pr) {
            null => null,
            true => Icon(
              Icons.call_merge,
              color: color,
              semanticLabel: state == null ? 'PR' : '$state PR',
            ),
            false => Icon(
              Icons.adjust,
              color: color,
              semanticLabel: state == null ? 'Issue' : '$state issue',
            ),
          },
          label: Text(text),
          tooltip: url,
          onPressed: () => openUrl(url),
        ),
        CopyLinkButton(url),
      ],
    );
  }
}
