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

import '../../core/catalog.dart';
import 'catalog.g.dart';

/// The published v0.9 basic catalog, read through [Catalog.fromJson].
///
/// The components come from this document rather than from hand-written
/// [ComponentApi] subclasses: the core holds no component behaviour, so a
/// component is its name and schema, which is exactly what [Catalog.fromJson]
/// produces. Reading the embedded copy keeps every schema identical to the
/// published one, and `tool/generate_basic_catalogs.dart` refreshes it.
///
/// Parsed on each call, so each catalog owns its schemas and a caller that
/// edits one cannot change another.
CatalogApi publishedBasicCatalogV0_9() => Catalog.fromJson(
      jsonDecode(basicCatalogV0_9Json) as Map<String, Object?>,
      protocolVersion: 'v0.9',
    );
