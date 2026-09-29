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

/// Reads a catalog document as a catalog `MessageProcessor` can hold.
///
/// `Catalog.fromJson` produces a [SchemaCatalog], whose functions are
/// signatures ([FunctionApi]). `MessageProcessor` maintains surface state, and
/// a surface invokes functions, so its catalogs carry [FunctionImplementation]
/// instead. Dart's generics are covariant, so the schema-only catalog is not
/// one of those; each function is wrapped here instead.
///
/// Tests that validate payloads never invoke a function, so a signature is all
/// they need and [_UncallableFunction.execute] is unreachable. A renderer
/// supplies real implementations.
Catalog<ComponentApi, FunctionImplementation> rendererCatalog(
  Map<String, Object?> document, {
  String? asCatalogId,
}) {
  final SchemaCatalog catalog = Catalog.fromJson(
    asCatalogId == null
        ? document
        : <String, Object?>{...document, 'catalogId': asCatalogId},
  );
  return Catalog<ComponentApi, FunctionImplementation>(
    id: catalog.id,
    components: catalog.components.values.toList(),
    functions: catalog.functions.values.map(_UncallableFunction.new).toList(),
    themeSchema: catalog.themeSchema,
    schemaId: catalog.schemaId,
    title: catalog.title,
    description: catalog.description,
  );
}

/// A catalog function carrying its signature and no behaviour.
class _UncallableFunction extends FunctionImplementation {
  _UncallableFunction(FunctionApi api)
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
    "Function '$name' carries a signature only and cannot be invoked.",
  );
}
