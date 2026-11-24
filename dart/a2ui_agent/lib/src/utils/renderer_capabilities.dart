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

import 'catalogs.dart';

/// Transport metadata key for v0.9 and v0.9.1 client capabilities.
const String a2uiClientCapabilitiesKey = 'a2uiClientCapabilities';

/// Transport metadata key for v1.0 and later renderer capabilities.
const String a2uiRendererCapabilitiesKey = 'a2uiRendererCapabilities';

const Set<String> _allowedEntryKeys = {'supportedCatalogIds', 'inlineCatalogs'};

/// Reads and validates renderer capabilities for [version] from transport
/// [metadata].
///
/// Looks up [a2uiRendererCapabilitiesKey] for v1.0 and
/// [a2uiClientCapabilitiesKey] for v0.9 and v0.9.1. Returns an
/// [A2uiRendererCapabilities] accepted unchanged by `resolveCatalogs` and
/// `A2uiGenerator.createProcessor`, or `null` when [metadata] is `null` or the
/// version's capabilities entry is absent. Throws [A2uiCatalogError] when the
/// metadata key or version entry is malformed.
A2uiRendererCapabilities? readRendererCapabilities(
  Map<String, Object?>? metadata, [
  A2uiProtocolVersion version = A2uiProtocolVersion.v1_0,
]) {
  if (metadata == null) return null;

  final String metadataKey = version.isAtLeast(A2uiProtocolVersion.v1_0)
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

  final String entryKey = version.isAtLeast(A2uiProtocolVersion.v1_0)
      ? version.jsonValue
      : 'v0.9';
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

  for (final String key in entry.keys) {
    if (!_allowedEntryKeys.contains(key)) {
      throw A2uiCatalogError(
        "Unknown property '$key' in '$entryKey' renderer capabilities under "
        "'$metadataKey'.",
      );
    }
  }
  if (entry.containsKey('inlineCatalogs') && entry['inlineCatalogs'] == null) {
    throw A2uiCatalogError(
      "The 'inlineCatalogs' field in '$entryKey' renderer capabilities under "
      "'$metadataKey' must be an array of catalog objects.",
    );
  }

  final List<Object?>? rawInline = entry['inlineCatalogs'] is List<Object?>
      ? entry['inlineCatalogs']! as List<Object?>
      : null;
  final A2uiRendererCapabilities capabilities;
  try {
    capabilities = A2uiRendererCapabilities.fromJson(<String, Object?>{
      entryKey: entry,
    });
  } on A2uiCatalogError catch (e) {
    if (e.catalogId == null && rawInline != null) {
      _rethrowWithInlineCatalogId(rawInline, version);
    }
    rethrow;
  } on A2uiError catch (e) {
    throw A2uiCatalogError(e.message);
  }

  _validateParsedInlineCatalogs(
    capabilities.forVersion(version)?.inlineCatalogs ?? const [],
    rawInline,
    version,
    entryKey,
    metadataKey,
  );
  return capabilities;
}

void _validateParsedInlineCatalogs(
  List<CatalogApi> parsedInline,
  List<Object?>? rawInline,
  A2uiProtocolVersion version,
  String entryKey,
  String metadataKey,
) {
  for (var i = 0; i < parsedInline.length; i++) {
    final CatalogApi catalog = parsedInline[i];
    final A2uiProtocolVersion? declared = catalog.protocolVersion;
    if (declared != null &&
        !isCatalogVersionCompatible(declared.jsonValue, version.jsonValue)) {
      throw A2uiCatalogError(
        "Inline catalog '${catalog.id}' declares protocolVersion "
        "'${declared.jsonValue}', which is incompatible with '$entryKey' "
        "renderer capabilities under '$metadataKey'.",
      );
    }
    final Object? rawDoc = rawInline != null && i < rawInline.length
        ? rawInline[i]
        : null;
    validateInlineCatalogLocalRefs(
      rawDoc is Map ? rawDoc.cast<String, Object?>() : catalog.toJson(),
      catalog.id,
      protocolVersion: declared ?? version,
    );
  }
}

(String, A2uiProtocolVersion)? _rawInlineTarget(
  Object? rawDoc,
  A2uiProtocolVersion fallbackVersion,
) {
  if (rawDoc is! Map) return null;
  final Object? rawId = rawDoc['catalogId'];
  final Object? rawVersion = rawDoc['protocolVersion'];
  if (rawId is! String || rawId.isEmpty) return null;
  if (rawVersion == null) return (rawId, fallbackVersion);
  if (rawVersion is! String) return null;
  final A2uiProtocolVersion? declared = A2uiProtocolVersion.tryParseSemVer(
    rawVersion,
  );
  if (declared == null ||
      !isCatalogVersionCompatible(
        declared.jsonValue,
        fallbackVersion.jsonValue,
      )) {
    return null;
  }
  return (rawId, declared);
}

void _rethrowWithInlineCatalogId(
  List<Object?> rawInline,
  A2uiProtocolVersion version,
) {
  for (final rawDoc in rawInline) {
    final (String id, A2uiProtocolVersion target)? parsed = _rawInlineTarget(
      rawDoc,
      version,
    );
    if (parsed == null) break;
    validateInlineCatalogLocalRefs(
      (rawDoc! as Map).cast<String, Object?>(),
      parsed.$1,
      protocolVersion: parsed.$2,
    );
  }
}
