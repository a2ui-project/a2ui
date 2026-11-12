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

/// **Apply**, which acts on all of [items] together, with what keeps it
/// disabled. Each item's **Revert** is in its **Edit** tab.
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
        final bool busy = items.any((i) => controller.isApplying(i.ref));
        // Apply skips the items whose drafts change nothing.
        final int changed = drafts.where((d) => d.hasChanges).length;
        final List<String> problems = [
          for (var k = 0; k < items.length; k++)
            if (drafts[k].problem case final String problem)
              items.length == 1 ? problem : '${items[k].name}: $problem',
          if (changed == 0) 'Nothing to apply.',
        ];
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
                  child: Text(
                    changed > 1 ? 'Apply to $changed items' : 'Apply',
                  ),
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
