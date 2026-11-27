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
import 'package:material_ui/material_ui.dart';
import 'package:shared/shared.dart';

import '../model/triage_item.dart';
import 'analysis_editor.dart';

/// The Flutter implementation of the triage catalog, whose
/// `TriageAnalysis` component is the [AnalysisEditor].
final CatalogImplementation triageCatalogImplementation = CatalogImplementation(
  id: triageCatalogId,
  protocolVersion: A2uiProtocolVersion.v1_0,
  components: [
    ComponentImplementation(
      name: TriageAnalysisProps.componentName,
      schema: triageAnalysisApi.schema,
      builder: (context, node, props, buildChild) => AnalysisEditor(
        item: _ItemScope.of(context),
        initial: TriageAnalysis.fromProperties({
          for (final String key in _properties) key: props.value(key),
        }),
      ),
    ),
  ],
);

const List<String> _properties = [
  TriageAnalysisProps.tldr,
  TriageAnalysisProps.summary,
  TriageAnalysisProps.reason,
  TriageAnalysisProps.suggestion,
  TriageAnalysisProps.reply,
  TriageAnalysisProps.closeAs,
  TriageAnalysisProps.duplicateOf,
  TriageAnalysisProps.addedLabels,
  TriageAnalysisProps.removedLabels,
  TriageAnalysisProps.newAssignees,
  TriageAnalysisProps.removedAssignees,
  TriageAnalysisProps.targetingPrs,
  TriageAnalysisProps.targetedIssues,
  TriageAnalysisProps.relatedItems,
];

/// Renders the analysis comment of [item] as an A2UI surface, with
/// [triageCatalogImplementation].
class AnalysisSurface extends StatefulWidget {
  const AnalysisSurface({super.key, required this.item, required this.payload});

  final TriageItem item;
  final AnalysisPayload payload;

  @override
  State<AnalysisSurface> createState() => _AnalysisSurfaceState();
}

class _AnalysisSurfaceState extends State<AnalysisSurface> {
  MessageProcessor<ComponentImplementation>? _processor;

  /// Why the messages do not render, or null if they do.
  String? _error;

  /// The surface that the messages create, if they render.
  SurfaceModel<ComponentImplementation>? _surface;

  void _process() {
    final MessageProcessor<ComponentImplementation> processor = _processor =
        MessageProcessor<ComponentImplementation>(
          catalogs: [triageCatalogImplementation],
          defaultVersion: A2uiProtocolVersion.v1_0,
        );
    // AnalysisPayload.parse checks that the messages create one surface,
    // so this fails only if the processors disagree.
    try {
      processor.processMessages(widget.payload.messages);
      _surface = processor.model.allSurfaces.singleOrNull;
      _error = _surface == null ? 'The analysis creates no surface.' : null;
    } on A2uiError catch (e) {
      _surface = null;
      _error = e.message;
    }
  }

  @override
  void initState() {
    super.initState();
    _process();
  }

  @override
  void didUpdateWidget(AnalysisSurface oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.payload, widget.payload)) {
      _processor?.dispose();
      _process();
    }
  }

  @override
  void dispose() {
    _processor?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => switch (_surface) {
    final SurfaceModel<ComponentImplementation> surface => _ItemScope(
      item: widget.item,
      child: A2uiSurface(surface: surface),
    ),
    null => Text(
      'The analysis cannot be shown: $_error',
      style: TextStyle(color: Theme.of(context).colorScheme.error),
    ),
  };
}

/// Gives the component implementation the item whose analysis it shows.
class _ItemScope extends InheritedWidget {
  const _ItemScope({required this.item, required super.child});

  final TriageItem item;

  static TriageItem of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_ItemScope>()!.item;

  @override
  bool updateShouldNotify(_ItemScope oldWidget) => item != oldWidget.item;
}
