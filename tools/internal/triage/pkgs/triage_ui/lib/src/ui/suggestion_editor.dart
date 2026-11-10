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
import 'package:flutter/services.dart';
import 'package:triage/triage.dart';

import '../model/applier.dart';
import '../model/suggestion_draft.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'chip_list_field.dart';
import 'label_colors.dart';
import 'links.dart';
import 'remove_list_field.dart';
import 'triage_scope.dart';

/// The triage suggestion for [item], which the triager edits and applies.
///
/// The edits are kept in the controller's draft for [item], which starts as
/// [initial].
class SuggestionEditor extends StatelessWidget {
  const SuggestionEditor({
    super.key,
    required this.item,
    this.initial = const TriageSuggestion(),
  });

  final TriageItem item;
  final TriageSuggestion initial;

  /// The value of the close choice that keeps the item open.
  static const String _keepOpen = 'open';

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final SuggestionDraft draft = controller.draftFor(item, initial);
    return ListenableBuilder(
      listenable: draft,
      builder: (context, _) {
        final String? summary = draft.summary;
        final String? suggestion = draft.suggestion;
        final String? problem = draft.problem;
        final bool applying = controller.isApplying(item.number);
        final ApplyResult? result = controller.lastResult(item.number);
        LabelColors? colorsOf(String name) =>
            labelColors(controller.repositoryInfo.labelColors[name]);
        final List<String> milestones = [
          for (final String m in controller.repositoryInfo.milestones.keys)
            if (m != item.milestone) m,
        ];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 16,
          children: [
            if (summary != null) _Text('Summary', summary),
            if (suggestion != null) _Text('Suggestion', suggestion),
            _RelatedItems(item: item, draft: draft),
            TextField(
              controller: draft.reply,
              minLines: 2,
              maxLines: 10,
              decoration: const InputDecoration(
                labelText: 'Reply',
                helperText:
                    'Posted from your account. Leave it empty to post '
                    'nothing.',
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
            ),
            Wrap(
              spacing: 16,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                SegmentedButton<String>(
                  showSelectedIcon: false,
                  segments: [
                    const ButtonSegment(
                      value: _keepOpen,
                      label: Text('Keep open'),
                      tooltip: 'Apply does not close the item',
                    ),
                    if (item.isPullRequest)
                      const ButtonSegment(
                        value: TriageCloseReason.completed,
                        label: Text('Close'),
                        tooltip: 'Apply closes the PR without merging it',
                      )
                    else ...const [
                      ButtonSegment(
                        value: TriageCloseReason.completed,
                        label: Text('Close as completed'),
                        tooltip: 'Apply closes the issue as done',
                      ),
                      ButtonSegment(
                        value: TriageCloseReason.notPlanned,
                        label: Text('Close as not planned'),
                        tooltip:
                            'Apply closes the issue, because the team does not '
                            'plan to work on it',
                      ),
                      ButtonSegment(
                        value: TriageCloseReason.duplicate,
                        label: Text('Close as duplicate'),
                        tooltip:
                            'Apply closes the issue as a duplicate of the '
                            'issue you enter',
                      ),
                    ],
                  ],
                  selected: {
                    if (item.isPullRequest && draft.closeAs != null)
                      TriageCloseReason.completed
                    else
                      draft.closeAs ?? _keepOpen,
                  },
                  onSelectionChanged: (Set<String> selected) {
                    final String value = selected.single;
                    draft.closeAs = value == _keepOpen ? null : value;
                  },
                ),
                if (draft.closeAs == TriageCloseReason.duplicate &&
                    !item.isPullRequest)
                  SizedBox(
                    width: 180,
                    child: TextField(
                      controller: draft.duplicateOf,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      decoration: const InputDecoration(
                        labelText: 'Duplicate of',
                        prefixText: '#',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
              ],
            ),
            _PriorityField(item: item, draft: draft),
            ChipListField(
              label: 'Add labels',
              colorsOf: colorsOf,
              chooseTooltip: 'Choose labels to add',
              // The priority has a field of its own.
              values: _withoutPriorities(draft.addedLabels),
              options: _withoutPriorities([
                for (final String label in controller.repositoryInfo.labels)
                  if (!item.labels.contains(label)) label,
              ]),
              onChanged: (List<String> v) => draft.addedLabels = [
                ...v,
                ..._onlyPriorities(draft.addedLabels),
              ],
            ),
            RemoveListField(
              label: 'Remove labels',
              colorsOf: colorsOf,
              names: _withoutPriorities(item.labels),
              removed: draft.removedLabels,
              onChanged: (List<String> v) => draft.removedLabels = [
                ...v,
                ..._onlyPriorities(draft.removedLabels),
              ],
            ),
            ChipListField(
              label: 'Assign',
              chooseTooltip: 'Choose people to assign',
              values: draft.newAssignees,
              options: controller.repositoryInfo.assignableUsers,
              onChanged: (List<String> v) => draft.newAssignees = v,
            ),
            RemoveListField(
              label: 'Unassign',
              names: item.assignees,
              removed: draft.removedAssignees,
              onChanged: (List<String> v) => draft.removedAssignees = v,
            ),
            if (milestones.isNotEmpty || draft.newMilestone != null)
              ChipListField(
                label: 'Set milestone',
                chooseTooltip: 'Choose the milestone',
                single: true,
                values: [?draft.newMilestone],
                options: milestones,
                onChanged: (List<String> v) =>
                    draft.newMilestone = v.firstOrNull,
              ),
            RemoveListField(
              label: 'Remove milestone',
              names: [?item.milestone],
              removed: [?draft.removedMilestone],
              onChanged: (List<String> v) =>
                  draft.removedMilestone = v.firstOrNull,
            ),
            Wrap(
              spacing: 16,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Tooltip(
                  message:
                      'Post the reply, change the labels, assignees and '
                      'milestone, and close the item on GitHub, as set above',
                  child: FilledButton(
                    onPressed: problem == null && !applying
                        ? () => controller.apply(item)
                        : null,
                    child: const Text('Apply'),
                  ),
                ),
                if (!item.needsTeamInput)
                  Tooltip(
                    message:
                        'Add "$needsTeamInputLabel", so that the team '
                        'discusses the item. The suggestion is not applied.',
                    child: OutlinedButton(
                      onPressed: applying
                          ? null
                          : () => _sendToTeam(context, controller, item),
                      child: const Text('Needs team input'),
                    ),
                  ),
                if (applying)
                  const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else if (problem != null)
                  Text(problem),
              ],
            ),
            if (result != null && !applying) _ApplyResultView(result),
          ],
        );
      },
    );
  }
}

/// The priority labels, which the triager sets most often.
const List<String> _priorities = ['P0', 'P1', 'P2', 'P3'];

List<String> _withoutPriorities(List<String> labels) => [
  for (final l in labels)
    if (!_priorities.contains(l)) l,
];

List<String> _onlyPriorities(List<String> labels) => [
  for (final l in labels)
    if (_priorities.contains(l)) l,
];

/// What each priority means, from `docs/contributing/triage/triage.md`.
const Map<String, String> _priorityMeanings = {
  'P0': 'Urgent. Assign someone.',
  'P1':
      'A priority: the team is working on it, or will be soon. Assign '
      'someone.',
  'P2': 'The team intends to work on it.',
  'P3': 'A good request, not planned now.',
};

/// The item's priority as a segmented button, with no priority or one of
/// the priority labels selected.
///
/// Selecting a priority adds its label, unless the item has it, and
/// removes the item's other priority labels. Unselecting it removes all of
/// them.
class _PriorityField extends StatelessWidget {
  const _PriorityField({required this.item, required this.draft});

  final TriageItem item;
  final SuggestionDraft draft;

  /// The priority that the item has once the draft is applied.
  String? get _priority {
    for (final String p in _priorities) {
      if (draft.addedLabels.contains(p)) return p;
    }
    for (final String p in _priorities) {
      if (item.labels.contains(p) && !draft.removedLabels.contains(p)) {
        return p;
      }
    }
    return null;
  }

  void _select(String? priority) {
    draft
      ..addedLabels = [
        ..._withoutPriorities(draft.addedLabels),
        if (priority != null && !item.labels.contains(priority)) priority,
      ]
      ..removedLabels = [
        ..._withoutPriorities(draft.removedLabels),
        for (final p in _priorities)
          if (item.labels.contains(p) && p != priority) p,
      ];
  }

  @override
  Widget build(BuildContext context) {
    final String? priority = _priority;
    return Row(
      spacing: 12,
      children: [
        Text('Priority', style: Theme.of(context).textTheme.titleSmall),
        SegmentedButton<String>(
          showSelectedIcon: false,
          emptySelectionAllowed: true,
          segments: [
            for (final p in _priorities)
              ButtonSegment(
                value: p,
                label: Text(p),
                tooltip:
                    '${_priorityMeanings[p]} Click again to set no '
                    'priority.',
              ),
          ],
          selected: {?priority},
          onSelectionChanged: (Set<String> selected) =>
              _select(selected.firstOrNull),
        ),
      ],
    );
  }
}

/// Asks for an optional comment for the team, then sends [item] to the
/// team.
Future<void> _sendToTeam(
  BuildContext context,
  TriageController controller,
  TriageItem item,
) async {
  final String? comment = await showDialog<String>(
    context: context,
    builder: (context) => _TeamInputDialog(item),
  );
  if (comment == null) return;
  await controller.sendToTeam(item, comment: comment.isEmpty ? null : comment);
}

/// Asks for a comment for the team. Pops with the comment, which is empty
/// when the triager wrote none, or with null when they cancel.
class _TeamInputDialog extends StatefulWidget {
  const _TeamInputDialog(this.item);

  final TriageItem item;

  @override
  State<_TeamInputDialog> createState() => _TeamInputDialogState();
}

class _TeamInputDialogState extends State<_TeamInputDialog> {
  final _comment = TextEditingController();

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SelectionArea(
    child: AlertDialog(
      title: Text('Send ${widget.item.name} to the team?'),
      content: SizedBox(
        width: 560,
        child: TextField(
          controller: _comment,
          autofocus: true,
          minLines: 3,
          maxLines: 10,
          decoration: const InputDecoration(
            labelText: 'Comment for the team',
            helperText:
                'Optional. Posted from your account. The suggestion is not '
                'applied.',
            border: OutlineInputBorder(),
            alignLabelWithHint: true,
          ),
        ),
      ),
      actions: [
        Tooltip(
          message: 'Change nothing on GitHub',
          child: TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
        ),
        Tooltip(
          message: 'Add the label, and post the comment if there is one',
          child: FilledButton(
            onPressed: () => Navigator.pop(context, _comment.text.trim()),
            child: const Text('Add "$needsTeamInputLabel"'),
          ),
        ),
      ],
    ),
  );
}

class _Text extends StatelessWidget {
  const _Text(this.title, this.text);

  final String title;
  final String text;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    spacing: 4,
    children: [
      Text(title, style: Theme.of(context).textTheme.titleSmall),
      Text(text),
    ],
  );
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
    final links = <(String, String)>[
      for (final int n in item.linkedItems)
        item.isPullRequest
            ? ('Fixes issue #$n', issueUrl(n))
            : ('Fixed by PR #$n', pullRequestUrl(n)),
      if (duplicateOf != null)
        ('Duplicate of #$duplicateOf', issueUrl(duplicateOf)),
      for (final int n in draft.relatedIssues) ('Issue #$n', issueUrl(n)),
      for (final int n in draft.relatedPrs) ('PR #$n', pullRequestUrl(n)),
    ];
    if (links.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 4,
      children: [
        Text('Related items', style: Theme.of(context).textTheme.titleSmall),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final (String text, String url) in links)
              ActionChip(
                label: Text(text),
                tooltip: url,
                onPressed: () => openUrl(url),
              ),
          ],
        ),
      ],
    );
  }
}

class _ApplyResultView extends StatelessWidget {
  const _ApplyResultView(this.result);

  final ApplyResult result;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 4,
      children: [
        Text(
          result.succeeded
              ? 'Applied.'
              : 'Some changes failed. Fix the problem and click Apply again. '
                    'A reply that was posted is not posted again.',
          style: Theme.of(context).textTheme.titleSmall,
        ),
        for (final StepResult step in result.steps)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: 8,
            children: [
              switch (step.status) {
                StepStatus.done => Icon(
                  Icons.check,
                  size: 18,
                  color: colors.primary,
                  semanticLabel: 'Done',
                ),
                StepStatus.skipped => const Icon(
                  Icons.redo,
                  size: 18,
                  semanticLabel: 'Skipped',
                ),
                StepStatus.failed => Icon(
                  Icons.error_outline,
                  size: 18,
                  color: colors.error,
                  semanticLabel: 'Failed',
                ),
                StepStatus.notRun => const Icon(
                  Icons.remove,
                  size: 18,
                  semanticLabel: 'Not run',
                ),
              },
              Expanded(
                child: Text(
                  [
                    step.description,
                    if (step.status == StepStatus.notRun) '(not run)',
                    if (step.error case final String error) '\n$error',
                  ].join(' '),
                  style: step.status == StepStatus.failed
                      ? TextStyle(color: colors.error)
                      : null,
                ),
              ),
            ],
          ),
      ],
    );
  }
}
