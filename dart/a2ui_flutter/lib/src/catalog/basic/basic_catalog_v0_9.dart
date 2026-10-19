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

/// The v0.9 basic catalog: every basic component, and the functions of
/// [BasicCatalog.v0_9] formatting for [locale], under the basic catalog's id,
/// theme schema, title, description, protocol version and instructions.
///
/// An `openUrl` call, which fails without [openUrl], may run whenever a bound
/// property resolves, not only on a tap.
CatalogImplementation basicCatalog({
  String locale = 'en-US',
  OpenUrlCallback? openUrl,
}) => CatalogImplementation(
  id: BasicCatalog.v0_9Id,
  components: BasicComponents.all,
  functions: BasicCatalog.v0_9(
    locale: locale,
    openUrl: openUrl,
  ).functions.values.toList(),
  themeSchema: BasicComponents.api.themeSchema,
  schemaId: BasicComponents.api.schemaId,
  title: BasicComponents.api.title,
  description: BasicComponents.api.description,
  protocolVersion: BasicComponents.api.protocolVersion,
  instructions: BasicComponents.api.instructions,
  definitions: BasicComponents.api.definitions,
);
