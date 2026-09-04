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

import '../core/catalog.dart';

/// The JSON Pointer suffix marking a property that holds one component id.
const String _componentIdPointer = r'/$defs/ComponentId';

/// The JSON Pointer suffix marking a property that holds a `ChildList`.
const String _childListPointer = r'/$defs/ChildList';

/// Which properties of one component type reference other components.
///
/// Derived from the component's JSON schema, so a catalog declares its own
/// topology rather than the validator hard-coding property names.
class ComponentRefFields {
  /// Properties holding a single component id.
  final Set<String> single;

  /// Properties holding a `ChildList`: an id array or a template object.
  final Set<String> list;

  /// Properties holding an array of objects whose named keys are ids, such as
  /// a tab strip's `items[].child`. Keyed by property name.
  final Map<String, Set<String>> nested;

  const ComponentRefFields({
    this.single = const {},
    this.list = const {},
    this.nested = const {},
  });
}

/// Properties that name the component itself rather than another one.
///
/// `ComponentCommon` declares `id` as a `ComponentId`, so a catalog that
/// inlines it would otherwise read every component's own id as a reference to
/// itself. `component` names the type, never a child.
const Set<String> _selfDescribingProperties = {'id', 'component'};

/// One reference from a component to another component.
class ComponentReference {
  /// The referenced component id.
  final String id;

  /// Where the reference sits, for example `children[2]` or `items[0].child`.
  final String field;

  const ComponentReference(this.id, this.field);
}

/// Derives the child-referencing properties of every component in [catalog].
///
/// Detection reads the schema, in two equivalent notations: a `$ref` whose
/// pointer ends in `ComponentId` or `ChildList`, as published catalog
/// documents write it, and the `REF:` description pointer that catalogs built
/// in Dart carry (see `CommonSchemas`). Local `$ref`s are followed first
/// against the component's own `$defs`, then against the catalog document.
Map<String, ComponentRefFields> extractComponentRefFields<
  C extends ComponentApi,
  F extends FunctionApi
>(Catalog<C, F> catalog) {
  final Map<String, Object?> document = catalog.catalogSchema;
  final result = <String, ComponentRefFields>{};

  for (final MapEntry<String, C> entry in catalog.components.entries) {
    final Object schema = entry.value.schema.value;
    final single = <String>{};
    final list = <String>{};
    final nested = <String, Set<String>>{};
    _collectFrom(schema, document, single, list, nested);
    if (single.isNotEmpty || list.isNotEmpty) {
      result[entry.key] = ComponentRefFields(
        single: single,
        list: list,
        nested: nested,
      );
    }
  }
  return result;
}

/// Walks one component schema, including its `allOf`/`oneOf`/`anyOf` branches,
/// recording every property that references components.
void _collectFrom(
  Object? schema,
  Map<String, Object?> document,
  Set<String> single,
  Set<String> list,
  Map<String, Set<String>> nested,
) {
  if (schema is! Map) return;
  final Map<String, Object?> node = schema.cast<String, Object?>();

  final Object? properties = node['properties'];
  if (properties is Map) {
    for (final MapEntry<Object?, Object?> property in properties.entries) {
      final name = property.key! as String;
      if (_selfDescribingProperties.contains(name)) continue;
      final Object? resolved = _resolve(property.value, node, document);
      if (_marks(resolved, _componentIdPointer, node, document)) {
        single.add(name);
        continue;
      }
      if (_marks(resolved, _childListPointer, node, document)) {
        list.add(name);
        continue;
      }
      _collectArrayProperty(name, resolved, node, document, list, nested);
    }
  }

  for (final combinator in const ['allOf', 'oneOf', 'anyOf']) {
    final Object? branches = node[combinator];
    if (branches is! List) continue;
    for (final Object? branch in branches) {
      _collectFrom(
        _resolve(branch, node, document),
        document,
        single,
        list,
        nested,
      );
    }
  }
}

/// Classifies an array property: an array of ids, or an array of objects with
/// id-bearing keys.
void _collectArrayProperty(
  String name,
  Object? resolved,
  Map<String, Object?> owner,
  Map<String, Object?> document,
  Set<String> list,
  Map<String, Set<String>> nested,
) {
  if (resolved is! Map) return;
  final Map<String, Object?> node = resolved.cast<String, Object?>();
  if (node['type'] != 'array' || !node.containsKey('items')) return;

  final Object? items = _resolve(node['items'], owner, document);
  if (_marks(items, _componentIdPointer, owner, document) ||
      _marks(items, _childListPointer, owner, document)) {
    list.add(name);
    return;
  }
  if (items is! Map) return;
  final Object? itemProperties = items['properties'];
  if (itemProperties is! Map) return;

  final keys = <String>{};
  for (final MapEntry<Object?, Object?> property in itemProperties.entries) {
    final Object? sub = _resolve(property.value, owner, document);
    if (_marks(sub, _componentIdPointer, owner, document) ||
        _marks(sub, _childListPointer, owner, document)) {
      keys.add(property.key! as String);
    }
  }
  if (keys.isNotEmpty) {
    list.add(name);
    nested.putIfAbsent(name, () => <String>{}).addAll(keys);
  }
}

/// Whether [schema] carries [pointer], directly or in a combinator branch.
bool _marks(
  Object? schema,
  String pointer,
  Map<String, Object?> owner,
  Map<String, Object?> document,
) {
  if (schema is! Map) return false;
  final Map<String, Object?> node = schema.cast<String, Object?>();

  final Object? ref = node[r'$ref'];
  if (ref is String && ref.endsWith(pointer)) return true;

  // Catalogs built in Dart carry the pointer in the description, as
  // `REF:<pointer>` optionally followed by `|<description>`.
  final Object? description = node['description'];
  if (description is String && description.startsWith('REF:')) {
    final String target = description.substring(4).split('|').first;
    if (target.endsWith(pointer)) return true;
  }

  for (final combinator in const ['oneOf', 'anyOf', 'allOf']) {
    final Object? branches = node[combinator];
    if (branches is! List) continue;
    for (final Object? branch in branches) {
      if (_marks(_resolve(branch, owner, document), pointer, owner, document)) {
        return true;
      }
    }
  }
  return false;
}

/// Follows a local `$ref` so detection sees the schema it names.
///
/// Pointers into `ComponentId` and `ChildList` are left alone: they are the
/// markers being looked for, not indirection to follow.
Object? _resolve(
  Object? schema,
  Map<String, Object?> owner,
  Map<String, Object?> document, [
  Set<String>? seen,
]) {
  if (schema is! Map) return schema;
  final Object? ref = schema[r'$ref'];
  if (ref is! String ||
      !ref.startsWith('#/') ||
      ref.endsWith(_componentIdPointer) ||
      ref.endsWith(_childListPointer)) {
    return schema;
  }

  final Set<String> visited = seen ?? <String>{};
  if (!visited.add(ref)) return schema;

  final List<String> segments = ref.split('/').skip(1).toList();
  final Object? local = _follow(owner, segments);
  if (local != null) return _resolve(local, owner, document, visited);
  final Object? global = _follow(document, segments);
  if (global != null) return _resolve(global, owner, document, visited);
  return schema;
}

/// Walks [segments] through [root], returning null if any step is missing.
Object? _follow(Map<String, Object?> root, List<String> segments) {
  Object? current = root;
  for (final segment in segments) {
    if (current is! Map) return null;
    if (!current.containsKey(segment)) return null;
    current = current[segment];
  }
  return identical(current, root) ? null : current;
}

/// Lists every component [component] references, in declaration order.
///
/// [fields] describes the component type; a type with no reference properties
/// yields nothing.
Iterable<ComponentReference> componentReferences(
  Map<String, Object?> component,
  ComponentRefFields? fields,
) sync* {
  if (fields == null) return;
  for (final MapEntry<String, Object?> entry in component.entries) {
    if (!fields.single.contains(entry.key) &&
        !fields.list.contains(entry.key)) {
      continue;
    }
    yield* _pointers(entry.value, entry.key, fields);
  }
}

Iterable<ComponentReference> _pointers(
  Object? value,
  String path,
  ComponentRefFields fields,
) sync* {
  if (value is String) {
    yield ComponentReference(value, path);
    return;
  }

  if (value is List) {
    for (var index = 0; index < value.length; index++) {
      final Object? item = value[index];
      final itemPath = item is String && !path.contains('[')
          ? path
          : '$path[$index]';
      yield* _pointers(item, itemPath, fields);
    }
    return;
  }

  if (value is Map) {
    final Map<String, Object?> node = value.cast<String, Object?>();
    // A `ChildList` template names its component through `componentId`.
    final Object? templateId = node['componentId'];
    if (templateId != null) {
      if (templateId is String) {
        yield ComponentReference(templateId, '$path.componentId');
      }
      return;
    }
    final String property = path.split('[').first.split('.').first;
    final Set<String>? allowed = fields.nested[property];
    if (allowed != null && !path.contains('.')) {
      for (final MapEntry<String, Object?> entry in node.entries) {
        if (allowed.contains(entry.key)) {
          yield* _pointers(entry.value, '$path.${entry.key}', fields);
        }
      }
      return;
    }
    for (final MapEntry<String, Object?> entry in node.entries) {
      yield* _pointers(entry.value, '$path.${entry.key}', fields);
    }
  }
}
