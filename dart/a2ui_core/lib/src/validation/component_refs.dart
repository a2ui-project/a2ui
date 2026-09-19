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
import '../primitives/reference_schema.dart';

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
///
/// An unmarked `componentId`-and-`path` object is not treated as a child
/// list: validation rejects a whole batch, so it keeps to what the catalog
/// states rather than what a schema resembles.
Map<String, ComponentRefFields> extractComponentRefFields<
  C extends ComponentApi,
  F extends FunctionApi
>(Catalog<C, F> catalog) {
  final Map<String, Object?> document = catalog.catalogSchema;
  final result = <String, ComponentRefFields>{};

  for (final MapEntry<String, C> entry in catalog.components.entries) {
    final RefFields fields = ReferenceSchemaReader(
      entry.value.schema.value,
      document: document,
      structuralChildLists: false,
    ).fields();
    if (fields.isEmpty) continue;
    result[entry.key] = ComponentRefFields(
      single: {
        for (final field in fields.entries)
          if (field.value is SingleRef) field.key,
      },
      list: {
        for (final field in fields.entries)
          if (field.value is! SingleRef) field.key,
      },
      nested: {
        for (final field in fields.entries)
          if (field.value case NestedRef(:final fields))
            field.key: fields.keys.toSet(),
      },
    );
  }
  return result;
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
