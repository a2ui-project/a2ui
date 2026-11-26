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

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../model/analysis_draft.dart';
import '../model/draft_changes.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'triage_scope.dart';

/// Whether **Apply** can apply a group of items now, and what it would
/// change.
typedef ApplyStatus = ({
  /// Whether some of the items are being applied.
  bool busy,

  /// What keeps **Apply** disabled, or nothing.
  List<String> problems,

  /// The items whose drafts change something, with their changes. **Apply**
  /// skips the others.
  List<(TriageItem, List<DraftChange>)> changes,
});

/// The [ApplyStatus] of [items].
ApplyStatus applyStatus(TriageController controller, List<TriageItem> items) {
  final List<AnalysisDraft> drafts = [
    for (final i in items) controller.draftFor(i),
  ];
  final List<(TriageItem, List<DraftChange>)> changes = [
    for (var k = 0; k < items.length; k++)
      if (drafts[k].hasChanges) (items[k], draftChanges(items[k], drafts[k])),
  ];
  return (
    busy: items.any((i) => controller.isApplying(i.ref)),
    problems: [
      for (var k = 0; k < items.length; k++)
        if (drafts[k].problem case final String problem)
          items.length == 1 ? problem : '${items[k].name}: $problem',
      if (changes.isEmpty) 'Nothing to apply.',
    ],
    changes: changes,
  );
}

/// The items that **Apply** acts on: the selected items, or the selected
/// item and the items linked to it.
List<TriageItem> applyTargets(TriageController controller) {
  if (controller.multiSelection case final List<TriageItem> selection
      when selection.isNotEmpty) {
    return selection;
  }
  final TriageItem? selected = controller.selected;
  return selected == null ? const [] : controller.group(selected);
}

/// Applies [applyTargets], as **Apply** does, if **Apply** is enabled.
/// Returns whether it did.
bool applySelection(TriageController controller) {
  final List<TriageItem> items = applyTargets(controller);
  if (items.isEmpty) return false;
  final ApplyStatus status = applyStatus(controller, items);
  if (status.busy || status.problems.isNotEmpty) return false;
  unawaited(controller.applyAll(items));
  return true;
}

/// **Apply**, which acts on all of [items] together, with what keeps it
/// disabled, or what it will change on each item. Each item's **Revert** is
/// in its **Edit** tab.
class GroupActions extends StatelessWidget {
  const GroupActions({super.key, required this.items});

  /// The item that the triager selected, and the items linked to it.
  final List<TriageItem> items;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    return ListenableBuilder(
      listenable: Listenable.merge([
        for (final i in items) controller.draftFor(i),
      ]),
      builder: (context, _) {
        final ApplyStatus status = applyStatus(controller, items);
        final int changed = status.changes.length;
        final all = items.length == 1 ? 'the item' : 'the items';
        final shortcut = Theme.of(context).platform == TargetPlatform.macOS
            ? 'Cmd+Enter'
            : 'Ctrl+Enter';
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          child: Wrap(
            spacing: 16,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Tooltip(
                message:
                    'Post the replies, change the labels, assignees and '
                    'milestones, and close $all on GitHub, as set in the '
                    'tabs ($shortcut)',
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: _applyColor,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: status.problems.isEmpty && !status.busy
                      ? () => controller.applyAll(items)
                      : null,
                  child: Text(
                    changed > 1 ? 'Apply to $changed items' : 'Apply',
                  ),
                ),
              ),
              if (status.busy)
                const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else ...[
                for (final String problem in status.problems) Text(problem),
                for (final (TriageItem item, List<DraftChange> changes)
                    in status.changes)
                  Text(
                    '${item.shortName}: ${changes.map(_summary).join(', ')}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
              ],
            ],
          ),
        );
      },
    );
  }
}

/// The color of **Apply**, the one button that changes GitHub, so that it
/// stands out from the gray of the rest of the page.
final Color _applyColor = Colors.blue.shade700;

/// [change] in a few words, as in "+P2" or "close as completed".
String _summary(DraftChange change) => switch (change) {
  (kind: 'Reply', value: _) => 'reply',
  (kind: 'Add label', :final String value) => '+$value',
  (kind: 'Remove label', :final String value) => '−$value',
  (kind: 'Assign', :final String value) => '+@$value',
  (kind: 'Unassign', :final String value) => '−@$value',
  (kind: 'Request review', :final String value) => 'review @$value',
  (kind: 'Set milestone', :final String value) => 'milestone $value',
  (kind: 'Remove milestone', :final String value) => '−milestone $value',
  (kind: 'Close', value: '') => 'close',
  (kind: 'Close', :final String value) => 'close $value',
  (:final String kind, :final String value) => '$kind $value',
};
