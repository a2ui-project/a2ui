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

import 'package:material_ui/material_ui.dart';

import '../model/triage_controller.dart';
import 'column_divider.dart';
import 'item_details.dart';
import 'item_list.dart';
import 'report_dialog.dart';
import 'triage_scope.dart';

/// The triage UI's only page: the header, the items on the left and the
/// details of the selected item on the right. See `ui.blueprint.md`.
class TriagePage extends StatefulWidget {
  const TriagePage({super.key, this.onSignOut});

  /// Signs out of GitHub, on the web. Null hides **Sign out**.
  final VoidCallback? onSignOut;

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
    final int remaining = controller.remaining;
    // Every text on the page can be selected and copied. The texts have
    // selection areas of their own, side by side, not one around the page:
    // in nested areas, a press held before a drag gave the focus to the
    // outer area, so Cmd+C copied nothing from the inner one.
    return Scaffold(
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
                  'Get the prompt that asks an agent for the triage report '
                  'of this session',
              child: MenuItemButton(
                leadingIcon: const Icon(Icons.summarize_outlined),
                onPressed: () => showReportDialog(context),
                child: const Text('Create report'),
              ),
            ),
            if (widget.onSignOut case final VoidCallback onSignOut)
              Tooltip(
                message: 'Sign out of GitHub in this browser',
                child: MenuItemButton(
                  leadingIcon: const Icon(Icons.logout),
                  onPressed: onSignOut,
                  child: const Text('Sign out'),
                ),
              ),
          ],
        ),
        title: const SelectionArea(child: Text('A2UI triage')),
        actions: [
          if (controller.isConnected) ...[
            Tooltip(
              message:
                  'Load the items from GitHub again. Your edits are kept, '
                  'except for items that changed on GitHub.',
              child: TextButton.icon(
                icon: const Icon(Icons.refresh),
                onPressed: controller.loading ? null : controller.refresh,
                label: const Text('Refresh'),
              ),
            ),
            Tooltip(
              message:
                  'Hide the items that do not belong to '
                  'the group after the applied editing.',
              child: TextButton.icon(
                icon: const Icon(Icons.visibility_off_outlined),
                onPressed: controller.hasTriaged
                    ? controller.hideTriaged
                    : null,
                label: const Text('Hide triaged'),
              ),
            ),
            const SizedBox(width: 16),
            Padding(
              padding: const EdgeInsets.only(right: 24),
              child: Tooltip(
                message:
                    '$remaining of the $total items in the queue are not '
                    'triaged or sent to the team yet',
                child: SelectionArea(child: Text('$remaining/$total')),
              ),
            ),
          ],
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
              content: SelectionArea(child: Text(error)),
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
                          // of their own, so that a click on an item does
                          // not leave a caret that keeps a drag in the
                          // details from selecting.
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
                    child: SelectionArea(
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
          ),
        ],
      ),
    );
  }
}
