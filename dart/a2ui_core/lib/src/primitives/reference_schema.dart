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

/// A single component id, declared as `ComponentId` or v1.0 `Child`.
final class SingleRef extends RefKind {
  const SingleRef();
}

/// A static id array or scoped `ChildList` template.
final class ListRef extends RefKind {
  /// Whether the list was recognized only by an unmarked object schema with
  /// `componentId` and `path` properties, rather than by a `ChildList`
  /// marker or an array of ids.
  ///
  /// The resolver mounts such a list. Graph validation skips it, because a
  /// schema that only resembles a template is not enough reason to reject a
  /// whole batch.
  final bool inferred;

  const ListRef({this.inferred = false});
}

/// An array of objects with child-reference properties.
final class NestedRef extends RefKind {
  /// The item properties that reference components, by name.
  final Map<String, RefKind> fields;

  /// Whether an alternative item schema also accepts bare component ids.
  final bool includesIds;

  const NestedRef(this.fields, {this.includesIds = false});

  /// The item properties holding a single reference.
  Set<String> get keys => {
        for (final entry in fields.entries)
          if (entry.value is SingleRef) entry.key,
      };
}

/// The child-reference properties of one component type, by property name.
typedef RefFields = Map<String, RefKind>;

/// The child-reference properties of every component type in a catalog.
///
/// Graph validation and node resolution both read this map, so the
/// properties a batch is checked against are the properties the resolver
/// mounts. Each component schema is classified once, against the catalog
/// document that contains it; see [ReferenceSchemaReader.fields].
final class ComponentRefMap {
  final Map<String, RefFields> _byType;

  /// Classifies every schema in [componentSchemas], keyed by component type.
  ///
  /// Local pointers that a component schema does not define resolve against
  /// [document].
  ComponentRefMap(
    Map<String, Map<String, Object?>> componentSchemas, {
    Map<String, Object?> document = const {},
  }) : _byType = Map.unmodifiable({
          for (final MapEntry<String, Map<String, Object?>> entry
              in componentSchemas.entries)
            entry.key:
                ReferenceSchemaReader(entry.value, document: document).fields(),
        });

  /// The reference properties of each component type, by type name.
  Map<String, RefFields> get byType => _byType;

  /// The reference properties of [type], empty for a type that references no
  /// components or is not in the catalog.
  RefFields fieldsFor(String type) => _byType[type] ?? const {};
}

/// Reads common-type references and schema structure without a renderer.
///
/// Local pointers resolve against the component root first, then the catalog
/// document. Wire pointers and Dart `REF:` descriptions identify the same
/// common types. Local pointer and combinator cycles are bounded by schema-map
/// identity; reading never fetches external documents.
class ReferenceSchemaReader {
  final Map<String, Object?> root;
  final Map<String, Object?> document;

  /// Whether an unmarked object schema carrying `componentId` and `path`
  /// counts as a child list.
  final bool structuralChildLists;

  const ReferenceSchemaReader(
    this.root, {
    this.document = const {},
    this.structuralChildLists = true,
  });

  /// Flattens local indirection and schema combinators, retaining `$ref`
  /// siblings. The component root remains in scope below nested properties.
  List<Map<String, Object?>> schemas(Object? schema) {
    final result = <Map<String, Object?>>[];
    final visited = HashSet<Object>.identity();
    void collect(Object? value) {
      if (value is! Map || !visited.add(value)) return;
      final Map<String, Object?> node =
          value is Map<String, Object?> ? value : value.cast<String, Object?>();
      result.add(node);
      final Object? ref = node[r'$ref'];
      if (ref is String && (ref == '#' || ref.startsWith('#/'))) {
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

  /// Whether a schema references the named shared type, directly or by marker.
  bool referencesType(List<Map<String, Object?>> schemas, String name) =>
      _marks(schemas, '/\$defs/$name');

  /// Identifies a single id or a complete child list, not arbitrary arrays.
  ///
  /// `Child` is v1.0's name for a single child reference; its pointer suffix
  /// does not match `ChildList`, so the two cannot be confused.
  RefKind? referenceKind(List<Map<String, Object?>> schemas) {
    if (_marks(schemas, r'/$defs/ChildList')) return const ListRef();
    if (structuralChildLists && schemas.any(_isChildListShape)) {
      return const ListRef(inferred: true);
    }
    if (_marks(schemas, r'/$defs/ComponentId') ||
        _marks(schemas, r'/$defs/Child')) {
      return const SingleRef();
    }
    return null;
  }

  /// Classifies the supported component-reference positions. Self-describing
  /// top-level `id` and `component` properties are never references.
  ///
  /// Besides `ComponentId`, `Child` and `ChildList` markers, nested object
  /// and array items, and structural templates, an unmarked string `child`
  /// counts as a single reference and an unmarked string-array `children` as
  /// a list, for ad-hoc schemas that carry no marker.
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
        result[entry.key] = ListRef(
          inferred: itemKind is ListRef && itemKind.inferred,
        );
      }
    }
    _addNamedFallbacks(result);
    return Map.unmodifiable(result);
  }

  /// Adds an unmarked string `child` as a single reference and an unmarked
  /// string-array `children` as a list, unless [fields] already classifies
  /// them.
  void _addNamedFallbacks(Map<String, RefKind> fields) {
    for (final Map<String, Object?> node in schemas(root)) {
      final Object? properties = node['properties'];
      if (properties is! Map) continue;
      final Map<String, Object?>? child = _target(properties['child']);
      if (!fields.containsKey('child') && child?['type'] == 'string') {
        fields['child'] = const SingleRef();
      }
      final Map<String, Object?>? children = _target(properties['children']);
      if (!fields.containsKey('children') &&
          children?['type'] == 'array' &&
          _target(children?['items'])?['type'] == 'string') {
        fields['children'] = const ListRef();
      }
    }
  }

  /// Follows local `$ref`s from [schema] without entering combinator branches.
  Map<String, Object?>? _target(Object? schema) {
    final visited = HashSet<Object>.identity();
    var current = schema;
    while (current is Map && visited.add(current)) {
      final Object? ref = current[r'$ref'];
      if (ref is! String) return current.cast<String, Object?>();
      final List<Map<String, Object?>> reached = schemas({r'$ref': ref});
      if (reached.length < 2) return current.cast<String, Object?>();
      current = reached[1];
    }
    return null;
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

/// Recognizes a child-list template by its shape, for catalogs that declare
/// one without a `$ref` or `REF:` marker. The test is deliberately
/// structural, so it also matches any unrelated object schema that declares
/// both property names.
bool _isChildListShape(Map<String, Object?> schema) {
  final Object? properties = schema['properties'];
  return properties is Map &&
      properties['componentId'] != null &&
      properties['path'] != null;
}

Object? _follow(Map<String, Object?> root, String pointer) {
  if (pointer == '#') return root;
  if (!pointer.startsWith('#/')) return null;
  Object? current = root;
  for (final String raw in pointer.substring(2).split('/')) {
    final String key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current is Map) {
      if (!current.containsKey(key)) return null;
      current = current[key];
    } else if (current is List) {
      final int? index = int.tryParse(key);
      if (index == null ||
          index < 0 ||
          index >= current.length ||
          index.toString() != key) {
        return null;
      }
      current = current[index];
    } else {
      return null;
    }
  }
  return current;
}
