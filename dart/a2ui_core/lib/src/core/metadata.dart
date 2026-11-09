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

import 'package:collection/collection.dart';

import '../primitives/errors.dart';
import '../primitives/uax31.dart';

/// Shared deep-equality helper for JSON-compatible values.
const _jsonEquality = DeepCollectionEquality();

/// Metadata envelope attached to a surface, component, catalog component, or
/// dispatched action.
typedef A2uiMetadata = Map<String, Object?>;

/// Per-dispatch options passed to a resolved [NodeAction] closure.
class ActionDispatchOptions {
  /// Optional metadata envelope to attach to the outbound action event.
  final A2uiMetadata? metadata;

  /// Creates an [ActionDispatchOptions] instance.
  const ActionDispatchOptions({this.metadata});
}

/// Resolved action callback signature exposed by `GenericBinder` and
/// `ComponentNode.props`.
typedef NodeAction = Future<void> Function([ActionDispatchOptions? options]);

/// Validates that [metadata] is a JSON object and that any keys inside
/// `metadata['extensions']` conform to Unicode Standard Annex #31 (UAX #31).
///
/// Throws [A2uiValidationError] if [metadata] is not a string-keyed map or if
/// `extensions` is not a string-keyed map with valid UAX #31 identifier keys.
void validateMetadata(Object? metadata) {
  if (metadata == null) return;
  if (metadata is! Map) {
    throw A2uiValidationError('Invalid metadata: expected a JSON object.');
  }
  for (final Object? key in metadata.keys) {
    if (key is! String) {
      throw A2uiValidationError(
        'Invalid metadata: expected string keys, got ${key.runtimeType}.',
      );
    }
    if (key != 'extensions') {
      throw A2uiValidationError(
        "Unexpected property '$key' in metadata; only 'extensions' is allowed.",
      );
    }
  }
  if (!metadata.containsKey('extensions')) return;
  final Object? extensions = metadata['extensions'];
  if (extensions is! Map) {
    throw A2uiValidationError(
      'Invalid metadata.extensions: expected a JSON object.',
    );
  }
  for (final Object? key in extensions.keys) {
    if (key is! String || !isValidUax31Identifier(key)) {
      throw A2uiValidationError(
        "Invalid metadata extension key '$key': must be a valid "
        'UAX #31 identifier.',
      );
    }
  }
}

/// Deep-clones and freezes [metadata] into an unmodifiable map, or returns
/// `null` if [metadata] is `null` or carries no non-empty `extensions`.
A2uiMetadata? cloneMetadata(Object? metadata) {
  if (metadata == null) return null;
  if (metadata is Map) {
    if (metadata.isEmpty) return null;
    if (metadata.length == 1 && metadata.containsKey('extensions')) {
      final Object? ext = metadata['extensions'];
      if (ext == null || (ext is Map && ext.isEmpty)) return null;
    }
  }
  final Object? frozen = _freezeJsonValue(metadata);
  return frozen is Map<String, Object?> ? frozen : null;
}

/// Validates and merges action [payloadMetadata] with call-site
/// [callSiteMetadata], where call-site extension keys take precedence.
A2uiMetadata? mergeActionMetadata(
  Object? payloadMetadata,
  A2uiMetadata? callSiteMetadata,
) {
  validateMetadata(payloadMetadata);
  validateMetadata(callSiteMetadata);
  if (payloadMetadata == null && callSiteMetadata == null) return null;
  if (payloadMetadata == null) return cloneMetadata(callSiteMetadata);
  if (callSiteMetadata == null) return cloneMetadata(payloadMetadata);

  final payloadMap = payloadMetadata as Map;
  final mergedExtensions = <String, Object?>{};
  if (payloadMap['extensions'] is Map) {
    for (final MapEntry<Object?, Object?> entry
        in (payloadMap['extensions'] as Map).entries) {
      mergedExtensions[entry.key.toString()] = entry.value;
    }
  }
  if (callSiteMetadata['extensions'] is Map) {
    for (final MapEntry<Object?, Object?> entry
        in (callSiteMetadata['extensions'] as Map).entries) {
      mergedExtensions[entry.key.toString()] = entry.value;
    }
  }
  final merged = mergedExtensions.isNotEmpty
      ? <String, Object?>{'extensions': mergedExtensions}
      : <String, Object?>{};
  return cloneMetadata(merged);
}

Object? _freezeJsonValue(Object? value) {
  if (value is Map) {
    if (value.keys.every((k) => k is String)) {
      return Map<String, Object?>.unmodifiable({
        for (final MapEntry<Object?, Object?> entry in value.entries)
          entry.key as String: _freezeJsonValue(entry.value),
      });
    }
    return Map<Object?, Object?>.unmodifiable({
      for (final MapEntry<Object?, Object?> entry in value.entries)
        entry.key: _freezeJsonValue(entry.value),
    });
  }
  if (value is List) {
    return List<Object?>.unmodifiable([
      for (final Object? item in value) _freezeJsonValue(item),
    ]);
  }
  return value;
}

/// Returns whether two JSON-compatible values are deeply equal.
bool sameJsonValue(Object? a, Object? b) => _jsonEquality.equals(a, b);

/// Returns whether two metadata maps are deeply equal.
bool sameMetadata(Object? a, Object? b) => _jsonEquality.equals(a, b);
