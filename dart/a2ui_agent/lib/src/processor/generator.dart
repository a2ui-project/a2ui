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
import 'catalog_config.dart';
import 'processor.dart';

/// The long-lived entry point to the agent SDK.
///
/// Created once at agent startup with every catalog the agent supports; each
/// request gets an [A2uiRequestProcessor] negotiated for one renderer.
class A2uiGenerator {
  /// The catalogs the agent supports.
  final List<CatalogConfig> catalogs;

  /// Example turns the prompt shows the model, in order. Each is the list of
  /// messages making up one turn.
  ///
  /// Checked against the active catalogs each time a processor is created.
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
  /// accept inline catalogs here. [inferenceFormatFactory] overrides the
  /// generator's format for this processor.
  ///
  /// Throws [A2uiValidationError] if [rendererCapabilities] declares nothing
  /// for v0.9, [A2uiCatalogError] if no registered catalog is supported by the
  /// renderer, and the [A2uiError] a renderer would report for an example the
  /// active catalogs cannot render.
  A2uiRequestProcessor createProcessor(
    A2uiRendererCapabilities rendererCapabilities, {
    InferenceFormatFactory? inferenceFormatFactory,
  }) => A2uiRequestProcessor(
    activeCatalogs: resolveCatalogs(catalogs, rendererCapabilities),
    examples: examples,
    formatFactory: inferenceFormatFactory ?? this.inferenceFormatFactory,
  );
}
