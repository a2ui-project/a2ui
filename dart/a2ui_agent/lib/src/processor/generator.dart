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

import '../inference_format.dart';
import '../inference_formats/direct_json/format.dart';
import '../utils/catalog_resolver.dart';
import '../utils/catalogs.dart';
import 'catalog_config.dart';
import 'processor.dart';

/// The long-lived entry point to the agent SDK.
///
/// Created once at agent startup with every catalog the agent supports; each
/// request gets an [A2uiRequestProcessor] negotiated for one renderer.
///
/// The catalogs may target several protocol versions, so that one generator
/// serves renderers of each: [createProcessor] negotiates the version with
/// the renderer, as [resolveCatalogs] describes.
class A2uiGenerator {
  /// The catalogs the agent supports.
  final List<CatalogConfig> catalogs;

  /// Example turns the prompt shows the model, in order. Each is the list of
  /// messages making up one turn.
  ///
  /// A processor gets the turns written in the protocol version it
  /// negotiated, which are checked against its active catalogs each time a
  /// processor is created.
  final List<List<AgentToRendererMessage>> examples;

  /// The format the LLM writes payloads in, unless [createProcessor] is given
  /// another.
  final InferenceFormatFactory inferenceFormatFactory;

  A2uiGenerator({
    required this.catalogs,
    this.examples = const [],
    this.inferenceFormatFactory = const DirectJsonFormatFactory(),
  });

  /// Creates a processor for a renderer that declared [rendererCapabilities].
  ///
  /// The active catalogs are those [resolveCatalogs] returns, which does not
  /// accept inline catalogs here, and the examples are the turns written in
  /// their protocol version. [inferenceFormatFactory] overrides the
  /// generator's format for this processor.
  ///
  /// Throws [A2uiValidationError] if [rendererCapabilities] declares nothing
  /// for any version of the registered catalogs, or an example turn is
  /// written in a version none of them targets; [A2uiCatalogError] if the
  /// renderer supports none of the registered catalogs; and the [A2uiError] a
  /// renderer would report for an example the active catalogs cannot render.
  A2uiRequestProcessor createProcessor(
    A2uiRendererCapabilities rendererCapabilities, {
    InferenceFormatFactory? inferenceFormatFactory,
  }) {
    final List<CatalogApi> active = resolveCatalogs(
      catalogs,
      rendererCapabilities,
    );
    return A2uiRequestProcessor(
      activeCatalogs: active,
      examples: _examplesIn(catalogsProtocolVersion(active)),
      formatFactory: inferenceFormatFactory ?? this.inferenceFormatFactory,
    );
  }

  /// The turns of [examples] written in [version]: those whose every message
  /// a catalog of [version] accepts, in order.
  ///
  /// The turns written in the version of another registered catalog are left
  /// for the processors that negotiate it. Throws [A2uiValidationError] for a
  /// turn no registered catalog's version accepts, since no processor would
  /// show it.
  List<List<AgentToRendererMessage>> _examplesIn(A2uiProtocolVersion version) {
    bool accepts(A2uiProtocolVersion v, List<AgentToRendererMessage> turn) =>
        turn.every((m) => isCatalogVersionCompatible(v.jsonValue, m.version));
    final Set<A2uiProtocolVersion> registered = {
      for (final CatalogConfig config in catalogs)
        catalogsProtocolVersion([config.catalog]),
    };
    final kept = <List<AgentToRendererMessage>>[];
    for (final (int i, List<AgentToRendererMessage> turn) in examples.indexed) {
      if (accepts(version, turn)) {
        kept.add(turn);
      } else if (!registered.any((v) => accepts(v, turn))) {
        final Set<String> versions = {for (final m in turn) m.version};
        throw A2uiValidationError(
          versions.length == 1
              ? 'Example turn ${i + 1} is written in ${versions.single}, '
                    'which no registered catalog targets.'
              : 'Example turn ${i + 1} mixes ${versions.join(' and ')}, '
                    'which no catalog accepts together.',
        );
      }
    }
    return kept;
  }
}
