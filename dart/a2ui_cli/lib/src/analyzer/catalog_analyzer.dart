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

import 'package:a2ui_core/a2ui_core.dart' show A2uiReturnType;
import 'catalog_reader.dart';
import 'types.dart';

String capitalize(String s) {
  if (s.isEmpty) return s;
  return s[0].toUpperCase() + s.substring(1);
}

class CatalogAnalyzer {
  final Map<String, EnumType> _enums = {};
  final Map<String, AnalysedObjectModel> _objectModels = {};

  /// Every type name the emitter will declare, in one namespace.
  ///
  /// Enums, inline object models and components all become top-level Python
  /// declarations in the same module, so a name claimed by one must not be
  /// handed to another. `Icon.name`, a `oneOf` of an icon enum and a custom
  /// SVG object, produces exactly that clash.
  final Set<String> _reservedNames = {};

  static AnalysedCatalog analyze(CodegenCatalog catalog) {
    final analyzer = CatalogAnalyzer();
    return analyzer.analyzeCatalog(catalog);
  }

  AnalysedCatalog analyzeCatalog(CodegenCatalog catalog) {
    _enums.clear();
    _objectModels.clear();
    _reservedNames
      ..clear()
      ..addAll(catalog.components.keys);

    final components = <String, AnalysedComponentApi>{};
    for (final entry in catalog.components.entries) {
      components[entry.key] = _analyzeComponent(entry.key, entry.value);
    }

    final functions = <String, AnalysedFunctionApi>{};
    for (final entry in catalog.functions.entries) {
      functions[entry.key] = _analyzeFunction(entry.key, entry.value);
    }

    return AnalysedCatalog(
      catalogId: catalog.id,
      specVersion: catalog.version,
      components: components,
      functions: functions,
      enums: Map.unmodifiable(_enums),
      objectModels: Map.unmodifiable(_objectModels),
    );
  }

  AnalysedComponentApi _analyzeComponent(
    String name,
    CatalogComponentDefinition comp,
  ) {
    final properties = <String, PropertyDescriptor>{};
    final requiredProps = <String>[];
    bool isCheckable = false;

    final description = comp.description;
    final rawProps = comp.properties;
    final reqSet = comp.requiredProperties;

    for (final entry in rawProps.entries) {
      final propName = entry.key;
      if (propName == 'checks' || propName == 'isValid') {
        isCheckable = true;
      }

      final propMap = entry.value is Map
          ? Map<String, dynamic>.from(entry.value as Map)
          : <String, dynamic>{};

      final isRequired = reqSet.contains(propName);
      if (isRequired) {
        requiredProps.push(propName);
      }

      final analyzed = _analyzePropertySchema(
        name,
        propName,
        propMap,
        isRequired: isRequired,
      );
      properties[propName] = analyzed;
    }

    return AnalysedComponentApi(
      name: name,
      description: description,
      properties: properties,
      requiredProperties: requiredProps,
      isCheckable: isCheckable,
    );
  }

  AnalysedFunctionApi _analyzeFunction(
    String name,
    CatalogFunctionDefinition fn,
  ) {
    final parameters = <String, PropertyDescriptor>{};
    final requiredParams = <String>[];

    final description = fn.description;
    final rawParams = fn.parameters;
    final reqSet = fn.requiredParameters;

    for (final entry in rawParams.entries) {
      final paramName = entry.key;
      final paramMap = entry.value is Map
          ? Map<String, dynamic>.from(entry.value as Map)
          : <String, dynamic>{};

      final isRequired = reqSet.contains(paramName);
      if (isRequired) {
        requiredParams.push(paramName);
      }

      final analyzed = _analyzePropertySchema(
        name,
        paramName,
        paramMap,
        isRequired: isRequired,
      );
      parameters[paramName] = analyzed;
    }

    return AnalysedFunctionApi(
      name: name,
      description: description,
      parameters: parameters,
      requiredParameters: requiredParams,
      returnType: _returnTypeToTypeDescriptor(fn.returnType),
    );
  }

  PropertyDescriptor _analyzePropertySchema(
    String parentName,
    String propName,
    Map<String, dynamic> schema, {
    required bool isRequired,
  }) {
    dynamic defaultValue = schema['default'];
    String? rawDescription = schema['description'] as String?;

    // Check REF pointer in description
    final refMatch = rawDescription != null
        ? RegExp(r'REF:([^|]+)(?:\|(.*))?').firstMatch(rawDescription)
        : null;

    final cleanDescription = refMatch != null
        ? (refMatch.group(2) ??
              rawDescription!.replaceAll(RegExp(r'REF:[^|]+(\|)?'), ''))
        : rawDescription;

    final refPath = refMatch?.group(1) ?? (schema[r'$ref'] as String? ?? '');

    if (refPath.isNotEmpty) {
      if (refPath.contains('AccessibilityAttributes')) {
        return PropertyDescriptor(
          name: propName,
          type: const AccessibilityType(),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
      if (refPath.contains('ChildList')) {
        return PropertyDescriptor(
          name: propName,
          type: const ComponentListType(),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
      if (refPath.contains('ComponentId')) {
        return PropertyDescriptor(
          name: propName,
          type: const ComponentRefType(),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
      if (refPath.contains('Action')) {
        return PropertyDescriptor(
          name: propName,
          type: const ActionType(),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
      if (refPath.contains('CheckRule')) {
        return PropertyDescriptor(
          name: propName,
          type: const CheckRuleType(),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
      if (refPath.contains('DataBinding')) {
        return PropertyDescriptor(
          name: propName,
          type: const DataBindingType(),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
      if (refPath.contains('DynamicStringList')) {
        return PropertyDescriptor(
          name: propName,
          type: const DynamicType(
            ListType(PrimitiveType(PrimitiveKind.string)),
          ),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
      if (refPath.contains('DynamicString')) {
        return PropertyDescriptor(
          name: propName,
          type: const DynamicType(PrimitiveType(PrimitiveKind.string)),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
      if (refPath.contains('DynamicNumber')) {
        return PropertyDescriptor(
          name: propName,
          type: const DynamicType(PrimitiveType(PrimitiveKind.float)),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
      if (refPath.contains('DynamicBoolean')) {
        return PropertyDescriptor(
          name: propName,
          type: const DynamicType(PrimitiveType(PrimitiveKind.boolean)),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
      if (refPath.contains('DynamicValue')) {
        return PropertyDescriptor(
          name: propName,
          type: const DynamicType(PrimitiveType(PrimitiveKind.any)),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
    }

    // Check enum
    if (schema['enum'] is List) {
      final values = (schema['enum'] as List).map((e) => e.toString()).toList();
      String preferred = '$parentName${capitalize(propName)}';
      if ((parentName == 'Row' || parentName == 'Column') &&
          (propName == 'justify' || propName == 'align')) {
        preferred = 'Flex${capitalize(propName)}';
      }

      // The same enum reached through two components (Row.justify and
      // Column.justify) is one type; only a different value set earns a
      // different name.
      var enumName = preferred;
      var suffix = 2;
      while (_reservedNames.contains(enumName)) {
        final existing = _enums[enumName];
        if (existing != null && _sameValues(existing.values, values)) break;
        enumName = '$preferred$suffix';
        suffix++;
      }

      final enumType = EnumType(
        name: enumName,
        values: values,
        description: cleanDescription,
      );
      _enums[enumName] = enumType;
      _reservedNames.add(enumName);

      return PropertyDescriptor(
        name: propName,
        type: enumType,
        description: cleanDescription,
        defaultValue: defaultValue,
        isRequired: isRequired,
      );
    }

    // Check anyOf / oneOf
    final unionList = schema['anyOf'] ?? schema['oneOf'];
    if (unionList is List && unionList.isNotEmpty) {
      bool hasDataBindingOrFn = false;
      final baseTypes = <TypeDescriptor>[];

      for (final item in unionList) {
        if (item is Map) {
          final itemMap = Map<String, dynamic>.from(item);
          final itemRef =
              itemMap[r'$ref'] as String? ??
              itemMap['description'] as String? ??
              '';
          if (itemRef.contains('DataBinding') ||
              itemRef.contains('FunctionCall') ||
              itemRef.contains('functionCall')) {
            hasDataBindingOrFn = true;
          } else {
            final t = _analyzePropertySchema(
              parentName,
              propName,
              itemMap,
              isRequired: false,
            ).type;
            if (t is! DynamicType && t is! DataBindingType && t is! ActionType) {
              baseTypes.add(t);
            }
          }
        }
      }

      // Every branch is kept. Dropping all but one would quietly narrow the
      // authoring API below what the catalog actually permits.
      if (baseTypes.isNotEmpty) {
        final base = baseTypes.length == 1
            ? baseTypes.first
            : UnionType(baseTypes);
        return PropertyDescriptor(
          name: propName,
          type: hasDataBindingOrFn ? DynamicType(base) : base,
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }
    }

    // Check type
    final typeStr = schema['type'] as String?;
    if (typeStr == 'string') {
      return PropertyDescriptor(
        name: propName,
        type: const PrimitiveType(PrimitiveKind.string),
        description: cleanDescription,
        defaultValue: defaultValue,
        isRequired: isRequired,
      );
    }

    if (typeStr == 'integer' || typeStr == 'number') {
      return PropertyDescriptor(
        name: propName,
        type: const PrimitiveType(PrimitiveKind.float),
        description: cleanDescription,
        defaultValue: defaultValue,
        isRequired: isRequired,
      );
    }

    if (typeStr == 'boolean') {
      return PropertyDescriptor(
        name: propName,
        type: const PrimitiveType(PrimitiveKind.boolean),
        description: cleanDescription,
        defaultValue: defaultValue,
        isRequired: isRequired,
      );
    }

    if (typeStr == 'array') {
      final itemsMap = schema['items'] is Map
          ? Map<String, dynamic>.from(schema['items'] as Map)
          : <String, dynamic>{};
      final itemRef =
          itemsMap[r'$ref'] as String? ??
          itemsMap['description'] as String? ??
          '';

      if (itemRef.contains('ComponentId')) {
        return PropertyDescriptor(
          name: propName,
          type: const ComponentListType(),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }

      final itemModel = _registerObjectModel(
        _itemModelName(parentName, propName),
        itemsMap,
        fallbackDescription: cleanDescription,
      );
      if (itemModel != null) {
        return PropertyDescriptor(
          name: propName,
          type: ListType(itemModel),
          description: cleanDescription,
          defaultValue: defaultValue,
          isRequired: isRequired,
        );
      }

      final elemProp = _analyzePropertySchema(
        parentName,
        '${propName}Item',
        itemsMap,
        isRequired: true,
      );
      return PropertyDescriptor(
        name: propName,
        type: ListType(elemProp.type),
        description: cleanDescription,
        defaultValue: defaultValue,
        isRequired: isRequired,
      );
    }

    if (typeStr == 'object') {
      final model = _registerObjectModel(
        '$parentName${capitalize(propName)}',
        schema,
      );
      return PropertyDescriptor(
        name: propName,
        type: model ?? const MapType(PrimitiveType(PrimitiveKind.any)),
        description: cleanDescription,
        defaultValue: defaultValue,
        isRequired: isRequired,
      );
    }

    return PropertyDescriptor(
      name: propName,
      type: const PrimitiveType(PrimitiveKind.any),
      description: cleanDescription,
      defaultValue: defaultValue,
      isRequired: isRequired,
    );
  }

  /// Best-effort English singularisation, used only to name generated models.
  static String _singular(String name) {
    if (name.length < 2 || !name.endsWith('s')) return name;
    if (name.endsWith('ies')) return '${name.substring(0, name.length - 3)}y';
    if (name.endsWith('sses') ||
        name.endsWith('xes') ||
        name.endsWith('ches') ||
        name.endsWith('shes')) {
      return name.substring(0, name.length - 2);
    }
    if (name.endsWith('ss')) return name;
    return name.substring(0, name.length - 1);
  }

  /// Names the model generated for the items of an array property.
  ///
  /// `Tabs.tabs` would otherwise become `TabsTab`, so a property whose singular
  /// already matches its parent is suffixed instead: `TabItem`. Everything else
  /// is qualified by its parent, giving names like `ChoicePickerOption` that
  /// stay unique across the catalog.
  static String _itemModelName(String parentName, String propName) {
    final base = capitalize(_singular(propName));
    if (_singular(parentName).toLowerCase() == base.toLowerCase()) {
      return '${base}Item';
    }
    return '$parentName$base';
  }

  /// Registers an inline object schema as a named model, if it has properties.
  ///
  /// Returns null for objects with no declared properties: those carry no
  /// structure worth a class and stay an untyped mapping.
  ObjectModelType? _registerObjectModel(
    String preferredName,
    Map<String, dynamic> schema, {
    String? fallbackDescription,
  }) {
    if (schema['properties'] is! Map) return null;
    final rawProps = Map<String, dynamic>.from(schema['properties'] as Map);
    if (rawProps.isEmpty) return null;

    final reqSet = schema['required'] is List
        ? (schema['required'] as List).map((e) => e.toString()).toSet()
        : <String>{};

    var name = preferredName;
    final properties = <String, PropertyDescriptor>{};
    for (final entry in rawProps.entries) {
      final propMap = entry.value is Map
          ? Map<String, dynamic>.from(entry.value as Map)
          : <String, dynamic>{};
      properties[entry.key] = _analyzePropertySchema(
        name,
        entry.key,
        propMap,
        isRequired: reqSet.contains(entry.key),
      );
    }

    // Two unrelated objects can land on the same preferred name, and an enum
    // may already have claimed it. Reuse the existing model when the shapes
    // agree; otherwise qualify by the property that distinguishes this one,
    // so `Icon.name`'s custom-SVG branch reads as `IconNameSvgPath`.
    var suffix = 2;
    while (_reservedNames.contains(name)) {
      final existing = _objectModels[name];
      if (existing != null && _sameShape(existing.properties, properties)) {
        return ObjectModelType(name);
      }
      if (suffix == 2) {
        name = '$preferredName${capitalize(properties.keys.first)}';
      } else {
        name = '$preferredName$suffix';
      }
      suffix++;
    }

    _objectModels[name] = AnalysedObjectModel(
      name: name,
      description: schema['description'] as String? ?? fallbackDescription,
      properties: properties,
    );
    _reservedNames.add(name);
    return ObjectModelType(name);
  }

  /// Compares enum value sets, ignoring declaration order.
  ///
  /// `Row.justify` and `Column.justify` list the same values in a different
  /// order. They are the same type, and a `Literal` does not care about order.
  static bool _sameValues(List<String> a, List<String> b) {
    if (a.length != b.length) return false;
    return a.toSet().containsAll(b);
  }

  static bool _sameShape(
    Map<String, PropertyDescriptor> a,
    Map<String, PropertyDescriptor> b,
  ) {
    if (a.length != b.length) return false;
    for (final key in a.keys) {
      final other = b[key];
      if (other == null) return false;
      if (a[key]!.isRequired != other.isRequired) return false;
      if (a[key]!.type.runtimeType != other.type.runtimeType) return false;
    }
    return true;
  }

  TypeDescriptor _returnTypeToTypeDescriptor(A2uiReturnType ret) {
    switch (ret) {
      case A2uiReturnType.string:
        return const PrimitiveType(PrimitiveKind.string);
      case A2uiReturnType.number:
        return const PrimitiveType(PrimitiveKind.float);
      case A2uiReturnType.boolean:
        return const PrimitiveType(PrimitiveKind.boolean);
      case A2uiReturnType.array:
        return const ListType(PrimitiveType(PrimitiveKind.any));
      case A2uiReturnType.object:
        return const MapType(PrimitiveType(PrimitiveKind.any));
      case A2uiReturnType.any:
      case A2uiReturnType.void_:
        return const PrimitiveType(PrimitiveKind.any);
    }
  }
}

extension _ListExt<T> on List<T> {
  void push(T val) => add(val);
}
