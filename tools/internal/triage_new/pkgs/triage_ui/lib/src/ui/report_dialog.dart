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

import '../model/report_prompt.dart';
import '../model/triage_session.dart';
import 'triage_scope.dart';

/// Shows the [ReportDialog] for the session of the triage UI.
Future<void> showReportDialog(BuildContext context) {
  final TriageSession session = TriageScope.of(context).session;
  return showDialog<void>(
    context: context,
    builder: (_) => ReportDialog(session: session, now: DateTime.now()),
  );
}

/// The prompt that asks an agent for the triage report of the session, for
/// the triager to copy. See "Create a report" in `ui.blueprint.md`.
class ReportDialog extends StatelessWidget {
  const ReportDialog({super.key, required this.session, required this.now});

  /// The session whose period the report covers.
  final TriageSession session;

  /// The time the dialog opened, which ends the period of the report.
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final (:String since, :String until) = reportPeriod(session, now);
    final String prompt = reportPrompt(session, now);
    final ThemeData theme = Theme.of(context);
    return AlertDialog(
      title: const Text('Create report'),
      content: SizedBox(
        width: 560,
        // The dialog is outside the page's selection area.
        child: SelectionArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: 16,
            children: [
              Text(
                'To report what you triaged in this session, from $since to '
                '$until, paste this prompt to an agent in your a2ui checkout:',
              ),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  prompt.trimRight(),
                  style: const TextStyle(fontFamily: 'monospace'),
                ),
              ),
              const Text(
                'After the report, the agent asks whether to unsubscribe you '
                'from the items in it, so that GitHub stops notifying you '
                'about them.',
              ),
            ],
          ),
        ),
      ),
      actions: [
        Tooltip(
          message: 'Close without copying',
          child: TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ),
        Tooltip(
          message: 'Copy the prompt and close',
          child: FilledButton.icon(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: prompt));
              if (!context.mounted) return;
              final ScaffoldMessengerState? messenger =
                  ScaffoldMessenger.maybeOf(context);
              Navigator.pop(context);
              messenger
                ?..hideCurrentSnackBar()
                ..showSnackBar(
                  const SnackBar(
                    content: Text('Copied the prompt for the triage report'),
                    duration: Duration(seconds: 2),
                  ),
                );
            },
            icon: const Icon(Icons.content_copy),
            label: const Text('Copy and close'),
          ),
        ),
      ],
    );
  }
}
