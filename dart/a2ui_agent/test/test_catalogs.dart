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

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';

import 'conformance/conformance_harness.dart';

/// The path of the published basic catalog, relative to `conformance/`.
///
/// Tests are measured against the specification's catalog rather than any
/// catalog implemented inside an SDK, so every implementation is held to the
/// same contract.
const String basicCatalogPath =
    '../specification/v0_9_1/catalogs/basic/catalog.json';

/// The `catalogId` the published basic catalog declares.
const String basicCatalogId =
    'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/// The absolute path of the published basic catalog.
String basicCatalogFile() => resolveConformancePath(basicCatalogPath);

/// The published basic catalog document.
Map<String, Object?> basicCatalogJson() =>
    jsonDecode(File(basicCatalogFile()).readAsStringSync())
        as Map<String, Object?>;

/// The published basic catalog, parsed.
SchemaCatalog basicCatalog() => Catalog.fromJson(basicCatalogJson());

/// Renderer capabilities declaring support for the basic catalog.
A2uiRendererCapabilities basicCatalogCapabilities() =>
    A2uiRendererCapabilities.forCatalogIds([basicCatalogId]);

/// A small catalog used where the full basic catalog would obscure the case.
SchemaCatalog smallCatalog({String id = 'https://example.com/small.json'}) =>
    Catalog.fromJson({
      'catalogId': id,
      'components': {
        'Text': {'type': 'object'},
        'Card': {'type': 'object'},
        'Button': {'type': 'object'},
      },
      'functions': {
        'required': {
          'type': 'object',
          'properties': {
            'call': {'const': 'required'},
            'args': {'type': 'object'},
            'returnType': {'const': 'boolean'},
          },
        },
        'email': {
          'type': 'object',
          'properties': {
            'call': {'const': 'email'},
            'args': {'type': 'object'},
            'returnType': {'const': 'boolean'},
          },
        },
      },
      r'$defs': {
        'anyComponent': {
          'oneOf': [
            {r'$ref': '#/components/Text'},
            {r'$ref': '#/components/Card'},
            {r'$ref': '#/components/Button'},
          ],
        },
        'anyFunction': {
          'oneOf': [
            {r'$ref': '#/functions/required'},
            {r'$ref': '#/functions/email'},
          ],
        },
      },
    });
