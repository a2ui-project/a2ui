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

import '../primitives/reference_schema.dart';

export '../primitives/reference_schema.dart'
    show ListRef, NestedRef, RefFields, RefKind, SingleRef;

/// Uses graph validation's schema classification plus the resolver-only
/// structural `ChildList` recognition.
///
/// Classification is not cached by schema identity: local aliases can resolve
/// differently when the same schema is used in different catalog documents.
RefFields extractRefFields(
  Schema schema, {
  Map<String, Object?> document = const {},
}) => ReferenceSchemaReader(schema.value, document: document).fields();
