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
import 'catalog_config.dart';
import 'processor.dart';

/// The agent-level, long-lived entry point to the A2UI agent SDK.
///
/// Created once at agent startup with every catalog the agent can generate UI
/// for. Each incoming request produces an [A2uiRequestProcessor] pre-negotiated
/// against that renderer's capabilities.
class A2uiGenerator<C extends ComponentApi, F extends FunctionApi> {
  /// Every catalog configuration this agent supports, in preference order.
  final List<CatalogConfig<C, F>> catalogs;

  /// Few-shot example turns shared across sessions.
  ///
  /// Validated against the negotiated catalogs by [createProcessor].
  final Map<String, List<A2uiMessage>>? examples;

  /// The format factory used when no per-request override is supplied.
  final InferenceFormatFactory<C, F> inferenceFormatFactory;

  /// Whether the agent accepts catalogs supplied inline by the renderer.
  final bool acceptsInlineCatalogs;

  A2uiGenerator({
    required this.catalogs,
    this.examples,
    this.acceptsInlineCatalogs = false,
    InferenceFormatFactory<C, F>? inferenceFormatFactory,
  }) : inferenceFormatFactory =
           inferenceFormatFactory ?? DirectJsonFormatFactory<C, F>();

  /// Creates a processor bound to a renderer's declared capabilities.
  ///
  /// Throws [A2uiCatalogError] if no registered catalog matches the renderer,
  /// and [A2uiValidationError] if the capabilities declare no entry for the
  /// protocol version this SDK implements, or if [examples] are not valid for
  /// the negotiated catalogs.
  A2uiRequestProcessor<C, F> createProcessor(
    A2uiRendererCapabilities rendererCapabilities, {
    InferenceFormatFactory<C, F>? inferenceFormatFactory,
  }) {
    throw UnimplementedError('A2uiGenerator.createProcessor');
  }

  /// The capabilities this agent advertises to renderers.
  ///
  /// Mirrors `specification/v0_9_1/json/server_capabilities.json`.
  Map<String, Object?> get agentCapabilities => {
    'a2uiVersions': [A2uiProtocolVersion.v0_9.jsonValue],
    'supportedCatalogIds': [
      for (final CatalogConfig<C, F> config in catalogs) config.catalog.id,
    ],
    'acceptsInlineCatalogs': acceptsInlineCatalogs,
  };
}
