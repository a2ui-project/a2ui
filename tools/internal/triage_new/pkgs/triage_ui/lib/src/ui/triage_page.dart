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

import '../model/triage_controller.dart';
import 'column_divider.dart';
import 'item_details.dart';
import 'item_list.dart';
import 'report_dialog.dart';
import 'triage_scope.dart';

/// The triage UI's only page: the header, the items on the left and the
/// details of the selected item on the right. See `ui.blueprint.md`.
class TriagePage extends StatefulWidget {
  const TriagePage({super.key});

  @override
  State<TriagePage> createState() => _TriagePageState();
}

class _TriagePageState extends State<TriagePage> {
  /// The width of the item list, which the triager changes by dragging the
  /// divider.
  double _listWidth = 400;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final String? error = controller.error;
    final int total = controller.queueLength;
    final int done = total - controller.remaining;
    // Every text on the page can be selected and copied.
    return SelectionArea(
      child: Scaffold(
        appBar: AppBar(
          leading: MenuAnchor(
            builder: (context, menu, _) => IconButton(
              icon: const Icon(Icons.menu),
              tooltip: 'Menu',
              onPressed: () => menu.isOpen ? menu.close() : menu.open(),
            ),
            menuChildren: [
              Tooltip(
                message:
                    'Load the items from GitHub again. Your edits are kept, '
                    'except for items that changed on GitHub.',
                child: MenuItemButton(
                  leadingIcon: const Icon(Icons.refresh),
                  onPressed: controller.isConnected && !controller.loading
                      ? controller.refresh
                      : null,
                  child: const Text('Refresh'),
                ),
              ),
              Tooltip(
                message:
                    'Get the prompt that asks an agent for the triage report '
                    'of this session',
                child: MenuItemButton(
                  leadingIcon: const Icon(Icons.summarize_outlined),
                  onPressed: () => showReportDialog(context),
                  child: const Text('Create report'),
                ),
              ),
            ],
          ),
          title: const Text('A2UI triage'),
          actions: [
            if (controller.isConnected)
              Padding(
                padding: const EdgeInsets.only(right: 24),
                child: Tooltip(
                  message:
                      '$done of the $total items in the queue are triaged or '
                      'sent to the team',
                  child: Text('$done/$total'),
                ),
              ),
          ],
          bottom: controller.loading
              ? const PreferredSize(
                  preferredSize: Size.fromHeight(4),
                  child: LinearProgressIndicator(),
                )
              : null,
        ),
        body: Column(
          children: [
            if (error != null && controller.isConnected)
              MaterialBanner(
                content: Text(error),
                actions: [
                  Tooltip(
                    message: 'Hide this message',
                    child: TextButton(
                      onPressed: controller.dismissError,
                      child: const Text('Dismiss'),
                    ),
                  ),
                ],
              ),
            Expanded(
              child: controller.isConnected
                  ? LayoutBuilder(
                      builder: (context, constraints) {
                        final double width = clampColumnWidth(
                          _listWidth,
                          constraints.maxWidth,
                        );
                        return Row(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            // The list and the details have selection areas
                            // of their own. In the page's one, a click on an
                            // item left a caret in the list, and then a drag
                            // in the details selected nothing.
                            SizedBox(
                              width: width,
                              child: const SelectionArea(child: ItemList()),
                            ),
                            ColumnDivider(
                              label: 'Resize the item list',
                              onDrag: (double delta) =>
                                  setState(() => _listWidth = width + delta),
                            ),
                            const Expanded(
                              child: SelectionArea(child: ItemDetails()),
                            ),
                          ],
                        );
                      },
                    )
                  : Center(
                      child: controller.loading
                          ? const Text('Loading the items from GitHub...')
                          : Column(
                              mainAxisSize: MainAxisSize.min,
                              spacing: 16,
                              children: [
                                Text(error ?? ''),
                                Tooltip(
                                  message: 'Connect to GitHub again',
                                  child: FilledButton(
                                    onPressed: controller.start,
                                    child: const Text('Try again'),
                                  ),
                                ),
                              ],
                            ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
