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
            MenuItemButton(
              leadingIcon: const Icon(Icons.refresh),
              onPressed: controller.isConnected && !controller.loading
                  ? controller.refresh
                  : null,
              child: const Text('Refresh'),
            ),
            MenuItemButton(
              leadingIcon: const Icon(Icons.summarize_outlined),
              onPressed: () => showSessionReport(context, controller),
              child: const Text('Session report'),
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
                TextButton(
                  onPressed: controller.dismissError,
                  child: const Text('Dismiss'),
                ),
              ],
            ),
          Expanded(
            child: controller.isConnected
                ? const Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      SizedBox(width: 400, child: ItemList()),
                      VerticalDivider(width: 1),
                      Expanded(child: ItemDetails()),
                    ],
                  )
                : Center(
                    child: controller.loading
                        ? const Text('Loading the items from GitHub...')
                        : Column(
                            mainAxisSize: MainAxisSize.min,
                            spacing: 16,
                            children: [
                              Text(error ?? ''),
                              FilledButton(
                                onPressed: controller.start,
                                child: const Text('Try again'),
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
