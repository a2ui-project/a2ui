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

import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared/shared.dart';

import '../model/analysis_draft.dart';
import '../model/applier.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import '../model/triage_service.dart';
import 'chip_list_field.dart';
import 'item_info.dart';
import 'item_log.dart';
import 'label_colors.dart';
import 'links.dart';
import 'triage_scope.dart';

/// The triage analysis of [item], which the triager edits and applies:
/// the reply, how to close the item, its priority, labels, assignees and
/// milestone. Shows the steps of the last apply if it failed, and
/// **Revert** at the bottom. Nothing can be edited while the item applies.
///
/// The edits are kept in the controller's draft for [item], which starts as
/// [initial]. The details show the summary, reason and suggestion of the
/// draft next to the editor, in [ItemInfo].
class AnalysisEditor extends StatelessWidget {
  const AnalysisEditor({
    super.key,
    required this.item,
    this.initial = const TriageAnalysis(),
  });

  final TriageItem item;
  final TriageAnalysis initial;

  /// The value of the close choice that keeps the item open.
  static const String _keepOpen = 'open';

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final AnalysisDraft draft = controller.draftFor(item, initial);
    return ListenableBuilder(
      listenable: draft,
      builder: (context, _) {
        final bool applying = controller.isApplying(item.ref);
        final bool enabled = !applying;
        final ApplyResult? result = controller.lastResult(item.ref);
        final RepositoryInfo info = controller.repositoryInfo(item.repository);
        LabelColors? colorsOf(String name) =>
            labelColors(info.labelColors[name]);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 16,
          children: [
            _ReplyField(
              key: ValueKey(item.ref),
              draft: draft,
              enabled: enabled,
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
                  onSelectionChanged: enabled
                      ? (Set<String> selected) {
                          final String value = selected.single;
                          draft.closeAs = value == _keepOpen ? null : value;
                        }
                      : null,
                ),
                if (draft.closeAs == TriageCloseReason.duplicate &&
                    !item.isPullRequest)
                  SizedBox(
                    width: 180,
                    child: TextField(
                      controller: draft.duplicateOf,
                      enabled: enabled,
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
            _PriorityField(item: item, draft: draft, enabled: enabled),
            ChipListField(
              label: 'Labels',
              chooseTooltip: 'Choose labels',
              enabled: enabled,
              colorsOf: colorsOf,
              // The priority has a field of its own, and apply always
              // removes `status: needs-triage`.
              current: _shownLabels(item.labels),
              added: _withoutPriorities(draft.addedLabels),
              removed: _shownLabels(draft.removedLabels),
              fixedRemovals: [
                if (item.labels.contains(needsTriageLabel)) needsTriageLabel,
              ],
              // `status: needs-team-input` comes first, since the triager
              // adds it to every item they cannot triage.
              options: _withoutPriorities([
                if (info.labels.contains(needsTeamInputLabel))
                  needsTeamInputLabel,
                ...info.labels.where((l) => l != needsTeamInputLabel),
              ]),
              onChanged: (ChipListChange change) => draft
                ..addedLabels = [
                  ...change.added,
                  ..._onlyPriorities(draft.addedLabels),
                ]
                ..removedLabels = [
                  ..._hiddenLabels(draft.removedLabels),
                  ...change.removed,
                ],
            ),
            ChipListField(
              label: 'Assignees',
              chooseTooltip: 'Choose assignees',
              enabled: enabled,
              current: item.assignees,
              added: draft.newAssignees,
              removed: draft.removedAssignees,
              options: info.assignableUsers,
              onChanged: (ChipListChange change) => draft
                ..newAssignees = change.added
                ..removedAssignees = change.removed,
            ),
            ChipListField(
              label: 'Milestone',
              chooseTooltip: 'Choose the milestone',
              single: true,
              enabled: enabled,
              current: [?item.milestone],
              added: [?draft.newMilestone],
              removed: [?draft.removedMilestone],
              options: info.milestones.keys.toList(),
              onChanged: (ChipListChange change) {
                final String? set = change.added.firstOrNull;
                draft
                  ..newMilestone = set
                  // Setting a milestone replaces the item's.
                  ..removedMilestone = set == null
                      ? change.removed.firstOrNull
                      : null;
              },
            ),
            if (result != null && !result.succeeded && !applying)
              _FailedApply(result),
            Tooltip(
              message: 'Undo your changes to this analysis',
              child: TextButton(
                onPressed: draft.isEdited && !applying
                    ? () => controller.revert([item])
                    : null,
                child: const Text('Revert'),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// The reply, with a toggle between writing it and previewing it as GitHub
/// shows a comment, and a line that says what apply posts it under.
class _ReplyField extends StatefulWidget {
  const _ReplyField({super.key, required this.draft, required this.enabled});

  final AnalysisDraft draft;
  final bool enabled;

  @override
  State<_ReplyField> createState() => _ReplyFieldState();
}

class _ReplyFieldState extends State<_ReplyField> {
  bool _preview = false;

  @override
  Widget build(BuildContext context) {
    final AnalysisDraft draft = widget.draft;
    final ThemeData theme = Theme.of(context);
    final String heading = draft.addedLabels.contains(needsTeamInputLabel)
        ? teamNoteTitle
        : 'From triage:';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 8,
      children: [
        SegmentedButton<bool>(
          showSelectedIcon: false,
          style: const ButtonStyle(visualDensity: VisualDensity.compact),
          segments: const [
            ButtonSegment(value: false, label: Text('Write')),
            ButtonSegment(value: true, label: Text('Preview')),
          ],
          selected: {_preview},
          onSelectionChanged: (Set<bool> selected) =>
              setState(() => _preview = selected.single),
        ),
        if (_preview)
          InputDecorator(
            decoration: const InputDecoration(
              labelText: 'Reply',
              border: OutlineInputBorder(),
            ),
            child: draft.reply.text.trim().isEmpty
                ? Text(
                    'Nothing to preview',
                    style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                  )
                : MarkdownBody(
                    data: draft.reply.text,
                    // As GitHub shows a comment: a line break starts a new
                    // line.
                    softLineBreak: true,
                    onTapLink: (String text, String? href, String title) {
                      if (href != null) openUrl(href);
                    },
                  ),
          )
        else
          TextField(
            controller: draft.reply,
            enabled: widget.enabled,
            minLines: 2,
            maxLines: 10,
            decoration: const InputDecoration(
              labelText: 'Reply',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
          ),
        Text(
          'Apply posts the reply under "$heading"',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
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

/// Whether the **Labels** field leaves out [label] as one the triager
/// changes: the priority has a field of its own, and apply always removes
/// `status: needs-triage`.
bool _isHidden(String label) =>
    _priorities.contains(label) || label == needsTriageLabel;

List<String> _shownLabels(List<String> labels) => [
  for (final l in labels)
    if (!_isHidden(l)) l,
];

List<String> _hiddenLabels(List<String> labels) => [
  for (final l in labels)
    if (_isHidden(l)) l,
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
  const _PriorityField({
    required this.item,
    required this.draft,
    required this.enabled,
  });

  final TriageItem item;
  final AnalysisDraft draft;
  final bool enabled;

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
          onSelectionChanged: enabled
              ? (Set<String> selected) => _select(selected.firstOrNull)
              : null,
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
