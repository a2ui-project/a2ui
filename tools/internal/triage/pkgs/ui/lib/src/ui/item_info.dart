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

import '../model/analysis_draft.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'dates.dart';
import 'label_colors.dart';
import 'links.dart';
import 'triage_scope.dart';

/// What the triager should know about [item], in this order:
///
/// 1. What GitHub says: its title, age, author, labels, assignees and
///    milestone, notices about its state, and why the flagger flagged it.
/// 2. The triage bot's analysis, apart from the facts, since an agent
///    wrote it: the TL;DR, summary and suggestion.
/// 3. The comment for the team, and the related items.
/// 4. The item's description and comments, as GitHub shows them, so that
///    the triager can check the analysis without opening GitHub.
///
/// The details show it in their left column, next to the editable
/// analysis.
class ItemInfo extends StatelessWidget {
  const ItemInfo({super.key, required this.item});

  final TriageItem item;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final AnalysisDraft draft = controller.draftFor(item);
    final String? analysisUrl = item.analysisUrl;
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
            Text('Milestone: ${item.milestone ?? 'none'}.'),
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
            'The item changed on GitHub, so the analysis shows its '
            'current state, and your edits to it are gone.',
            warning: true,
          ),
        // The list already says that the item has no analysis.
        if (item.analysisStatus == AnalysisStatus.invalid)
          _Notice(
            'The analysis comment does not hold a valid analysis, '
            'so the analysis is empty. ${item.analysisError}',
            warning: true,
            url: analysisUrl,
            linkText: 'Open the comment',
          ),
        // The flagger's reason, which the analysis copies, is a fact.
        if (draft.reason case final String reason)
          _Text('Why flagged for triage', reason),
        if (draft.tldr != null ||
            draft.summary != null ||
            draft.suggestion != null)
          _AnalysisCard(item: item, draft: draft),
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
        _Discussion(item: item),
      ],
    );
  }
}

/// The triage bot's TL;DR, summary and suggestion, in a box of their own
/// under a heading that says an agent wrote them, whether they are current,
/// and where the comment is.
class _AnalysisCard extends StatelessWidget {
  const _AnalysisCard({required this.item, required this.draft});

  final TriageItem item;
  final AnalysisDraft draft;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final String? url = item.analysisUrl;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.secondaryContainer.withValues(alpha: 0.35),
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 12,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Icon(
                  Icons.smart_toy_outlined,
                  size: 20,
                  color: theme.colorScheme.secondary,
                ),
                Text('Triage bot analysis', style: theme.textTheme.titleSmall),
                Text(
                  '(agent-generated)',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                switch (item.analysisStatus) {
                  AnalysisStatus.outdated => const _StatusLabel.outdated(),
                  AnalysisStatus.current => const _StatusLabel.current(),
                  _ => const SizedBox.shrink(),
                },
                if (url != null) LinkText('Open the comment', url: url),
              ],
            ),
            if (draft.tldr case final String tldr) _Text('TL;DR', tldr),
            if (draft.summary case final String summary)
              _Text('Summary', summary, collapsible: true),
            if (draft.suggestion case final String suggestion)
              _Text('Suggestion', suggestion, collapsible: true),
          ],
        ),
      ),
    );
  }
}

/// The item's description and comments, oldest first, as GitHub shows
/// them, without the triage bot's analysis comments. The triager can
/// collapse them.
class _Discussion extends StatefulWidget {
  const _Discussion({required this.item});

  final TriageItem item;

  @override
  State<_Discussion> createState() => _DiscussionState();
}

class _DiscussionState extends State<_Discussion> {
  var _expanded = true;

  @override
  Widget build(BuildContext context) {
    final TriageItem item = widget.item;
    final int count = item.comments.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          onTap: () => setState(() => _expanded = !_expanded),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              spacing: 4,
              children: [
                Icon(_expanded ? Icons.expand_less : Icons.expand_more),
                Flexible(
                  child: Text(
                    count == 1
                        ? 'Description and 1 comment'
                        : 'Description and $count comments',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (_expanded) ...[
          const SizedBox(height: 8),
          _Post(
            author: item.author,
            createdAt: item.createdAt,
            body: item.body,
            url: item.url,
            emptyText: 'No description provided.',
          ),
          for (final ItemComment c in item.comments)
            _Post(
              author: c.author,
              createdAt: c.createdAt,
              body: c.body,
              url: c.url,
            ),
        ],
      ],
    );
  }
}

/// A description or a comment: who wrote it and when, linked to it on
/// GitHub, and its Markdown.
class _Post extends StatelessWidget {
  const _Post({
    required this.author,
    required this.createdAt,
    required this.body,
    required this.url,
    this.emptyText = '',
  });

  final String? author;
  final DateTime createdAt;
  final String body;
  final String url;

  /// What to show when [body] is empty.
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final bool empty = body.trim().isEmpty;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border.all(color: theme.colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: 6,
            children: [
              LinkText(
                '${author == null ? 'A deleted account' : '@$author'}, '
                '${age(createdAt)} ago',
                url: url,
              ),
              if (empty)
                Text(
                  emptyText,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontStyle: FontStyle.italic,
                  ),
                )
              else
                _Markdown(body),
            ],
          ),
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

/// [text], rendered as Markdown, under [title].
///
/// A [collapsible] text longer than a few lines shows only its start, with
/// a **Show more** button, so that the item stays quick to scan.
class _Text extends StatefulWidget {
  const _Text(this.title, this.text, {this.collapsible = false});

  final String title;
  final String text;
  final bool collapsible;

  @override
  State<_Text> createState() => _TextState();
}

class _TextState extends State<_Text> {
  /// How much of a long text shows while it is collapsed.
  static const double _collapsedHeight = 110;

  var _expanded = false;

  bool get _long =>
      widget.text.length > 400 || '\n'.allMatches(widget.text).length > 5;

  @override
  Widget build(BuildContext context) {
    final bool collapsed = widget.collapsible && _long && !_expanded;
    final Widget markdown = _Markdown(widget.text);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 4,
      children: [
        Text(widget.title, style: Theme.of(context).textTheme.titleSmall),
        if (collapsed)
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: _collapsedHeight),
            child: ClipRect(
              child: SingleChildScrollView(
                physics: const NeverScrollableScrollPhysics(),
                child: markdown,
              ),
            ),
          )
        else
          markdown,
        if (widget.collapsible && _long)
          TextButton(
            style: TextButton.styleFrom(
              padding: EdgeInsets.zero,
              visualDensity: VisualDensity.compact,
            ),
            onPressed: () => setState(() => _expanded = !_expanded),
            child: Text(_expanded ? 'Show less' : 'Show more'),
          ),
      ],
    );
  }
}

/// [text] as Markdown, as GitHub shows a comment.
class _Markdown extends StatelessWidget {
  const _Markdown(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => MarkdownBody(
    data: text,
    // As GitHub shows a comment: a line break starts a new line.
    softLineBreak: true,
    onTapLink: (String text, String? href, String title) {
      if (href != null) openUrl(href);
    },
  );
}

/// Says whether the analysis is current or outdated, as GitHub marks an
/// outdated review comment: a small colored label.
class _StatusLabel extends StatelessWidget {
  const _StatusLabel.current()
    : _text = 'Current',
      _tooltip = 'Nothing happened on the item after the triage bot commented.',
      _outdated = false;

  const _StatusLabel.outdated()
    : _text = 'Outdated',
      _tooltip =
          'Something happened on the item after the triage bot '
          'commented.',
      _outdated = true;

  final String _text;
  final String _tooltip;
  final bool _outdated;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final color = _outdated
        ? (dark ? const Color(0xFFD29922) : const Color(0xFF9A6700))
        : (dark ? const Color(0xFF3FB950) : const Color(0xFF1A7F37));
    return Tooltip(
      message: _tooltip,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: color.withValues(alpha: dark ? 0.15 : 0.1),
          border: Border.all(color: color.withValues(alpha: 0.4)),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
          child: Text(
            _text,
            style: Theme.of(
              context,
            ).textTheme.labelSmall?.copyWith(color: color),
          ),
        ),
      ),
    );
  }
}

/// Links to the items that the item is linked to, and to the ones the
/// analysis names.
class _RelatedItems extends StatelessWidget {
  const _RelatedItems({required this.item, required this.draft});

  final TriageItem item;
  final AnalysisDraft draft;

  @override
  Widget build(BuildContext context) {
    final int? duplicateOf = draft.toAnalysis().duplicateOf;
    final List<ItemRef> linked = [
      ...item.linkedItems,
      ...item.closedLinkedItems,
    ];
    // The item, its label, and whether it is a PR, if the label says. The
    // numbers that the analysis names are in the item's repository.
    final links = <(ItemRef, String, bool?)>[
      for (final ItemRef r in linked)
        item.isPullRequest
            ? (r, 'Fixes issue ${shortNameOf(r)}', false)
            : (r, 'Fixed by PR ${shortNameOf(r)}', true),
      if (duplicateOf != null)
        (item.refTo(duplicateOf), 'Duplicate of #$duplicateOf', false),
      // The PRs and issues that GitHub links already have a link above.
      for (final int n in draft.targetingPrs)
        if (!linked.contains(item.refTo(n)))
          (item.refTo(n), 'Targeted by PR #$n', true),
      for (final int n in draft.targetedIssues)
        if (!linked.contains(item.refTo(n)))
          (item.refTo(n), 'Targets issue #$n', false),
      for (final int n in draft.relatedItems) (item.refTo(n), '#$n', null),
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
            for (final (ItemRef ref, String text, bool? isPullRequest) in links)
              _RelatedItem(ref: ref, text: text, isPullRequest: isPullRequest),
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
