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

import 'dart:collection';

/// How a component property names its child components.
sealed class RefKind {
  const RefKind();
}

/// A single component id.
final class SingleRef extends RefKind {
  const SingleRef();
}

/// A static id array or scoped `ChildList` template.
final class ListRef extends RefKind {
  const ListRef();
}

/// An array of objects with child-reference properties.
final class NestedRef extends RefKind {
  final Map<String, RefKind> fields;

  /// Whether an alternative item schema also accepts bare component ids.
  final bool includesIds;

  const NestedRef(this.fields, {this.includesIds = false});

  /// Single-reference keys mounted by the node resolver. Nested child lists
  /// remain unresolved descriptors, but graph validation still checks them.
  Set<String> get keys => {
    for (final entry in fields.entries)
      if (entry.value is SingleRef) entry.key,
  };
}

typedef RefFields = Map<String, RefKind>;

/// Reads child-reference semantics without depending on a catalog or renderer.
///
/// Local pointers resolve against the component root first, then the catalog
/// document. Wire pointers and Dart `REF:` descriptions identify the same
/// common types. Local pointer and combinator cycles are bounded by schema-map
/// identity; reading never fetches external documents.
class ReferenceSchemaReader {
  final Map<String, Object?> root;
  final Map<String, Object?> document;

  const ReferenceSchemaReader(this.root, {this.document = const {}});

  /// Flattens local indirection and schema combinators, retaining `$ref`
  /// siblings. The component root remains in scope below nested properties.
  List<Map<String, Object?>> schemas(Object? schema) {
    final result = <Map<String, Object?>>[];
    final visited = HashSet<Object>.identity();
    void collect(Object? value) {
      if (value is! Map || !visited.add(value)) return;
      final Map<String, Object?> node = value is Map<String, Object?>
          ? value
          : value.cast<String, Object?>();
      result.add(node);
      final Object? ref = node[r'$ref'];
      if (ref is String && ref.startsWith('#/')) {
        collect(_follow(root, ref) ?? _follow(document, ref));
      }
      for (final keyword in const ['allOf', 'anyOf', 'oneOf']) {
        final Object? branches = node[keyword];
        if (branches is List) {
          for (final Object? branch in branches) {
            collect(branch);
          }
        }
      }
    }

    collect(schema);
    return result;
  }

  /// Merges properties from every branch without losing markers when a later
  /// branch adds constraints to the same property.
  Map<String, Object?> properties(List<Map<String, Object?>> schemas) {
    final result = <String, Object?>{};
    for (final node in schemas) {
      final Object? properties = node['properties'];
      if (properties is! Map) continue;
      for (final MapEntry<Object?, Object?> entry in properties.entries) {
        final key = entry.key! as String;
        result[key] = result.containsKey(key)
            ? <String, Object?>{
                'allOf': <Object?>[result[key], entry.value],
              }
            : entry.value;
      }
    }
    return result;
  }

  /// Combines item schemas across array branches before recursive inspection.
  Object? items(List<Map<String, Object?>> schemas) {
    final items = <Object?>[
      for (final schema in schemas)
        if (schema['items'] is Map) schema['items'],
    ];
    return switch (items.length) {
      0 => null,
      1 => items.single,
      _ => <String, Object?>{'allOf': items},
    };
  }

  /// Identifies a single id or a complete child list, not arbitrary arrays.
  RefKind? referenceKind(List<Map<String, Object?>> schemas) {
    if (_marks(schemas, r'/$defs/ChildList') ||
        schemas.any(_isChildListShape)) {
      return const ListRef();
    }
    if (_marks(schemas, r'/$defs/ComponentId')) return const SingleRef();
    return null;
  }

  /// Classifies the supported component-reference positions. Self-describing
  /// top-level `id` and `component` properties never create graph edges.
  RefFields fields() {
    final result = <String, RefKind>{};
    for (final MapEntry<String, Object?> entry in properties(
      schemas(root),
    ).entries) {
      if (entry.key == 'id' || entry.key == 'component') continue;
      final List<Map<String, Object?>> candidates = schemas(entry.value);
      final RefKind? direct = referenceKind(candidates);
      if (direct != null) {
        result[entry.key] = direct;
        continue;
      }
      final List<Map<String, Object?>> itemSchemas = schemas(items(candidates));
      final RefKind? itemKind = referenceKind(itemSchemas);
      final nested = <String, RefKind>{};
      for (final MapEntry<String, Object?> property in properties(
        itemSchemas,
      ).entries) {
        final RefKind? kind = referenceKind(schemas(property.value));
        if (kind != null) nested[property.key] = kind;
      }
      if (nested.isNotEmpty) {
        result[entry.key] = NestedRef(
          Map.unmodifiable(nested),
          includesIds: itemKind is SingleRef,
        );
      } else if (itemKind != null) {
        result[entry.key] = const ListRef();
      }
    }
    return Map.unmodifiable(result);
  }
}

bool _marks(List<Map<String, Object?>> schemas, String pointer) {
  for (final schema in schemas) {
    final Object? ref = schema[r'$ref'];
    if (ref is String && ref.endsWith(pointer)) return true;
    final Object? description = schema['description'];
    if (description is String && description.startsWith('REF:')) {
      final String target = description.substring(4).split('|').first;
      if (target.endsWith(pointer)) return true;
    }
  }
  return false;
}

bool _isChildListShape(Map<String, Object?> schema) {
  final Object? properties = schema['properties'];
  return properties is Map &&
      properties['componentId'] != null &&
      properties['path'] != null;
}

Object? _follow(Map<String, Object?> root, String pointer) {
  Object? current = root;
  for (final String raw in pointer.substring(2).split('/')) {
    final String key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current is! Map || !current.containsKey(key)) return null;
    current = current[key];
  }
  return current;
}
