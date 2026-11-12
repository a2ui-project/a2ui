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

  /// The system functions the catalog's protocol version defines, such as
  /// `@index` from v1.0, keyed by name. See [systemFunctionSchemas].
  late final Map<String, Map<String, Object?>> systemFunctions =
      systemFunctionSchemas(
        PayloadValidator.commonTypesFor(
          catalog.protocolVersion ?? A2uiProtocolVersion.v0_9,
        ),
      );

  /// Whether [name] is a system function of the catalog's protocol version.
  bool isSystemFunction(String name) => systemFunctions.containsKey(name);

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

  /// The description of a catalog or system function, if it has one.
  String? functionDescription(String function) {
    if (catalog.functions[function] case final FunctionApi api) {
      return api.description;
    }
    return switch (systemFunctions[function]?['description']) {
      final String description => description,
      _ => null,
    };
  }

  /// The `args` schema of a catalog or system function.
  Map<String, Object?> _argumentSchema(String function) {
    if (catalog.functions[function] case final FunctionApi api) {
      return api.argumentSchema.value;
    }
    return switch (_properties(systemFunctions[function]!)['args']) {
      final Map<Object?, Object?> args => args.cast<String, Object?>(),
      _ => const {},
    };
  }

  /// The function's parameters, in schema order.
  List<String> parameters(String function) => [
    ..._parameterSchemas(function).keys,
  ];

  /// The parameters the function requires.
  List<String> requiredParameters(String function) => [
    for (final Object? name
        in _argumentSchema(function)['required'] as List<Object?>? ?? const [])
      name! as String,
  ];

  /// The schema of one of [parameters].
  Map<String, Object?>? parameterSchema(String function, String parameter) =>
      _parameterSchemas(function)[parameter];

  Map<String, Map<String, Object?>> _parameterSchemas(String function) {
    final Object? properties = _argumentSchema(function)['properties'];
    if (properties is! Map) return const {};
    return {
      for (final MapEntry<Object?, Object?> entry in properties.entries)
        if (entry.value is Map)
          entry.key! as String: (entry.value! as Map).cast<String, Object?>(),
    };
  }

  _ComponentSignature _signature(String component) => _components.putIfAbsent(
    component,
    () {
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
        if (_properties(sub).containsKey('@checks') ||
            _isStandardChecksSchema(_properties(sub)['checks'])) {
          isCheckable = true;
        }
      }
      final bool v1 =
          catalog.protocolVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;
      const structural = {
        'component',
        'id',
        '@catalogId',
        '@metadata',
        '@accessibility',
        '@checks',
      };
      schemas.removeWhere(
        (name, propSchema) =>
            structural.contains(name) ||
            (name == 'checks' &&
                (isCheckable || !v1) &&
                _isStandardChecksSchema(propSchema)) ||
            (name == 'accessibility' &&
                (!v1 || _isStandardAccessibilitySchema(propSchema))) ||
            (name == 'metadata' && v1 && _isStandardMetadataSchema(propSchema)),
      );
      final List<String> specificProperties = [
        for (final key in schemas.keys)
          if (key != 'weight') key,
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
    },
  );
}

bool _isStandardChecksSchema(Object? propSchema) {
  if (propSchema is! Map) return false;
  final Object? ref = propSchema[r'$ref'] ?? propSchema['commonTypesRef'];
  if (ref is String &&
      (ref.endsWith('/Checkable') ||
          ref.endsWith('/Checkable/properties/checks') ||
          ref.endsWith('/CheckRule'))) {
    return true;
  }
  if (propSchema['type'] != 'array') return false;
  final Object? items = propSchema['items'];
  if (items == null) return true;
  if (items is! Map) return false;
  final Object? itemRef = items[r'$ref'] ?? items['commonTypesRef'];
  if (itemRef is String && itemRef.endsWith('/CheckRule')) return true;
  final Map<String, Object?> itemProps = _properties(
    items.cast<String, Object?>(),
  );
  if (itemProps.containsKey('condition') && itemProps.containsKey('message')) {
    return true;
  }
  return items['type'] == 'object' && !items.containsKey('properties');
}

bool _isStandardAccessibilitySchema(Map<String, Object?> propSchema) {
  final Object? ref = propSchema[r'$ref'] ?? propSchema['commonTypesRef'];
  if (ref is String && ref.endsWith('/AccessibilityAttributes')) return true;
  final Map<String, Object?> props = _properties(propSchema);
  return props.containsKey('label') &&
      props.containsKey('description') &&
      propSchema['additionalProperties'] == false;
}

bool _isStandardMetadataSchema(Map<String, Object?> propSchema) {
  final Object? ref = propSchema[r'$ref'] ?? propSchema['commonTypesRef'];
  if (ref is String && ref.endsWith('/ComponentCommonMetadata')) return true;
  final Map<String, Object?> props = _properties(propSchema);
  return props.length == 1 &&
      props.containsKey('extensions') &&
      propSchema['additionalProperties'] == false;
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

/// The system functions that a common types schema defines, keyed by name.
///
/// A system function is defined by the protocol rather than by a catalog: it
/// is a common types `$defs` entry whose `@call` property is a constant name
/// starting with `@`, such as `@index` from v1.0. It has the same shape as a
/// catalog function, so the same code reads its arguments. A version that
/// defines none, such as v0.9, gives an empty map.
Map<String, Map<String, Object?>> systemFunctionSchemas(
  Map<String, Object?> commonTypes,
) => {
  if (commonTypes[r'$defs'] case final Map<Object?, Object?> defs)
    for (final Object? schema in defs.values)
      if (schema is Map)
        if (_properties(schema.cast<String, Object?>())['@call'] case {
          'const': final String name,
        } when name.startsWith('@'))
          name: schema.cast<String, Object?>(),
};

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

Map<String, Object?>? _asStringMap(Object? raw) => switch (raw) {
  final Map<String, Object?> map => map,
  final Map<Object?, Object?> map => map.cast<String, Object?>(),
  _ => null,
};

/// The subschemas of a combinator, flattened one level.
Iterable<Map<String, Object?>> _alternatives(Map<String, Object?> schema) => [
  for (final String key in const ['oneOf', 'anyOf', 'allOf'])
    for (final Object? sub in schema[key] as List<Object?>? ?? const [])
      if (_asStringMap(sub) case final Map<String, Object?> map) map,
];

bool _isFlattenedDataBinding(Map<String, Object?> schema) {
  final Object? type = schema['type'];
  if (type != null && type != 'object') return false;
  final Map<String, Object?> props = _properties(schema);
  return (props.containsKey('@path') || props.containsKey('path')) &&
      !props.containsKey('componentId');
}

/// Whether a property of [schema] accepts a data binding.
///
/// The shared types that do are named for it: `DataBinding`, the `Dynamic*`
/// family and `ChildList`, whose template form carries a path. Locally
/// flattened `DataBinding` object schemas with `@path` or `path` are also
/// recognized.
bool allowsBinding(Map<String, Object?>? schema, [Set<Object>? visited]) {
  if (schema == null) return false;
  final Set<Object> seen = visited ?? Set<Object>.identity();
  if (!seen.add(schema)) return false;
  try {
    final String? ref = _refName(schema);
    if (ref != null &&
        (ref == 'DataBinding' ||
            ref.startsWith('Dynamic') ||
            ref == 'ChildList')) {
      return true;
    }
    if (_isFlattenedDataBinding(schema)) return true;
    return _alternatives(schema).any((sub) => allowsBinding(sub, seen));
  } finally {
    seen.remove(schema);
  }
}

/// Whether [schema] holds the id of another component.
///
/// v0.9 names the shared type `ComponentId`; v1.0 names a single child
/// `Child`.
bool isComponentId(Map<String, Object?>? schema, [Set<Object>? visited]) {
  if (schema == null) return false;
  final Set<Object> seen = visited ?? Set<Object>.identity();
  if (!seen.add(schema)) return false;
  try {
    return switch (_refName(schema)) {
      'ComponentId' || 'Child' => true,
      _ => _alternatives(schema).any((sub) => isComponentId(sub, seen)),
    };
  } finally {
    seen.remove(schema);
  }
}

/// Whether [schema] is a list of children: component ids, or a template that
/// repeats one component over a list in the data model.
bool isChildList(Map<String, Object?>? schema, [Set<Object>? visited]) {
  if (schema == null) return false;
  final Set<Object> seen = visited ?? Set<Object>.identity();
  if (!seen.add(schema)) return false;
  try {
    return _refName(schema) == 'ChildList' ||
        _alternatives(schema).any((sub) => isChildList(sub, seen));
  } finally {
    seen.remove(schema);
  }
}

/// Whether [schema] is an action: an event for the agent, or a local call.
bool isAction(Map<String, Object?>? schema, [Set<Object>? visited]) {
  if (schema == null) return false;
  final Set<Object> seen = visited ?? Set<Object>.identity();
  if (!seen.add(schema)) return false;
  try {
    return _refName(schema) == 'Action' ||
        _alternatives(schema).any((sub) => isAction(sub, seen));
  } finally {
    seen.remove(schema);
  }
}

/// The values an enum property admits, or null.
List<Object?>? enumOf(Map<String, Object?>? schema, [Set<Object>? visited]) {
  if (schema == null) return null;
  final Set<Object> seen = visited ?? Set<Object>.identity();
  if (!seen.add(schema)) return null;
  try {
    if (schema['enum'] case final List<Object?> values) return values;
    for (final Map<String, Object?> sub in _alternatives(schema)) {
      if (enumOf(sub, seen) case final List<Object?> values) return values;
    }
    return null;
  } finally {
    seen.remove(schema);
  }
}

bool _hasLabelAndValue(Map<String, Object?> sub, [Set<Object>? visited]) {
  final Set<Object> seen = visited ?? Set<Object>.identity();
  if (!seen.add(sub)) return false;
  try {
    final Map<String, Object?> properties = _properties(sub);
    if (properties.containsKey('label') && properties.containsKey('value')) {
      return true;
    }
    return _alternatives(sub).any((alt) => _hasLabelAndValue(alt, seen));
  } finally {
    seen.remove(sub);
  }
}

/// Whether [schema] is a list of `{label, value}` options, which Express lets
/// the model write as plain strings.
bool expectsOptionObjects(
  Map<String, Object?>? schema, [
  Set<Object>? visited,
]) {
  if (schema == null) return false;
  final Set<Object> seen = visited ?? Set<Object>.identity();
  if (!seen.add(schema)) return false;
  try {
    if (_asStringMap(schema['items']) case final Map<String, Object?> items) {
      return _hasLabelAndValue(items, seen);
    }
    return _alternatives(schema).any((sub) => expectsOptionObjects(sub, seen));
  } finally {
    seen.remove(schema);
  }
}
