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

  /// Canonical JSON-Schema-free catalog model backing Express queries.
  CatalogModel get model => catalog.model;

  /// Checks a compiled component against its schema in [catalog].
  late final PayloadValidator<ComponentApi, FunctionApi> validator =
      PayloadValidator(catalog: catalog);

  final Map<String, _ComponentSignature> _components = {};

  bool isComponent(String name) => catalog.components.containsKey(name);

  bool isFunction(String name) => catalog.functions.containsKey(name);

  /// Whether [component] was defined directly via a canonical
  /// [ComponentDefinition] without any raw JSON Schema fallback.
  bool isCanonicalComponent(String component) {
    final ComponentApi? api = catalog.components[component];
    return api != null &&
        api.hasCanonicalDefinition &&
        !api.definition.containsRawJsonSchema;
  }

  /// The canonical [ComponentDefinition] for [name], or `null`.
  ComponentDefinition? componentDefinition(String name) {
    final ComponentApi? api = catalog.components[name];
    if (api != null && api.hasCanonicalDefinition) return api.definition;
    return model.component(name);
  }

  /// The canonical [FunctionDefinition] for [name], or `null`.
  FunctionDefinition? functionDefinition(String name) {
    final FunctionApi? api = catalog.functions[name];
    if (api != null && api.hasCanonicalDefinition) {
      return api.functionDefinition;
    }
    return model.function(name);
  }

  /// The canonical [ParameterDefinition] for [property] of [component], or
  /// `null`.
  ParameterDefinition? parameterDefinition(String component, String property) =>
      componentDefinition(component)?.parameter(property);

  /// Resolves a [RefType] chain against [catalog]'s local `types`.
  TypeDefinition resolveType(TypeDefinition type) {
    final Map<String, TypeDefinition> types = catalog.types;
    var current = type;
    final visited = <String>{};
    while (current is RefType &&
        visited.add(current.ref) &&
        types.containsKey(current.ref)) {
      current = types[current.ref]!;
    }
    return current;
  }

  /// Whether [type] represents a child component ID reference.
  bool isTypeComponentId(TypeDefinition type) =>
      _isTypeComponentId(type, Set<Object>.identity());

  bool _isTypeComponentId(TypeDefinition type, Set<Object> visited) {
    final TypeDefinition resolved = resolveType(type);
    if (!visited.add(resolved)) return false;
    try {
      return switch (resolved) {
        ChildType() => true,
        UnionType(:final variants) => variants.any(
          (v) => _isTypeComponentId(v, visited),
        ),
        _ => false,
      };
    } finally {
      visited.remove(resolved);
    }
  }

  /// Whether [type] represents a child list.
  bool isTypeChildList(TypeDefinition type) =>
      _isTypeChildList(type, Set<Object>.identity());

  bool _isTypeChildList(TypeDefinition type, Set<Object> visited) {
    final TypeDefinition resolved = resolveType(type);
    if (!visited.add(resolved)) return false;
    try {
      return switch (resolved) {
        ChildListType() => true,
        UnionType(:final variants) => variants.any(
          (v) => _isTypeChildList(v, visited),
        ),
        _ => false,
      };
    } finally {
      visited.remove(resolved);
    }
  }

  /// Whether [type] represents an interaction action.
  bool isTypeAction(TypeDefinition type) =>
      _isTypeAction(type, Set<Object>.identity());

  bool _isTypeAction(TypeDefinition type, Set<Object> visited) {
    final TypeDefinition resolved = resolveType(type);
    if (!visited.add(resolved)) return false;
    try {
      return switch (resolved) {
        ActionType() => true,
        UnionType(:final variants) => variants.any(
          (v) => _isTypeAction(v, visited),
        ),
        _ => false,
      };
    } finally {
      visited.remove(resolved);
    }
  }

  /// Whether [type] accepts a data binding (dynamic value, binding, or
  /// `ChildList` template).
  bool typeAllowsBinding(TypeDefinition type) =>
      _typeAllowsBinding(type, Set<Object>.identity());

  bool _typeAllowsBinding(TypeDefinition type, Set<Object> visited) {
    final TypeDefinition resolved = resolveType(type);
    if (!visited.add(resolved)) return false;
    try {
      return switch (resolved) {
        DataBindingType() || ChildListType() => true,
        UnionType(:final dynamic, :final variants) =>
          dynamic || variants.any((v) => _typeAllowsBinding(v, visited)),
        _ => resolved.isDynamic,
      };
    } finally {
      visited.remove(resolved);
    }
  }

  /// Allowed enum values of [type], or `null` if [type] is not an enum.
  List<Object>? typeEnumValues(TypeDefinition type) =>
      _typeEnumValues(type, Set<Object>.identity());

  List<Object>? _typeEnumValues(TypeDefinition type, Set<Object> visited) {
    final TypeDefinition resolved = resolveType(type);
    if (!visited.add(resolved)) return null;
    try {
      if (resolved is EnumType) return resolved.values;
      if (resolved is UnionType) {
        for (final TypeDefinition v in resolved.variants) {
          if (_typeEnumValues(v, visited) case final List<Object> values) {
            return values;
          }
        }
      }
      return null;
    } finally {
      visited.remove(resolved);
    }
  }

  /// Extracts user-defined nested object or array-of-objects properties from a
  /// canonical [TypeDefinition], ignoring protocol wire types (`DataBinding`,
  /// `FunctionCall`, `Action`, `ChildList`) by construction.
  ({bool isArray, List<ParameterDefinition> properties})?
  structuredTypeProperties(TypeDefinition type) =>
      _structuredTypeProperties(type, Set<Object>.identity());

  ({bool isArray, List<ParameterDefinition> properties})?
  _structuredTypeProperties(TypeDefinition type, Set<Object> visited) {
    final TypeDefinition resolved = resolveType(type);
    if (!visited.add(resolved)) return null;
    try {
      switch (resolved) {
        case ObjectType(:final properties) when properties.isNotEmpty:
          return (isArray: false, properties: properties);
        case ArrayType(:final items) when items != null:
          final TypeDefinition elem = resolveType(items);
          if (elem is ObjectType && elem.properties.isNotEmpty) {
            return (isArray: true, properties: elem.properties);
          }
          return null;
        case UnionType(:final variants):
          for (final v in variants) {
            if (_structuredTypeProperties(v, visited) case final found?) {
              return found;
            }
          }
          return null;
        default:
          return null;
      }
    } finally {
      visited.remove(resolved);
    }
  }

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
  Map<String, Object?>? propertySchema(String component, String property) {
    final _ComponentSignature sig = _signature(component);
    if (sig.schemas.containsKey(property)) return sig.schemas[property];
    // For canonical components, materialize a single property's JSON Schema
    // lazily only if a legacy schema consumer asks for it.
    final ParameterDefinition? param = parameterDefinition(component, property);
    if (param == null) return null;
    final bool v1 =
        catalog.protocolVersion?.isAtLeast(A2uiProtocolVersion.v1_0) ?? false;
    return sig.schemas[property] = JsonSchemaCodec.typeDefinitionToJsonSchema(
      param.type,
      atLeastV1: v1,
    );
  }

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

  /// The component's own description, if its definition or schema has one.
  String? componentDescription(String component) {
    if (model.component(component)?.description case final String description) {
      return description;
    }
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
  List<String> parameters(String function) {
    if (model.function(function) case final FunctionDefinition def
        when def.parameters.isNotEmpty) {
      return [for (final ParameterDefinition p in def.parameters) p.name];
    }
    return [..._parameterSchemas(function).keys];
  }

  /// The parameters the function requires.
  List<String> requiredParameters(String function) {
    if (model.function(function) case final FunctionDefinition def
        when def.parameters.isNotEmpty) {
      return def.requiredParameters;
    }
    return [
      for (final Object? name
          in _argumentSchema(function)['required'] as List<Object?>? ??
              const [])
        name! as String,
    ];
  }

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

  _ComponentSignature _signature(
    String component,
  ) => _components.putIfAbsent(component, () {
    // Canonical components build their signature directly from
    // ComponentDefinition without materializing or flattening JSON Schema.
    if (isCanonicalComponent(component)) {
      final ComponentDefinition def = catalog.components[component]!.definition;
      final List<String> specific = [
        for (final ParameterDefinition p in def.parameters)
          if (p.name != 'weight' && p.type is! AccessibilityType) p.name,
      ];
      final List<String> common = [
        for (final ParameterDefinition p in def.parameters)
          if (p.name == 'weight') p.name,
      ];
      final ordered = [...specific, ...common];
      final Set<String> reqSet = def.requiredParameters.toSet();
      return _ComponentSignature(
        properties: ordered,
        required: [
          for (final String name in ordered)
            if (reqSet.contains(name)) name,
        ],
        schemas: <String, Map<String, Object?>>{},
        isCheckable: def.checkable,
      );
    }

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
  });
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
        if (_properties(schema.cast<String, Object?>())['@call']
            case {'const': final String name} when name.startsWith('@'))
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
String? _refName(Map<Object?, Object?> schema) => switch (schema[r'$ref']) {
  final String ref => ref.substring(ref.lastIndexOf('/') + 1),
  _ => null,
};

Map<Object?, Object?> _rawProperties(Map<Object?, Object?> schema) =>
    switch (schema['properties']) {
      final Map<Object?, Object?> map => map,
      _ => const <Object?, Object?>{},
    };

/// The subschemas of a combinator, yielded directly without `.cast()` wrappers
/// so identity-based cycle tracking sees the original map instances.
Iterable<Map<Object?, Object?>> _rawAlternatives(
  Map<Object?, Object?> schema,
) => [
  for (final String key in const ['oneOf', 'anyOf', 'allOf'])
    if (schema[key] case final List<Object?> list)
      for (final Object? sub in list)
        if (sub is Map<Object?, Object?>) sub,
];

Iterable<Map<String, Object?>> _alternatives(Map<String, Object?> schema) => [
  for (final Map<Object?, Object?> sub in _rawAlternatives(schema))
    switch (sub) {
      final Map<String, Object?> map => map,
      _ => sub.cast<String, Object?>(),
    },
];

/// Whether [raw] is a schema map declaring an object, `$ref`, or combinator.
bool isObjectOrRefSchema(Object? raw) =>
    raw is Map<Object?, Object?> &&
    (raw.containsKey(r'$ref') ||
        raw['type'] == 'object' ||
        raw['properties'] is Map ||
        raw.containsKey('allOf') ||
        raw.containsKey('oneOf') ||
        raw.containsKey('anyOf'));

bool _isFlattenedDataBinding(Map<Object?, Object?> schema, String pathKey) {
  final Object? type = schema['type'];
  if (type != null && type != 'object') return false;
  final Map<Object?, Object?> props = _rawProperties(schema);
  if (props.length != 1 || !props.containsKey(pathKey)) return false;
  final Object? required = schema['required'];
  return required is List && required.contains(pathKey);
}

bool _isFlattenedAction(Map<Object?, Object?> schema) {
  final Object? type = schema['type'];
  if (type != null && type != 'object') return false;
  final Map<Object?, Object?> props = _rawProperties(schema);
  if (props.length != 1) return false;
  final Object? key = props.keys.first;
  if (key != 'event' && key != 'functionCall') return false;
  final Object? required = schema['required'];
  return required is List &&
      required.contains(key) &&
      isObjectOrRefSchema(props[key]);
}

bool _allowsBinding(
  Map<Object?, Object?> schema,
  String pathKey,
  Set<Object> seen,
) {
  if (!seen.add(schema)) return false;
  final String? ref = _refName(schema);
  if (ref != null &&
      (ref == 'DataBinding' ||
          ref.startsWith('Dynamic') ||
          ref == 'ChildList')) {
    return true;
  }
  if (_isFlattenedDataBinding(schema, pathKey)) return true;
  return _rawAlternatives(schema)
      .any((sub) => _allowsBinding(sub, pathKey, seen));
}

/// Whether a property of [schema] accepts a data binding.
///
/// The shared types that do are named for it: `DataBinding`, the `Dynamic*`
/// family and `ChildList`, whose template form carries a path. Locally
/// flattened `DataBinding` object schemas with [pathKey] (`@path` in v1.0+,
/// `path` before) in `required` are also recognized.
bool allowsBinding(
  Map<String, Object?>? schema, {
  String pathKey = '@path',
  Set<Object>? visited,
}) {
  if (schema == null) return false;
  return _allowsBinding(schema, pathKey, visited ?? Set<Object>.identity());
}

bool _isComponentId(Map<Object?, Object?> schema, Set<Object> seen) {
  if (!seen.add(schema)) return false;
  return switch (_refName(schema)) {
    'ComponentId' || 'Child' => true,
    _ => _rawAlternatives(schema).any((sub) => _isComponentId(sub, seen)),
  };
}

/// Whether [schema] holds the id of another component.
///
/// v0.9 names the shared type `ComponentId`; v1.0 names a single child
/// `Child`.
bool isComponentId(Map<String, Object?>? schema, [Set<Object>? visited]) {
  if (schema == null) return false;
  return _isComponentId(schema, visited ?? Set<Object>.identity());
}

bool _isChildList(Map<Object?, Object?> schema, Set<Object> seen) {
  if (!seen.add(schema)) return false;
  return _refName(schema) == 'ChildList' ||
      _rawAlternatives(schema).any((sub) => _isChildList(sub, seen));
}

/// Whether [schema] is a list of children: component ids, or a template that
/// repeats one component over a list in the data model.
bool isChildList(Map<String, Object?>? schema, [Set<Object>? visited]) {
  if (schema == null) return false;
  return _isChildList(schema, visited ?? Set<Object>.identity());
}

bool _isAction(Map<Object?, Object?> schema, Set<Object> seen) {
  if (!seen.add(schema)) return false;
  return _refName(schema) == 'Action' ||
      _isFlattenedAction(schema) ||
      _rawAlternatives(schema).any((sub) => _isAction(sub, seen));
}

/// Whether [schema] is an action: an event for the agent, or a local call.
bool isAction(Map<String, Object?>? schema, [Set<Object>? visited]) {
  if (schema == null) return false;
  return _isAction(schema, visited ?? Set<Object>.identity());
}

List<Object?>? _enumOf(Map<Object?, Object?> schema, Set<Object> seen) {
  if (!seen.add(schema)) return null;
  if (schema['enum'] case final List<Object?> values) return values;
  for (final Map<Object?, Object?> sub in _rawAlternatives(schema)) {
    if (_enumOf(sub, seen) case final List<Object?> values) return values;
  }
  return null;
}

/// The values an enum property admits, or null.
List<Object?>? enumOf(Map<String, Object?>? schema, [Set<Object>? visited]) {
  if (schema == null) return null;
  return _enumOf(schema, visited ?? Set<Object>.identity());
}

bool _hasLabelAndValue(Map<Object?, Object?> sub, Set<Object> seen) {
  if (!seen.add(sub)) return false;
  final Map<Object?, Object?> properties = _rawProperties(sub);
  if (properties.containsKey('label') && properties.containsKey('value')) {
    return true;
  }
  return _rawAlternatives(sub).any((alt) => _hasLabelAndValue(alt, seen));
}

bool _expectsOptionObjects(Map<Object?, Object?> schema, Set<Object> seen) {
  if (!seen.add(schema)) return false;
  if (schema['items'] case final Map<Object?, Object?> items) {
    return _hasLabelAndValue(items, Set<Object>.identity());
  }
  return _rawAlternatives(schema)
      .any((sub) => _expectsOptionObjects(sub, seen));
}

/// Whether [schema] is a list of `{label, value}` options, which Express lets
/// the model write as plain strings.
bool expectsOptionObjects(
  Map<String, Object?>? schema, [
  Set<Object>? visited,
]) {
  if (schema == null) return false;
  return _expectsOptionObjects(schema, visited ?? Set<Object>.identity());
}
