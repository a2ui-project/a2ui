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

/// Whether [version], a catalog's `protocolVersion` such as `v1.0` or `1.0`,
/// names protocol v1.0 or later.
///
/// Compares the major version only, so `v1.2` counts and `v0.9.1` does not. A
/// null or unparseable version is treated as v0.9, the version this SDK
/// implemented before catalogs declared one.
bool isProtocolV1OrLater(String? version) {
  if (version == null) return false;
  final String digits =
      version.startsWith('v') ? version.substring(1) : version;
  final int? major = int.tryParse(digits.split('.').first);
  return major != null && major >= 1;
}
