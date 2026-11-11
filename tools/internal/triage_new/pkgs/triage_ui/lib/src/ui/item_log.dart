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

import '../model/applier.dart';
import '../model/log_entry.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'links.dart';
import 'triage_scope.dart';

/// What the tool did to [item] in this session, newest first: each apply
/// and send to the team with its steps, errors and posted texts, and each
/// refresh that reset the suggestion.
class ItemLog extends StatelessWidget {
  const ItemLog({super.key, required this.item});

  final TriageItem item;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final List<LogEntry> entries = controller.logOf(item.ref);
    if (entries.isEmpty) {
      return const Text('Nothing was done to this item in this session.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 24,
      children: [for (final LogEntry entry in entries.reversed) _Entry(entry)],
    );
  }
}

class _Entry extends StatelessWidget {
  const _Entry(this.entry);

  final LogEntry entry;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 8,
      children: [
        Row(
          spacing: 8,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _time(entry.time),
              style: theme.textTheme.titleSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            Expanded(
              child: Text(
                entry.title,
                style: theme.textTheme.titleSmall?.copyWith(
                  color: entry.failed ? theme.colorScheme.error : null,
                ),
              ),
            ),
          ],
        ),
        if (entry.steps.isNotEmpty) StepList(entry.steps),
      ],
    );
  }

  /// [time] as "14:03:07".
  static String _time(DateTime time) => [
    time.hour,
    time.minute,
    time.second,
  ].map((int n) => n.toString().padLeft(2, '0')).join(':');
}

/// The steps of an apply or a send to the team: an icon for how each went,
/// its description, why it failed, and the text it posted.
class StepList extends StatelessWidget {
  const StepList(this.steps, {super.key});

  final List<StepResult> steps;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 6,
      children: [
        for (final StepResult step in steps)
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
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 4,
                  children: [
                    Text(
                      [
                        step.description,
                        if (step.status == StepStatus.notRun) '(not run)',
                      ].join(' '),
                    ),
                    if (step.error case final String error)
                      Text(error, style: TextStyle(color: colors.error)),
                    if (step.text case final String text) _Quote(text),
                  ],
                ),
              ),
            ],
          ),
      ],
    );
  }
}

/// A text that a step posted, set off from the steps.
class _Quote extends StatelessWidget {
  const _Quote(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: colors.outlineVariant, width: 3),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.only(left: 12, top: 2, bottom: 2),
        child: LinkifiedText(text),
      ),
    );
  }
}
