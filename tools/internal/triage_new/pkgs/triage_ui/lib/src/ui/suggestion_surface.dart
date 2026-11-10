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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:triage/triage.dart';

import '../model/triage_item.dart';
import 'suggestion_editor.dart';

/// The Flutter implementation of the triage catalog, whose
/// `TriageSuggestion` component is the [SuggestionEditor].
final CatalogImplementation triageCatalogImplementation = CatalogImplementation(
  id: triageCatalogId,
  protocolVersion: A2uiProtocolVersion.v1_0,
  components: [
    ComponentImplementation(
      name: TriageSuggestionProps.componentName,
      schema: triageSuggestionApi.schema,
      builder: (context, node, props, buildChild) => SuggestionEditor(
        item: _ItemScope.of(context),
        initial: TriageSuggestion.fromProperties({
          for (final String key in _properties) key: props.value(key),
        }),
      ),
    ),
  ],
);

const List<String> _properties = [
  TriageSuggestionProps.summary,
  TriageSuggestionProps.suggestion,
  TriageSuggestionProps.reply,
  TriageSuggestionProps.closeAs,
  TriageSuggestionProps.duplicateOf,
  TriageSuggestionProps.addedLabels,
  TriageSuggestionProps.removedLabels,
  TriageSuggestionProps.newAssignees,
  TriageSuggestionProps.removedAssignees,
  TriageSuggestionProps.relatedIssues,
  TriageSuggestionProps.relatedPrs,
];

/// Renders the suggestion comment of [item] as an A2UI surface, with
/// [triageCatalogImplementation].
class SuggestionSurface extends StatefulWidget {
  const SuggestionSurface({
    super.key,
    required this.item,
    required this.payload,
  });

  final TriageItem item;
  final SuggestionPayload payload;

  @override
  State<SuggestionSurface> createState() => _SuggestionSurfaceState();
}

class _SuggestionSurfaceState extends State<SuggestionSurface> {
  MessageProcessor<ComponentImplementation>? _processor;

  void _process() {
    _processor = MessageProcessor<ComponentImplementation>(
      catalogs: [triageCatalogImplementation],
      defaultVersion: A2uiProtocolVersion.v1_0,
    )..processMessages(widget.payload.messages);
  }

  @override
  void initState() {
    super.initState();
    _process();
  }

  @override
  void didUpdateWidget(SuggestionSurface oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.payload, widget.payload)) {
      _processor?.model.dispose();
      _process();
    }
  }

  @override
  void dispose() {
    _processor?.model.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _ItemScope(
    item: widget.item,
    child: A2uiSurface(surface: _processor!.model.allSurfaces.single),
  );
}

/// Gives the component implementation the item whose suggestion it shows.
class _ItemScope extends InheritedWidget {
  const _ItemScope({required this.item, required super.child});

  final TriageItem item;

  static TriageItem of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_ItemScope>()!.item;

  @override
  bool updateShouldNotify(_ItemScope oldWidget) => item != oldWidget.item;
}
