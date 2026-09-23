// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';

/// The published v0.9 basic catalog, relative to this package's root.
const String basicCatalogPath =
    '../../../specification/v0_9/catalogs/basic/catalog.json';

/// Reads the published v0.9 basic catalog.
SchemaCatalog loadBasicCatalog() => Catalog.fromJson(
  jsonDecode(File(basicCatalogPath).readAsStringSync()) as Map<String, Object?>,
);

/// [catalog] as a catalog `MessageProcessor` can hold.
///
/// `MessageProcessor` keeps surface state, and a surface invokes functions, so
/// its catalogs carry [FunctionImplementation]s rather than signatures. The
/// test only validates messages, so each function keeps its signature and
/// cannot be invoked.
Catalog<ComponentApi, FunctionImplementation> rendererCatalog(
  SchemaCatalog catalog,
) => Catalog<ComponentApi, FunctionImplementation>(
  id: catalog.id,
  components: catalog.components.values.toList(),
  functions: catalog.functions.values.map(_UncallableFunction.new).toList(),
  themeSchema: catalog.themeSchema,
  schemaId: catalog.schemaId,
  title: catalog.title,
  description: catalog.description,
);

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
