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

import '../model/triage_controller.dart';

/// Shows the session report, which the triager copies to the team chat.
///
/// When [closing], the triage UI is closing, and the dialog offers to copy
/// the report before it closes. It then returns true if the triage UI
/// should close.
Future<bool> showSessionReport(
  BuildContext context,
  TriageController controller, {
  bool closing = false,
}) async {
  final String report = controller.report();

  Future<void> copy() async {
    await Clipboard.setData(ClipboardData(text: report));
    controller.session.recordCopied();
  }

  // True when the triager clicks a button, and null when they dismiss the
  // dialog, which keeps the triage UI open.
  final bool? close = await showDialog<bool>(
    context: context,
    builder: (context) => SelectionArea(
      child: AlertDialog(
        title: Text(
          closing
              ? 'Copy the session report before closing?'
              : 'Session report',
        ),
        content: SizedBox(
          width: 640,
          child: SingleChildScrollView(
            child: Text(
              report,
              style: const TextStyle(fontFamily: 'Menlo', fontSize: 13),
            ),
          ),
        ),
        actions: [
          Tooltip(
            message: closing
                ? 'Close the triage UI without copying the report'
                : 'Close the report',
            child: TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Close'),
            ),
          ),
          Tooltip(
            message: closing
                ? 'Copy the report to the clipboard, then close the triage UI'
                : 'Copy the report to the clipboard',
            child: FilledButton(
              onPressed: () async {
                await copy();
                if (context.mounted) Navigator.pop(context, true);
              },
              child: Text(closing ? 'Copy and close' : 'Copy'),
            ),
          ),
        ],
      ),
    ),
  );
  return close ?? false;
}
