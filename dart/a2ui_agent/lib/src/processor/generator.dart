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
/// Created once at startup with every catalog the agent supports; each request
/// produces an [A2uiRequestProcessor] negotiated for one renderer.
class A2uiGenerator {
  /// Every catalog configuration this agent supports, in preference order.
  final List<CatalogConfig> catalogs;

  /// Few-shot turns, validated against the negotiated catalogs by
  /// [createProcessor].
  final Map<String, List<A2uiMessage>>? examples;

  /// The format factory used when no per-request override is supplied.
  ///
  /// Required rather than defaulted: the format decides the token cost of
  /// every turn, so the caller chooses it explicitly rather than inheriting
  /// one that would be breaking to change later.
  final InferenceFormatFactory inferenceFormatFactory;

  /// Whether the agent accepts catalogs supplied inline by the renderer.
  final bool acceptsInlineCatalogs;

  A2uiGenerator({
    required this.catalogs,
    required this.inferenceFormatFactory,
    this.examples,
    this.acceptsInlineCatalogs = false,
  });

  /// Creates a processor bound to a renderer's declared capabilities.
  ///
  /// Throws [A2uiCatalogError] if no registered catalog matches, and
  /// [A2uiValidationError] if the capabilities declare no entry for the
  /// version this SDK implements, or if [examples] are invalid for the
  /// negotiated catalogs.
  A2uiRequestProcessor createProcessor(
    A2uiRendererCapabilities rendererCapabilities, {
    InferenceFormatFactory? inferenceFormatFactory,
  }) {
    throw UnimplementedError('A2uiGenerator.createProcessor');
  }

  /// The capabilities this agent advertises, mirroring
  /// `specification/v0_9_1/json/server_capabilities.json`.
  ///
  /// [catalogs] may mix protocol versions, so each catalog is advertised under
  /// the version it is registered for rather than under one version assumed
  /// for all of them. Every version this SDK implements gets an entry, even
  /// when no catalog is registered for it, because the schema requires one.
  ///
  /// Catalog ids are the pristine ones: transformers narrow what a catalog
  /// offers, they do not rename it.
  Map<String, Object?> get agentCapabilities {
    final Map<String, List<String>> idsByVersion = {
      for (final A2uiProtocolVersion version in A2uiProtocolVersion.values)
        version.jsonValue: <String>[],
    };
    for (final CatalogConfig config in catalogs) {
      idsByVersion[config.protocolVersion.jsonValue]!.add(config.catalog.id);
    }
    return {
      for (final MapEntry<String, List<String>> entry in idsByVersion.entries)
        entry.key: <String, Object?>{
          'supportedCatalogIds': entry.value,
          'acceptsInlineCatalogs': acceptsInlineCatalogs,
        },
    };
  }
}
