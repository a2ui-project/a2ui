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

import 'dart:async' show StreamSubscription;
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:flutter/material.dart';

import '../engine/surface_controller.dart';
import '../model/catalog.dart';
import '../model/catalog_item.dart';
import '../model/chat_message.dart';
import '../primitives/logging.dart';
import '../primitives/simple_items.dart';
import '../widgets/surface.dart';

/// A widget that displays a catalog of GenUI components.
///
/// This widget is intended for development and debugging purposes.
///
/// In order for a catalog item to be displayed, it must have example data
/// defined.
class DebugCatalogView extends StatefulWidget {
  const DebugCatalogView({
    super.key,
    this.onSubmit,
    required this.catalog,
    this.itemHeight,
  });

  /// The catalog of widgets to display.
  final Catalog catalog;

  /// A callback for when a user submits an action.
  final ValueChanged<ChatMessage>? onSubmit;

  /// If provided, constrains each item to the given height.
  final double? itemHeight;

  @override
  State<DebugCatalogView> createState() => _DebugCatalogViewState();
}

class _DebugCatalogViewState extends State<DebugCatalogView> {
  late final SurfaceController _surfaceController;
  final surfaceIds = <String>[];
  late final StreamSubscription<ChatMessage>? _subscription;

  @override
  void initState() {
    super.initState();
    final Catalog catalog = widget.catalog;

    _surfaceController = SurfaceController(catalogs: [widget.catalog]);
    if (widget.onSubmit != null) {
      _subscription = _surfaceController.onSubmit.listen(widget.onSubmit);
    } else {
      _subscription = null;
    }

    for (final CatalogItem item in catalog.items) {
      for (var i = 0; i < item.exampleData.length; i++) {
        final ExampleBuilderCallback exampleBuilder = item.exampleData[i];
        final indexPart = item.exampleData.length > 1 ? '-$i' : '';
        final surfaceId = '${item.name}$indexPart';

        final String exampleJsonString = exampleBuilder();

        try {
          final exampleData = jsonDecode(exampleJsonString) as List<Object?>;

          final List<JsonMap> components = exampleData
              .map((e) => e as JsonMap)
              .toList();

          if (!components.any((c) => c['id'] == 'root')) {
            genUiLogger.info(
              'Skipping example for ${item.name} because it is missing a root '
              'component.',
            );
            continue;
          }

          _surfaceController.handleMessage(
            core.UpdateComponentsMessage(
              surfaceId: surfaceId,
              components: components,
            ),
          );
          _surfaceController.handleMessage(
            core.CreateSurfaceMessage(
              surfaceId: surfaceId,
              catalogId: catalog.catalogId!,
            ),
          );
          surfaceIds.add(surfaceId);
        } catch (exception, stackTrace) {
          genUiLogger.severe(
            'Failed to load example for "${item.name}":\n'
            '$exception\n$stackTrace',
          );
          throw Exception(
            'Failed to load example for "${item.name}". Check logs for '
            'details.',
          );
        }
      }
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _surfaceController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      itemCount: surfaceIds.length,
      itemBuilder: (BuildContext context, int index) {
        final String surfaceId = surfaceIds[index];
        final surfaceWidget = Surface(
          surfaceContext: _surfaceController.contextFor(surfaceId),
        );
        return Card(
          color: Theme.of(context).colorScheme.secondaryContainer,
          child: Padding(
            padding: const EdgeInsets.all(8.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: <Widget>[
                Text(surfaceId, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8.0),
                SizedBox(height: widget.itemHeight, child: surfaceWidget),
              ],
            ),
          ),
        );
      },
    );
  }
}
