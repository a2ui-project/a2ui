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

import 'base.dart';

/// Prunes catalog component definitions to an allowlist.
///
/// Names in the allowlist that the catalog does not declare are ignored, so a
/// single transformer can be reused across catalogs.
class ComponentPruningTransformer<C extends ComponentApi, F extends FunctionApi>
    extends CatalogTransformer<C, F> {
  /// The components to keep.
  final Set<String> allowedComponents;

  ComponentPruningTransformer(Iterable<String> allowedComponents)
    : allowedComponents = Set<String>.unmodifiable(allowedComponents);

  @override
  Catalog<C, F> transform(Catalog<C, F> catalog) => catalog.copyWith(
    components: [
      for (final MapEntry<String, C> entry in catalog.components.entries)
        if (allowedComponents.contains(entry.key)) entry.value,
    ],
  );
}

/// Prunes catalog function definitions to an allowlist.
///
/// Names in the allowlist that the catalog does not declare are ignored, so a
/// single transformer can be reused across catalogs.
class FunctionPruningTransformer<C extends ComponentApi, F extends FunctionApi>
    extends CatalogTransformer<C, F> {
  /// The functions to keep.
  final Set<String> allowedFunctions;

  FunctionPruningTransformer(Iterable<String> allowedFunctions)
    : allowedFunctions = Set<String>.unmodifiable(allowedFunctions);

  @override
  Catalog<C, F> transform(Catalog<C, F> catalog) => catalog.copyWith(
    functions: [
      for (final MapEntry<String, F> entry in catalog.functions.entries)
        if (allowedFunctions.contains(entry.key)) entry.value,
    ],
  );
}
