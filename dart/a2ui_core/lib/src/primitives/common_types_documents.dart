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

import '../validation/common_types.g.dart';
import 'semver.dart';

/// The `common_types.json` document this package embeds for a catalog
/// declaring [protocolVersion], such as `v1.0` or `1.0`.
///
/// Returns the v1.0 document for 1.0 and later, and the v0.9 document for
/// anything else, including null: the catalog definition schema defaults an
/// undeclared `protocolVersion` to 0.9. This is the one place that choice is
/// made, so `Catalog`, `PayloadValidator`, and the schema readers resolve a
/// catalog's shared types against the same document.
///
/// Each call returns a fresh document, so a caller may edit the result.
Map<String, Object?> commonTypesForProtocolVersion(String? protocolVersion) =>
    jsonDecode(
      isVersionAtLeast(protocolVersion, 'v1.0')
          ? commonTypesV1_0Json
          : commonTypesV0_9Json,
    ) as Map<String, Object?>;
