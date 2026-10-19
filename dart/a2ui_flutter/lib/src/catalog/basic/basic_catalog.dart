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

import '../../component_implementation.dart';
import 'basic_components.dart';

/// The v1.0 basic catalog: every basic component, checked against the v1.0
/// schemas, and the functions of [BasicCatalog.v1_0] formatting for [locale],
/// under the v1.0 basic catalog's id, title, description, protocol version
/// and instructions.
///
/// An `openUrl` call fails without [openUrl], and outside a user action such
/// as a tap.
CatalogImplementation basicCatalog({
  String locale = 'en-US',
  OpenUrlCallback? openUrl,
}) {
  final Catalog<ComponentApi, FunctionImplementation> api = BasicCatalog.v1_0(
    locale: locale,
    openUrl: openUrl,
  );
  return CatalogImplementation(
    id: api.id,
    components: [
      for (final ComponentImplementation component in BasicComponents.all)
        ComponentImplementation(
          name: component.name,
          schema: api.components[component.name]!.schema,
          builder: component.builder,
        ),
    ],
    functions: api.functions.values.toList(),
    schemaId: api.schemaId,
    title: api.title,
    description: api.description,
    protocolVersion: api.protocolVersion,
    instructions: api.instructions,
    definitions: api.definitions,
  );
}
