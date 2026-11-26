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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';

import 'analysis.dart';
import 'triage_analysis.dart';

/// Whether [body] has an `<a2ui>` block, as an analysis comment does.
bool hasA2uiBlock(String body) => _parser.hasFormatContent(body);

final ExpressParser _parser = ExpressParser([triageCatalog]);

final PayloadValidator<ComponentApi, FunctionApi> _validator =
    PayloadValidator<ComponentApi, FunctionApi>(
      catalog: triageCatalog,
      protocolVersion: A2uiProtocolVersion.v1_0,
    );

/// The analysis in an analysis comment, as A2UI messages and as values.
///
/// See `blueprints/features/triage_bot/analysis.blueprint.md`.
final class AnalysisPayload {
  AnalysisPayload._(this.messages, this.analysis);

  /// Reads the `TriageAnalysis` component from the `<a2ui>` block of a
  /// analysis comment's [body].
  ///
  /// Throws a [FormatException] that says what is wrong if [body] has no
  /// block, or the block is not one valid `TriageAnalysis` component.
  factory AnalysisPayload.parse(String body) {
    final List<RawA2uiPart> blocks = _parser
        .unwrap(body)
        .whereType<RawA2uiPart>()
        .toList();
    if (blocks.isEmpty) {
      throw const FormatException('The comment has no <a2ui> block.');
    }
    if (blocks.length > 1 || !blocks.single.isFinal) {
      throw const FormatException(
        'The comment must have exactly one closed <a2ui> block.',
      );
    }

    final List<AgentToRendererMessage> messages;
    try {
      messages = _parser.compile(blocks.single.a2uiRaw);
    } on A2uiError catch (e) {
      throw FormatException('The <a2ui> block does not compile: ${e.message}');
    }

    final List<Map<String, Object?>> components = [
      for (final AgentToRendererMessage message in messages)
        ...switch (message) {
          CreateSurfaceMessage(:final components?) => components,
          UpdateComponentsMessage(:final components) => components,
          _ => const <Map<String, Object?>>[],
        },
    ];
    if (components.length != 1 ||
        components.single['component'] != TriageAnalysisProps.componentName) {
      throw const FormatException(
        'The <a2ui> block must hold exactly one TriageAnalysis component.',
      );
    }
    try {
      _validator.validateComponent(components.single);
    } on A2uiError catch (e) {
      throw FormatException('The TriageAnalysis is not valid: ${e.message}');
    }
    _checkSurface(messages, components.single['id']);

    final Map<String, Object?> properties = {...components.single}
      ..remove('id');
    final analysis = TriageAnalysis.fromProperties(properties);
    if ((analysis.closeAs == TriageCloseReason.duplicate) !=
        (analysis.duplicateOf != null)) {
      throw const FormatException(
        'The TriageAnalysis must have duplicate_of exactly when close_as is '
        'duplicate.',
      );
    }
    return AnalysisPayload._(List.unmodifiable(messages), analysis);
  }

  /// Checks that [messages] create one surface whose root is the component
  /// with [id], as a renderer would build it. Compiling an `<a2ui>` block
  /// that assigns the component to another name than `root`, for example,
  /// updates components without creating a surface.
  static void _checkSurface(List<AgentToRendererMessage> messages, Object? id) {
    final processor = MessageProcessor<ComponentApi>.forAgent(
      catalogs: [triageCatalog],
      defaultVersion: A2uiProtocolVersion.v1_0,
    );
    try {
      processor.processMessages(messages);
      final List<SurfaceModel<ComponentApi>> surfaces = processor
          .model
          .allSurfaces
          .toList();
      if (surfaces.length != 1 || surfaces.single.rootId != id) {
        throw const FormatException(
          'The <a2ui> block must create one surface with the TriageAnalysis '
          'as its root.',
        );
      }
    } on A2uiError catch (e) {
      throw FormatException('The <a2ui> block does not render: ${e.message}');
    } finally {
      processor.dispose();
    }
  }

  /// The messages that create a surface with the component as its root.
  final List<AgentToRendererMessage> messages;

  /// The values of the component.
  final TriageAnalysis analysis;
}
