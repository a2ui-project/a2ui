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

import '../github/triage_service.dart';
import '../model/applier.dart';
import '../model/suggestion_draft.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'chip_list_field.dart';
import 'item_info.dart';
import 'item_log.dart';
import 'label_colors.dart';
import 'remove_list_field.dart';
import 'triage_scope.dart';

/// The triage suggestion for [item], which the triager edits and applies:
/// the reply, how to close the item, its priority, labels, assignees and
/// milestone, and **Revert**. Shows the steps of the last apply if it
/// failed.
///
/// The edits are kept in the controller's draft for [item], which starts as
/// [initial]. The details show the summary, reason and suggestion of the
/// draft next to the editor, in [ItemInfo].
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
        final bool applying = controller.isApplying(item.ref);
        final ApplyResult? result = controller.lastResult(item.ref);
        final RepositoryInfo info = controller.repositoryInfo(item.repository);
        LabelColors? colorsOf(String name) =>
            labelColors(info.labelColors[name]);
        final List<String> milestones = [
          for (final String m in info.milestones.keys)
            if (m != item.milestone) m,
        ];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 16,
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: Tooltip(
                message: 'Undo your changes to this suggestion',
                child: TextButton(
                  onPressed: draft.isEdited && !applying
                      ? () => controller.revert([item])
                      : null,
                  child: const Text('Revert'),
                ),
              ),
            ),
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
              // `status: needs-team-input` comes first, since the triager
              // adds it to every item they cannot triage.
              options: _withoutPriorities([
                for (final String label in [
                  if (info.labels.contains(needsTeamInputLabel))
                    needsTeamInputLabel,
                  ...info.labels.where((l) => l != needsTeamInputLabel),
                ])
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
              options: info.assignableUsers,
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
            if (result != null && !result.succeeded && !applying)
              _FailedApply(result),
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

/// The steps of an apply that failed, so that the triager can fix the
/// problem and apply again. The item's log has every apply.
class _FailedApply extends StatelessWidget {
  const _FailedApply(this.result);

  final ApplyResult result;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    spacing: 4,
    children: [
      Text(
        'Some changes failed. Fix the problem and click Apply again. '
        'A reply that was posted is not posted again.',
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
          color: Theme.of(context).colorScheme.error,
        ),
      ),
      StepList(result.steps),
    ],
  );
}
