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

import '../model/suggestion_draft.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'triage_scope.dart';

/// The buttons that act on all of [items] together: **Apply**, **Needs
/// team input** and **Revert**.
class GroupActions extends StatelessWidget {
  const GroupActions({super.key, required this.items});

  /// The item that the triager selected, and the items linked to it.
  final List<TriageItem> items;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final List<SuggestionDraft> drafts = [
      for (final i in items) controller.draftFor(i),
    ];
    return ListenableBuilder(
      listenable: Listenable.merge(drafts),
      builder: (context, _) {
        final bool busy = items.any((i) => controller.isApplying(i.number));
        final bool anyChanges = drafts.any((d) => d.hasChanges);
        final List<String> problems = [
          for (var k = 0; k < items.length; k++)
            if (drafts[k].hasChanges && drafts[k].problem != null)
              items.length == 1
                  ? drafts[k].problem!
                  : '${items[k].name}: ${drafts[k].problem}',
          if (!anyChanges) 'Nothing to apply.',
        ];
        final List<TriageItem> toTeam = [
          for (final i in items)
            if (!i.needsTeamInput) i,
        ];
        final bool edited = drafts.any((d) => d.isEdited);
        final all = items.length == 1 ? 'the item' : 'the items';
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
                    'milestones, and close $all on GitHub, as set in the tabs',
                child: FilledButton(
                  onPressed: problems.isEmpty && !busy
                      ? () => controller.applyAll(items)
                      : null,
                  child: const Text('Apply'),
                ),
              ),
              if (toTeam.isNotEmpty)
                Tooltip(
                  message:
                      'Add "$needsTeamInputLabel" to $all, so that the team '
                      'discusses them. The suggestions are not applied.',
                  child: OutlinedButton(
                    onPressed: busy
                        ? null
                        : () => _sendToTeam(context, controller, toTeam),
                    child: const Text('Needs team input'),
                  ),
                ),
              Tooltip(
                message: 'Undo your changes in all tabs',
                child: TextButton(
                  onPressed: edited && !busy
                      ? () => controller.revert(items)
                      : null,
                  child: const Text('Revert'),
                ),
              ),
              if (busy)
                const SizedBox.square(
                  dimension: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                for (final String problem in problems) Text(problem),
            ],
          ),
        );
      },
    );
  }
}

/// Asks for an optional comment for the team, then sends [items] to the
/// team.
Future<void> _sendToTeam(
  BuildContext context,
  TriageController controller,
  List<TriageItem> items,
) async {
  final String? comment = await showDialog<String>(
    context: context,
    builder: (context) => _TeamInputDialog(items),
  );
  if (comment == null) return;
  await controller.sendAllToTeam(
    items,
    comment: comment.isEmpty ? null : comment,
  );
}

/// Asks for a comment for the team. Pops with the comment, which is empty
/// when the triager wrote none, or with null when they cancel.
class _TeamInputDialog extends StatefulWidget {
  const _TeamInputDialog(this.items);

  final List<TriageItem> items;

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
  Widget build(BuildContext context) {
    final List<String> names = [for (final i in widget.items) i.name];
    final String list = names.length < 3
        ? names.join(' and ')
        : '${names.sublist(0, names.length - 1).join(', ')} and '
              '${names.last}';
    return SelectionArea(
      child: AlertDialog(
        title: Text('Send $list to the team?'),
        content: SizedBox(
          width: 560,
          child: TextField(
            controller: _comment,
            autofocus: true,
            minLines: 3,
            maxLines: 10,
            decoration: InputDecoration(
              labelText: 'Comment for the team',
              helperText:
                  'Optional. Posted from your account on '
                  '${names.length == 1 ? 'the item' : 'each item'}. The '
                  'suggestions are not applied.',
              border: const OutlineInputBorder(),
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
}
