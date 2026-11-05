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

/// Reads the Express signatures of a catalog's components and functions from
/// their schemas.
///
/// Express omits property keys, so a positional argument means the property
/// at the same place in the component's schema.
class CatalogSchemaHelper {
  CatalogSchemaHelper(this.catalog);

  final CatalogApi catalog;

  /// Checks a compiled component against its schema in [catalog].
  late final PayloadValidator<ComponentApi, FunctionApi> validator =
      PayloadValidator(catalog: catalog);

  final Map<String, _ComponentSignature> _components = {};

  bool isComponent(String name) => catalog.components.containsKey(name);

  bool isFunction(String name) => catalog.functions.containsKey(name);

  /// The properties a positional argument can fill, in schema order.
  ///
  /// Specific component properties come first, followed by common mixin
  /// properties such as `weight`. Structural properties
  /// (`id`, `component`, `checks`) and `accessibility` are excluded.
  List<String> properties(String component) => _signature(component).properties;

  /// The properties the component requires, beyond `component` and `id`.
  List<String> requiredProperties(String component) =>
      _signature(component).required;

  /// Whether the component accepts a `checks` list.
  bool isCheckable(String component) => _signature(component).isCheckable;

  /// The schema of one of [properties].
  Map<String, Object?>? propertySchema(String component, String property) =>
      _signature(component).schemas[property];

  /// Whether common types were loaded into the catalog validation schema.
  bool get commonTypesLoaded =>
      catalog.validationSchema[r'$defs'] is Map &&
      (catalog.validationSchema[r'$defs'] as Map).isNotEmpty;

  /// Whether [schema] accepts a number literal, resolving `$ref`s against
  /// [catalog]'s validation schema definitions.
  bool acceptsNumber(Map<String, Object?>? schema) {
    final visited = <Object>{};
    final Object? defsObj = catalog.validationSchema[r'$defs'];
    final Map<Object?, Object?>? defs = defsObj is Map ? defsObj : null;

    bool check(Map<String, Object?>? s) {
      if (s == null || !visited.add(s)) return false;
      final Object? type = s['type'];
      if (type == 'number' || type == 'integer') return true;
      if (type is List &&
          (type.contains('number') || type.contains('integer'))) {
        return true;
      }

      if (s['const'] is num) return true;

      final Object? enumVal = s['enum'];
      if (enumVal is List && enumVal.any((v) => v is num)) return true;

      final String? ref = _refName(s);
      if (ref != null) {
        if (defs == null) return true;
        final Object? resolved = defs[ref];
        if (resolved is Map) {
          if (check(resolved.cast<String, Object?>())) return true;
        } else {
          return true;
        }
      }

      for (final Map<String, Object?> alt in _alternatives(s)) {
        if (check(alt)) return true;
      }

      const typeKeys = [
        'type',
        'const',
        'enum',
        r'$ref',
        'allOf',
        'oneOf',
        'anyOf',
        'properties',
        'items',
        'prefixItems',
        'not',
      ];
      if (!typeKeys.any(s.containsKey)) {
        return true;
      }

      return false;
    }

    return check(schema);
  }

  /// The schema the catalog declares for the items of an array, or null if
  /// it declares none.
  ///
  /// Follows `$ref`s into the definitions of [catalog]'s validation schema,
  /// which bundles the common types, and the members of `allOf`, `oneOf` and
  /// `anyOf`, so that a nested slot such as `items: [{label, action}]` is
  /// found whichever way the catalog writes it.
  Map<String, Object?>? resolveItemSchema(Map<String, Object?>? schema) =>
      _resolveAt(schema, null);

  /// The schema the catalog declares for the property [name] of an object,
  /// or `additionalProperties` when it declares no such property, or null.
  ///
  /// Follows `$ref`s and the members of `allOf`, `oneOf` and `anyOf` as
  /// [resolveItemSchema] does. A property named `items` is looked up as a
  /// property, not as the array items.
  Map<String, Object?>? resolvePropertySchema(
    Map<String, Object?>? schema,
    String name,
  ) => _resolveAt(schema, name);

  /// The schema at the property [property], or at the array items when
  /// [property] is null.
  Map<String, Object?>? _resolveAt(
    Map<String, Object?>? schema,
    String? property,
  ) {
    final Object? defsObj = catalog.validationSchema[r'$defs'];
    final Map<Object?, Object?>? defs = defsObj is Map ? defsObj : null;
    // A definition may refer to itself, so each is followed once.
    final visitedRefs = <String>{};

    Map<String, Object?>? resolve(Map<String, Object?>? s) {
      if (s == null) return null;
      if (property == null) {
        if (s['items'] case final Map<Object?, Object?> items) {
          return items.cast<String, Object?>();
        }
      } else {
        if (_properties(s)[property] case final Map<Object?, Object?> found) {
          return found.cast<String, Object?>();
        }
        if (s['additionalProperties'] case final Map<Object?, Object?> more) {
          return more.cast<String, Object?>();
        }
      }
      if (_refName(s) case final String ref when visitedRefs.add(ref)) {
        if (defs?[ref] case final Map<Object?, Object?> target) {
          if (resolve(target.cast<String, Object?>()) case final found?) {
            return found;
          }
        }
      }
      for (final Map<String, Object?> alt in _alternatives(s)) {
        if (resolve(alt) case final found?) return found;
      }
      return null;
    }

    return resolve(schema);
  }

  /// The component's own description, if its schema has one.
  String? componentDescription(String component) {
    final Map<String, Object?> schema = catalog
        .resolvedComponentSchema(component)!
        .value;
    for (final Map<String, Object?> sub in _subschemas(schema)) {
      if (sub['description'] case final String description) return description;
    }
    return null;
  }

  /// The function's parameters, in schema order.
  List<String> parameters(String function) => [
    ..._parameterSchemas(function).keys,
  ];

  /// The parameters the function requires.
  List<String> requiredParameters(String function) => [
    for (final Object? name
        in catalog.functions[function]!.argumentSchema['required']
                as List<Object?>? ??
            const [])
      name! as String,
  ];

  /// The schema of one of [parameters].
  Map<String, Object?>? parameterSchema(String function, String parameter) =>
      _parameterSchemas(function)[parameter];

  Map<String, Map<String, Object?>> _parameterSchemas(String function) {
    final Object? properties =
        catalog.functions[function]!.argumentSchema['properties'];
    if (properties is! Map) return const {};
    return {
      for (final MapEntry<Object?, Object?> entry in properties.entries)
        if (entry.value is Map)
          entry.key! as String: (entry.value! as Map).cast<String, Object?>(),
    };
  }

  _ComponentSignature _signature(String component) =>
      _components.putIfAbsent(component, () {
        final Map<String, Object?> schema = catalog
            .resolvedComponentSchema(component)!
            .value;
        final List<Map<String, Object?>> subschemas = _subschemas(schema);
        final schemas = <String, Map<String, Object?>>{};
        final required = <String>[];
        var isCheckable = false;
        for (final sub in subschemas) {
          _properties(sub).forEach((name, value) {
            if (value is Map) schemas[name] = value.cast<String, Object?>();
          });
          for (final Object? name in sub['required'] as List<Object?>? ?? []) {
            required.add(name! as String);
          }
          if (_refName(sub)?.endsWith('Checkable') ?? false) isCheckable = true;
          if (_properties(sub).containsKey('checks')) isCheckable = true;
        }
        const structural = {'component', 'id', 'checks'};
        schemas.removeWhere((name, _) => structural.contains(name));
        const commonKeys = {'accessibility', 'weight'};
        final List<String> specificProperties = [
          for (final key in schemas.keys)
            if (!commonKeys.contains(key)) key,
        ];
        final List<String> commonProperties = [
          for (final key in const ['weight'])
            if (schemas.containsKey(key)) key,
        ];
        final orderedProperties = [...specificProperties, ...commonProperties];
        return _ComponentSignature(
          properties: orderedProperties,
          required: [
            for (final String name in orderedProperties)
              if (required.contains(name)) name,
          ],
          schemas: schemas,
          isCheckable: isCheckable,
        );
      });
}

class _ComponentSignature {
  final List<String> properties;
  final List<String> required;
  final Map<String, Map<String, Object?>> schemas;
  final bool isCheckable;

  _ComponentSignature({
    required this.properties,
    required this.required,
    required this.schemas,
    required this.isCheckable,
  });
}

/// [schema] and the members of its `allOf`, in order.
List<Map<String, Object?>> _subschemas(Map<String, Object?> schema) => [
  schema,
  for (final Object? sub in schema['allOf'] as List<Object?>? ?? const [])
    if (sub is Map) sub.cast<String, Object?>(),
];

Map<String, Object?> _properties(Map<String, Object?> schema) =>
    switch (schema['properties']) {
      final Map<Object?, Object?> map => map.cast<String, Object?>(),
      _ => const {},
    };

/// The name a `$ref` points at, such as `DynamicString`, or null.
String? _refName(Map<String, Object?> schema) => switch (schema[r'$ref']) {
  final String ref => ref.substring(ref.lastIndexOf('/') + 1),
  _ => null,
};

/// The subschemas of a combinator, flattened one level.
Iterable<Map<String, Object?>> _alternatives(Map<String, Object?> schema) => [
  for (final String key in const ['oneOf', 'anyOf', 'allOf'])
    for (final Object? sub in schema[key] as List<Object?>? ?? const [])
      if (sub is Map) sub.cast<String, Object?>(),
];

/// Whether a property of [schema] accepts a data binding.
///
/// The shared types that do are named for it: `DataBinding`, the `Dynamic*`
/// family and `ChildList`, whose template form carries a path.
bool allowsBinding(Map<String, Object?>? schema) {
  if (schema == null) return false;
  final String? ref = _refName(schema);
  if (ref != null &&
      (ref == 'DataBinding' ||
          ref.startsWith('Dynamic') ||
          ref == 'ChildList')) {
    return true;
  }
  return _alternatives(schema).any(allowsBinding);
}

/// Whether [schema] holds the id of another component.
///
/// v0.9 names the shared type `ComponentId`; v1.0 names a single child
/// `Child`.
bool isComponentId(Map<String, Object?>? schema) =>
    schema != null &&
    switch (_refName(schema)) {
      'ComponentId' || 'Child' => true,
      _ => false,
    };

/// Whether [schema] is a list of children: component ids, or a template that
/// repeats one component over a list in the data model.
bool isChildList(Map<String, Object?>? schema) =>
    schema != null &&
    (_refName(schema) == 'ChildList' || _alternatives(schema).any(isChildList));

/// Whether [schema] is an action: an event for the agent, or a local call.
bool isAction(Map<String, Object?>? schema) =>
    schema != null && _refName(schema) == 'Action';

/// The values an enum property admits, or null.
List<Object?>? enumOf(Map<String, Object?>? schema) {
  if (schema == null) return null;
  if (schema['enum'] case final List<Object?> values) return values;
  for (final Map<String, Object?> sub in _alternatives(schema)) {
    if (enumOf(sub) case final List<Object?> values) return values;
  }
  return null;
}

/// Whether [schema] is a list of `{label, value}` options, which Express lets
/// the model write as plain strings.
bool expectsOptionObjects(Map<String, Object?>? schema) {
  if (schema == null) return false;
  if (schema['items'] case final Map<Object?, Object?> items) {
    bool hasLabelAndValue(Map<String, Object?> sub) {
      final Map<String, Object?> properties = _properties(sub);
      if (properties.containsKey('label') && properties.containsKey('value')) {
        return true;
      }
      return _alternatives(sub).any(hasLabelAndValue);
    }

    return hasLabelAndValue(items.cast<String, Object?>());
  }
  return _alternatives(schema).any(expectsOptionObjects);
}
