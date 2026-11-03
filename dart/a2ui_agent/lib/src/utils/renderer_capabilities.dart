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

/// Transport metadata key for v0.8 and v0.9 client capabilities.
const String a2uiClientCapabilitiesKey = 'a2uiClientCapabilities';

/// Transport metadata key for v1.0+ renderer capabilities.
const String a2uiRendererCapabilitiesKey = 'a2uiRendererCapabilities';

/// Reads and validates renderer capabilities for [version] from transport
/// [metadata].
///
/// Looks up [a2uiRendererCapabilitiesKey] for v1.0 and
/// [a2uiClientCapabilitiesKey] for v0.9 and v0.9.1. Returns `null` when
/// [metadata] is `null` or the version's capabilities entry is absent, and
/// throws [A2uiCatalogError] when the metadata key or version entry is
/// malformed.
Map<String, Object?>? readRendererCapabilities(
  Map<String, Object?>? metadata, [
  A2uiProtocolVersion version = A2uiProtocolVersion.v1_0,
]) {
  if (metadata == null) return null;

  final String metadataKey = version == A2uiProtocolVersion.v1_0
      ? a2uiRendererCapabilitiesKey
      : a2uiClientCapabilitiesKey;
  if (!metadata.containsKey(metadataKey) || metadata[metadataKey] == null) {
    return null;
  }

  final Object? raw = metadata[metadataKey];
  if (raw is! Map<String, Object?>) {
    throw A2uiCatalogError(
      "The '$metadataKey' metadata value must be a JSON object.",
    );
  }

  final String entryKey = version == A2uiProtocolVersion.v1_0 ? '1.0' : 'v0.9';
  if (!raw.containsKey(entryKey) || raw[entryKey] == null) {
    return null;
  }

  final Object? entry = raw[entryKey];
  if (entry is! Map<String, Object?>) {
    throw A2uiCatalogError(
      "The '$entryKey' capabilities entry under '$metadataKey' must be a JSON "
      'object.',
    );
  }

  try {
    A2uiRendererCapabilities.fromJson(<String, Object?>{entryKey: entry});
  } on A2uiError catch (e) {
    if (e is A2uiCatalogError) rethrow;
    throw A2uiCatalogError(e.message);
  }

  return <String, Object?>{entryKey: Map<String, Object?>.of(entry)};
}
