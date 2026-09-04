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
import 'types.dart';

String capitalize(String s) {
  if (s.isEmpty) return s;
  return s[0].toUpperCase() + s.substring(1);
}

class CatalogAnalyzer {
  final Map<String, EnumType> _enums = {};

  static AnalysedCatalog analyze(Catalog catalog) {
    final analyzer = CatalogAnalyzer();
    return analyzer.analyzeCatalog(catalog);
  }

  AnalysedCatalog analyzeCatalog(Catalog catalog) {
    _enums.clear();

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
    );
  }

  AnalysedComponentApi _analyzeComponent(String name, ComponentApi comp) {
    final properties = <String, PropertyDescriptor>{};
    final requiredProps = <String>[];
    bool isCheckable = false;
    String? description;

    Map<String, dynamic> rawProps = {};
    Set<String> reqSet = {};

    if (comp is CatalogComponentDefinition) {
      rawProps = comp.properties;
      reqSet = comp.requiredProperties;
      description = comp.description;
    } else {
      final schemaMap = comp.schema.toJsonMap();
      description = schemaMap['description'] as String?;
      if (schemaMap['properties'] is Map) {
        rawProps = Map<String, dynamic>.from(schemaMap['properties'] as Map);
      }
      if (schemaMap['required'] is List) {
        reqSet = (schemaMap['required'] as List)
            .map((e) => e.toString())
            .toSet();
      }
    }

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

  AnalysedFunctionApi _analyzeFunction(String name, FunctionApi fn) {
    final parameters = <String, PropertyDescriptor>{};
    final requiredParams = <String>[];
    String? description;

    Map<String, dynamic> rawParams = {};
    Set<String> reqSet = {};

    if (fn is CatalogFunctionDefinition) {
      rawParams = fn.parameters;
      reqSet = fn.requiredParameters;
      description = fn.description;
    } else {
      final schemaMap = fn.argumentSchema.toJsonMap();
      description = schemaMap['description'] as String?;
      if (schemaMap['properties'] is Map) {
        rawParams = Map<String, dynamic>.from(schemaMap['properties'] as Map);
      }
      if (schemaMap['required'] is List) {
        reqSet = (schemaMap['required'] as List)
            .map((e) => e.toString())
            .toSet();
      }
    }

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
      String enumName = '$parentName${capitalize(propName)}';
      if ((parentName == 'Row' || parentName == 'Column') &&
          (propName == 'justify' || propName == 'align')) {
        enumName = 'Flex${capitalize(propName)}';
      }

      final enumType = EnumType(
        name: enumName,
        values: values,
        description: cleanDescription,
      );
      _enums[enumName] = enumType;

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
      TypeDescriptor? baseType;

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
            if (t is! DynamicType &&
                t is! DataBindingType &&
                t is! ActionType) {
              baseType = t;
            }
          }
        }
      }

      if (hasDataBindingOrFn && baseType != null) {
        return PropertyDescriptor(
          name: propName,
          type: DynamicType(baseType),
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
      return PropertyDescriptor(
        name: propName,
        type: const MapType(PrimitiveType(PrimitiveKind.any)),
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
