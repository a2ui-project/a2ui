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

/// Adapters mapping a2ui_core's Catalog model into the shape code generation needs.
library;

import 'package:a2ui_core/a2ui_core.dart';

/// A component definition parsed from a catalog JSON Schema.
class CatalogComponentDefinition {
  final ComponentApi component;

  CatalogComponentDefinition(this.component);

  String get name => component.name;

  String? get description => component.schema.value['description'] as String?;

  Map<String, dynamic> get rawSchema => component.schema.value;

  Map<String, dynamic> get properties =>
      (component.schema.value['properties'] as Map?)?.cast<String, dynamic>() ??
      const <String, dynamic>{};

  Set<String> get requiredProperties =>
      ((component.schema.value['required'] as List?)?.cast<String>() ??
              const <String>[])
          .toSet();
}

/// A function definition parsed from a catalog JSON Schema.
class CatalogFunctionDefinition {
  final FunctionApi function;

  CatalogFunctionDefinition(this.function);

  String get name => function.name;

  String? get description =>
      function.description ??
      (function.argumentSchema.value['description'] as String?);

  A2uiReturnType get returnType => function.returnType;

  Map<String, dynamic> get rawSchema => function.argumentSchema.value;

  Map<String, dynamic> get parameters =>
      (function.argumentSchema.value['properties'] as Map?)
          ?.cast<String, dynamic>() ??
      const <String, dynamic>{};

  Set<String> get requiredParameters =>
      ((function.argumentSchema.value['required'] as List?)?.cast<String>() ??
              const <String>[])
          .toSet();
}

/// A catalog JSON Schema parsed for code generation, backed by a2ui_core's [Catalog].
class CodegenCatalog {
  final CatalogApi catalog;

  CodegenCatalog(this.catalog);

  factory CodegenCatalog.fromJson(Map<String, dynamic> json) =>
      CodegenCatalog(Catalog.fromJson(json));

  String get id => catalog.id;

  String get version => catalog.protocolVersion ?? 'v0.9.1';

  Map<String, CatalogComponentDefinition> get components => {
    for (final c in catalog.components.values)
      c.name: CatalogComponentDefinition(c),
  };

  Map<String, CatalogFunctionDefinition> get functions => {
    for (final f in catalog.functions.values)
      f.name: CatalogFunctionDefinition(f),
  };
}
