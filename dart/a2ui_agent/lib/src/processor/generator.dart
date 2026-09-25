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
import 'catalog_config.dart';
import 'processor.dart';

/// The long-lived entry point to the agent SDK.
///
/// Created once at agent startup with every catalog the agent supports; each
/// request gets an [A2uiRequestProcessor] negotiated for one renderer.
class A2uiGenerator {
  /// The catalogs the agent supports.
  final List<CatalogConfig> catalogs;

  /// The format the LLM writes payloads in.
  ///
  /// Required rather than defaulted: the format decides what the LLM is taught
  /// and how its response is read, so the agent names it explicitly.
  final InferenceFormatFactory inferenceFormatFactory;

  A2uiGenerator({required this.catalogs, required this.inferenceFormatFactory});

  /// Creates a processor for a renderer that declared [rendererCapabilities].
  ///
  /// The active catalogs are the registered ones the renderer supports for
  /// protocol v0.9, in the renderer's preference order. Inline catalogs are
  /// not accepted, so any the renderer sends are ignored.
  ///
  /// Throws [A2uiValidationError] if [rendererCapabilities] declares nothing
  /// for v0.9, [A2uiCatalogError] if no registered catalog is supported by the
  /// renderer, and [UnsupportedError] if [inferenceFormatFactory] is not
  /// Express.
  A2uiRequestProcessor createProcessor(
    A2uiRendererCapabilities rendererCapabilities,
  ) {
    const A2uiProtocolVersion version = A2uiProtocolVersion.v0_9;
    final A2uiVersionCapabilities? capabilities = rendererCapabilities
        .forVersion(version);
    if (capabilities == null) {
      throw A2uiValidationError(
        'Renderer capabilities declare nothing for ${version.jsonValue}, the '
        'only version this SDK supports.',
        details: rendererCapabilities.toJson(),
      );
    }

    final Map<String, SchemaCatalog> registered = {
      for (final CatalogConfig config in catalogs)
        config.catalog.id: config.catalog,
    };
    final List<SchemaCatalog> active = [
      ...{
        for (final String id in capabilities.supportedCatalogIds)
          ?registered[id],
      },
    ];
    if (active.isEmpty) {
      throw A2uiCatalogError(
        'The renderer supports none of the catalogs registered with this '
        'agent. Renderer: ${capabilities.supportedCatalogIds}; agent: '
        '${registered.keys.toList()}.',
      );
    }

    return A2uiRequestProcessor(
      activeCatalogs: active,
      formatFactory: inferenceFormatFactory,
    );
  }
}
