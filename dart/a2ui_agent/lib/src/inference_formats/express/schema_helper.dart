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

  final SchemaCatalog catalog;

  /// Checks a compiled component against its schema in [catalog].
  late final PayloadValidator<ComponentApi, FunctionApi> validator =
      PayloadValidator(
        catalog: catalog,
        protocolVersion: A2uiProtocolVersion.v0_9,
      );

  final Map<String, _ComponentSignature> _components = {};

  bool isComponent(String name) => catalog.components.containsKey(name);

  bool isFunction(String name) => catalog.functions.containsKey(name);

  /// The properties a positional argument can fill, in schema order.
  ///
  /// Only the properties the component declares itself count. Properties it
  /// shares with every component, such as `id`, `accessibility` and `weight`,
  /// are left out, so that the first argument is the component's own first
  /// property.
  List<String> properties(String component) => _signature(component).properties;

  /// The properties the component requires, beyond `component` and `id`.
  List<String> requiredProperties(String component) =>
      _signature(component).required;

  /// Whether the component accepts a `checks` list.
  bool isCheckable(String component) => _signature(component).isCheckable;

  /// The schema of one of [properties].
  Map<String, Object?>? propertySchema(String component, String property) =>
      _signature(component).schemas[property];

  /// The component's own description, if its schema has one.
  String? componentDescription(String component) {
    final Map<String, Object?> schema =
        catalog.components[component]!.schema.value;
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
        final Map<String, Object?> schema =
            catalog.components[component]!.schema.value;
        final List<Map<String, Object?>> subschemas = _subschemas(schema);
        // The subschema declaring `component` is the component's own. The
        // others are shared definitions, which the catalog parser has inlined.
        final List<Map<String, Object?>> own = [
          for (final Map<String, Object?> sub in subschemas)
            if (_properties(sub).containsKey('component')) sub,
        ];
        final schemas = <String, Map<String, Object?>>{};
        final required = <String>[];
        var isCheckable = false;
        for (final sub in own.isEmpty ? subschemas : own) {
          _properties(sub).forEach((name, value) {
            if (value is Map) schemas[name] = value.cast<String, Object?>();
          });
          for (final Object? name in sub['required'] as List<Object?>? ?? []) {
            required.add(name! as String);
          }
        }
        for (final sub in subschemas) {
          if (_refName(sub)?.endsWith('Checkable') ?? false) isCheckable = true;
          if (_properties(sub).containsKey('checks')) isCheckable = true;
        }
        const structural = {'component', 'id', 'checks'};
        schemas.removeWhere((name, _) => structural.contains(name));
        return _ComponentSignature(
          properties: [...schemas.keys],
          required: [
            for (final String name in required)
              if (!structural.contains(name)) name,
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
bool isComponentId(Map<String, Object?>? schema) =>
    schema != null && _refName(schema) == 'ComponentId';

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
