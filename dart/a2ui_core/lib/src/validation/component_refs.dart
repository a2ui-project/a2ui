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

  /// Where the reference sits, for example `child`, `children[2]`,
  /// `children.componentId` or `items[0].child`.
  final String field;

  const ComponentReference(this.id, this.field);
}

/// Derives the child-referencing properties of every component in [catalog].
///
/// Reads [Catalog.refMap], so graph validation checks the same properties
/// the node resolver mounts: `ComponentId`, `Child` and `ChildList` markers
/// (as a `$ref`, `commonTypesRef` metadata, or a Dart `REF:` description),
/// nested item references, and the unmarked `child`/`children` name fallbacks.
/// The result is cached per reference map.
///
/// A list recognized only by an unmarked `componentId`-and-path object shape
/// ([ListRef.inferred]) is left out: the resolver mounts it, but validation
/// does not reject a batch over a schema that only resembles a template.
Map<String, ComponentRefFields>
    extractComponentRefFields<C extends ComponentApi, F extends FunctionApi>(
  Catalog<C, F> catalog,
) {
  final ComponentRefMap refMap = catalog.refMap;
  return _validationFields[refMap] ??= _validationFieldsOf(refMap);
}

final Expando<Map<String, ComponentRefFields>> _validationFields = Expando();

Map<String, ComponentRefFields> _validationFieldsOf(ComponentRefMap refMap) {
  final result = <String, ComponentRefFields>{};
  for (final MapEntry<String, RefFields> entry in refMap.byType.entries) {
    final RefFields fields = {
      for (final MapEntry<String, RefKind> field in entry.value.entries)
        if (_checked(field.value)) field.key: field.value,
    };
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
        // Every item property that references components, including child
        // lists, not only the single references in NestedRef.keys.
        for (final field in fields.entries)
          if (field.value case NestedRef(fields: final itemFields))
            field.key: {
              for (final item in itemFields.entries)
                if (_checked(item.value)) item.key,
            },
      },
    );
  }
  return Map.unmodifiable(result);
}

/// Whether graph validation checks a property of [kind].
bool _checked(RefKind kind) => switch (kind) {
      ListRef(:final inferred) => !inferred,
      NestedRef(:final fields) => fields.values.any(_checked),
      SingleRef() => true,
    };

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
      yield* _pointers(value[index], '$path[$index]', fields);
    }
    return;
  }

  if (value is Map) {
    final Map<String, Object?> node = value.cast<String, Object?>();
    // A `ChildList` template names its component through `componentId` and
    // its data through `path`. An object with only one of them is a literal,
    // not a template, and references nothing.
    if (node['componentId'] case final String templateId
        when node['path'] is String) {
      yield ComponentReference(templateId, '$path.componentId');
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
    }
  }
}
