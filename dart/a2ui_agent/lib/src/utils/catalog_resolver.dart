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

import '../processor/catalog_config.dart';

/// Negotiates renderer capabilities against the catalogs an agent supports.
///
/// Returns the transformed catalogs to prompt and validate against, in agent
/// preference order, falling back to the first registered one. Inline catalogs
/// count only when [acceptsInlineCatalogs] is true.
///
/// Throws [A2uiCatalogError] if no registered catalog matches, and
/// [A2uiValidationError] if [rendererCapabilities] declares nothing for the
/// protocol version this SDK implements.
List<Catalog<C, F>>
resolveCatalogs<C extends ComponentApi, F extends FunctionApi>(
  List<CatalogConfig<C, F>> catalogs,
  A2uiRendererCapabilities rendererCapabilities, {
  bool acceptsInlineCatalogs = false,
}) {
  throw UnimplementedError('resolveCatalogs');
}
