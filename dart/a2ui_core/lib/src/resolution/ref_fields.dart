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

import 'package:json_schema_builder/json_schema_builder.dart';

import '../core/catalog.dart';
import '../primitives/reference_schema.dart';

export '../primitives/reference_schema.dart'
    show ListRef, NestedRef, RefFields, RefKind, SingleRef;

/// Classifies the child-reference properties of [schema], including
/// structural `ChildList` shapes and the `child`/`children` name fallbacks.
///
/// Uses the same classification as [Catalog.refMap], which is what the node
/// resolver and graph validation read for a catalog's components. This entry
/// point is for a schema outside a catalog, so nothing is cached: local
/// aliases can resolve differently when the same schema is used in different
/// catalog documents.
///
/// [commonTypes] is the `common_types.json` document used for external and
/// fallback pointers; it defaults to the embedded v0.9 document.
RefFields extractRefFields(
  Schema schema, {
  Map<String, Object?> document = const {},
  Map<String, Object?>? commonTypes,
}) =>
    ReferenceSchemaReader(
      schema.value,
      document: document,
      commonTypes: commonTypes,
    ).fields();
