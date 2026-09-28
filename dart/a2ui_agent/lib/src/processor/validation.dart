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

/// Checks [payloads] the way a renderer holding [catalogs] would, applying
/// them in order to surfaces that start empty.
///
/// Each payload is one render: every surface it creates must be complete.
///
/// Throws the [A2uiError] a renderer would report for the first message it
/// rejects.
void validatePayloads(
  List<SchemaCatalog> catalogs,
  Iterable<List<AgentToRendererMessage>> payloads,
) {
  final renderer = MessageProcessor<ComponentApi>(
    catalogs: [for (final SchemaCatalog catalog in catalogs) _signed(catalog)],
    protocolVersion: A2uiProtocolVersion.v0_9,
  );
  try {
    for (final payload in payloads) {
      renderer.processMessages(AgentToRendererMessagePayload(payload));
    }
  } finally {
    renderer.groupModel.dispose();
  }
}

/// [catalog] as a catalog `MessageProcessor` can hold.
///
/// `MessageProcessor` keeps surface state, and a surface invokes functions, so
/// its catalogs carry [FunctionImplementation]s rather than signatures.
/// Validation never invokes one, so each function keeps its signature only.
Catalog<ComponentApi, FunctionImplementation> _signed(SchemaCatalog catalog) =>
    Catalog<ComponentApi, FunctionImplementation>(
      id: catalog.id,
      components: catalog.components.values.toList(),
      functions: catalog.functions.values.map(_SignatureOnly.new).toList(),
      themeSchema: catalog.themeSchema,
      schemaId: catalog.schemaId,
      title: catalog.title,
      description: catalog.description,
    );

class _SignatureOnly extends FunctionImplementation {
  _SignatureOnly(FunctionApi api)
    : super(
        name: api.name,
        argumentSchema: api.argumentSchema,
        returnType: api.returnType,
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) => throw UnsupportedError(
    "Function '$name' is a signature only and cannot be invoked.",
  );
}
