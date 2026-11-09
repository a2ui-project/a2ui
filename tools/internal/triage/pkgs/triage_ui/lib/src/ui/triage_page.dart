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

import 'dart:ui';

import 'package:flutter/material.dart';

import '../model/triage_controller.dart';
import 'item_details.dart';
import 'item_list.dart';
import 'session_report_dialog.dart';
import 'triage_scope.dart';

/// The triage UI's only page: the header, the items on the left and the
/// details of the selected item on the right. See `ui.blueprint.md`.
class TriagePage extends StatefulWidget {
  const TriagePage({super.key});

  @override
  State<TriagePage> createState() => _TriagePageState();
}

class _TriagePageState extends State<TriagePage> {
  late final AppLifecycleListener _lifecycle;

  /// The width of the item list, which the triager changes by dragging the
  /// divider.
  double _listWidth = 400;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onExitRequested: _onExitRequested);
  }

  /// Offers the session report before the app closes, if the triager
  /// applied items and did not copy the report since.
  Future<AppExitResponse> _onExitRequested() async {
    final TriageController controller = TriageScope.read(context);
    if (!controller.session.needsReport) return AppExitResponse.exit;
    final bool close = await showSessionReport(
      context,
      controller,
      closing: true,
    );
    return close ? AppExitResponse.exit : AppExitResponse.cancel;
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final String? error = controller.error;
    final int remaining = controller.remaining;
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
                  'Show what you did in this session, to share with the '
                  'team',
              child: MenuItemButton(
                leadingIcon: const Icon(Icons.summarize_outlined),
                onPressed: () => showSessionReport(context, controller),
                child: const Text('Session report'),
              ),
            ),
          ],
        ),
        title: const Text('A2UI triage'),
        actions: [
          if (controller.isConnected)
            Padding(
              padding: const EdgeInsets.only(right: 24),
              child: Text(
                '$remaining ${remaining == 1 ? 'item needs' : 'items need'} '
                'triage',
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
                      final double width = _listWidth.clamp(
                        _minColumnWidth,
                        (constraints.maxWidth - _minColumnWidth).clamp(
                          _minColumnWidth,
                          double.infinity,
                        ),
                      );
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          SizedBox(width: width, child: const ItemList()),
                          _ColumnDivider(
                            onDrag: (double delta) =>
                                setState(() => _listWidth = width + delta),
                          ),
                          const Expanded(child: ItemDetails()),
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
    );
  }
}

/// The narrowest that the item list and the details can be.
const double _minColumnWidth = 240;

/// The divider between the item list and the details, which the triager
/// drags to resize them.
class _ColumnDivider extends StatelessWidget {
  const _ColumnDivider({required this.onDrag});

  /// Called with how far the divider moved to the right.
  final void Function(double delta) onDrag;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Resize the item list',
    child: MouseRegion(
      cursor: SystemMouseCursors.resizeColumn,
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onHorizontalDragUpdate: (DragUpdateDetails d) => onDrag(d.delta.dx),
        child: const SizedBox(
          width: 9,
          child: VerticalDivider(width: 9, thickness: 1),
        ),
      ),
    ),
  );
}
