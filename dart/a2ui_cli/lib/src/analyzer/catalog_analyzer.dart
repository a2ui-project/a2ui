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

import 'package:a2ui_core/a2ui_core.dart' as core;

import 'catalog_reader.dart';
import 'types.dart';

String capitalize(String s) {
  if (s.isEmpty) return s;
  return s[0].toUpperCase() + s.substring(1);
}

/// Analyzes a catalog's canonical [core.CatalogModel] into named enums,
/// deduplicated object models, and typed component/function signatures for
/// target-language code emitters.
class CatalogAnalyzer {
  final Map<String, EnumType> _enums = {};
  final Map<String, AnalysedObjectModel> _objectModels = {};
  bool _isV10 = false;

  /// Every type name the emitter will declare, in one namespace.
  ///
  /// Enums, inline object models, and components all become top-level
  /// declarations in the same module, so a name claimed by one must not be
  /// handed to another.
  final Set<String> _reservedNames = {};

  /// Analyzes a [core.CatalogApi] for code generation.
  static AnalysedCatalog analyze(core.CatalogApi catalog) =>
      CatalogAnalyzer().analyzeCatalog(CodegenCatalog(catalog));

  /// Analyzes a [CodegenCatalog] for code generation.
  static AnalysedCatalog analyzeCodegen(CodegenCatalog catalog) =>
      CatalogAnalyzer().analyzeCatalog(catalog);

  AnalysedCatalog analyzeCatalog(CodegenCatalog catalog) {
    final core.CatalogModel model = catalog.model;
    _enums.clear();
    _objectModels.clear();
    _isV10 = model.protocolVersion == core.A2uiProtocolVersion.v1_0;
    _reservedNames
      ..clear()
      ..addAll(model.components.map((c) => c.name));

    final components = <String, AnalysedComponentApi>{
      for (final core.ComponentDefinition comp in model.components)
        comp.name: _analyzeComponent(comp, model),
    };
    final functions = <String, AnalysedFunctionApi>{
      for (final core.FunctionDefinition fn in model.functions)
        fn.name: _analyzeFunction(fn, model),
    };

    return AnalysedCatalog(
      catalogId: model.catalogId,
      specVersion: catalog.version,
      components: components,
      functions: functions,
      enums: Map.unmodifiable(_enums),
      objectModels: Map.unmodifiable(_objectModels),
    );
  }

  AnalysedComponentApi _analyzeComponent(
    core.ComponentDefinition comp,
    core.CatalogModel model,
  ) {
    final properties = <String, PropertyDescriptor>{};
    final requiredProps = <String>[];

    for (final core.ParameterDefinition param in comp.parameters) {
      if (param.required) requiredProps.add(param.name);
      properties[param.name] = _analyzeParameter(comp.name, param, model);
    }

    if (comp.checkable) {
      final checksKey = _isV10 ? '@checks' : 'checks';
      properties.putIfAbsent(
        checksKey,
        () => PropertyDescriptor(
          name: checksKey,
          type: const ListType(CheckRuleType()),
          isRequired: false,
        ),
      );
    }

    return AnalysedComponentApi(
      name: comp.name,
      description: comp.description,
      properties: properties,
      requiredProperties: requiredProps,
      isCheckable: comp.checkable,
    );
  }

  AnalysedFunctionApi _analyzeFunction(
    core.FunctionDefinition fn,
    core.CatalogModel model,
  ) {
    final parameters = <String, PropertyDescriptor>{};
    final requiredParams = <String>[];

    for (final core.ParameterDefinition param in fn.parameters) {
      if (param.required) requiredParams.add(param.name);
      parameters[param.name] = _analyzeParameter(fn.name, param, model);
    }

    return AnalysedFunctionApi(
      name: fn.name,
      description: fn.description,
      parameters: parameters,
      requiredParameters: requiredParams,
      returnType: _returnTypeToTypeDescriptor(fn.returnType.returnType),
    );
  }

  PropertyDescriptor _analyzeParameter(
    String parentName,
    core.ParameterDefinition param,
    core.CatalogModel model,
  ) {
    final core.TypeDefinition rawType = param.type;
    final core.TypeDefinition resolved = model.resolveType(rawType) ?? rawType;
    final String? description = rawType.description ?? resolved.description;
    final Object? defaultValue = rawType.hasDefault
        ? rawType.defaultValue
        : resolved.defaultValue;
    return PropertyDescriptor(
      name: param.name,
      type: _analyzeType(parentName, param.name, resolved, model),
      description: description,
      defaultValue: defaultValue,
      isRequired: param.required,
    );
  }

  TypeDescriptor _analyzeType(
    String parentName,
    String propName,
    core.TypeDefinition type,
    core.CatalogModel model,
  ) {
    final core.TypeDefinition resolved = model.resolveType(type) ?? type;
    return switch (resolved) {
      core.AccessibilityType() => const AccessibilityType(),
      core.ChildListType() => const ComponentListType(),
      core.ChildType() => const ComponentRefType(),
      core.ActionType() => const ActionType(),
      core.CheckRuleType() => const CheckRuleType(),
      core.DataBindingType() => const DataBindingType(),
      core.FunctionCallType() => const DynamicType(
        PrimitiveType(PrimitiveKind.any),
      ),
      // Multi-format dynamic strings (e.g. DateTimeInput.min/max) previously
      // used `allOf: [DynamicString, {if/then}]` which fell back to `Any` in
      // checked-in Python goldens; keep parity until those goldens regenerate.
      core.StringType(dynamic: true, formats: final List<String> formats)
          when formats.length > 1 =>
        const PrimitiveType(PrimitiveKind.any),
      core.StringType(:final dynamic) => _wrapDynamic(
        const PrimitiveType(PrimitiveKind.string),
        dynamic,
      ),
      core.NumberType(:final dynamic) || core.IntegerType(:final dynamic) =>
        _wrapDynamic(const PrimitiveType(PrimitiveKind.float), dynamic),
      core.BooleanType(:final dynamic) => _wrapDynamic(
        const PrimitiveType(PrimitiveKind.boolean),
        dynamic,
      ),
      core.AnyType(dynamic: true, nullable: false) => const DynamicType(
        PrimitiveType(PrimitiveKind.any),
      ),
      core.AnyType() => const PrimitiveType(PrimitiveKind.any),
      core.ConstType(:final value) => switch (value) {
        String() => const PrimitiveType(PrimitiveKind.string),
        num() => const PrimitiveType(PrimitiveKind.float),
        bool() => const PrimitiveType(PrimitiveKind.boolean),
        _ => const PrimitiveType(PrimitiveKind.any),
      },
      core.EnumType(:final values, :final dynamic, :final description) =>
        _wrapDynamic(
          _registerEnum(
            parentName,
            propName,
            values.map((v) => v.toString()).toList(),
            description: description,
          ),
          dynamic,
        ),
      core.ArrayType(:final items, :final dynamic, :final description) =>
        _analyzeArray(
          parentName,
          propName,
          items,
          model,
          isDynamic: dynamic,
          fallbackDescription: description,
        ),
      core.ObjectType(:final properties, :final dynamic) => _wrapDynamic(
        properties.isEmpty
            ? const MapType(PrimitiveType(PrimitiveKind.any))
            : _registerObjectModel(
                '$parentName${capitalize(propName)}',
                resolved,
                model,
              ),
        dynamic,
      ),
      core.UnionType(:final variants, :final dynamic) => _analyzeUnion(
        parentName,
        propName,
        variants,
        model,
        isDynamic: dynamic,
      ),
      core.RefType() ||
      core.TypeDefinition() => const PrimitiveType(PrimitiveKind.any),
    };
  }

  TypeDescriptor _analyzeArray(
    String parentName,
    String propName,
    core.TypeDefinition? items,
    core.CatalogModel model, {
    required bool isDynamic,
    String? fallbackDescription,
  }) {
    if (items == null) {
      return _wrapDynamic(
        const ListType(PrimitiveType(PrimitiveKind.any)),
        isDynamic,
      );
    }
    final core.TypeDefinition resolved = model.resolveType(items) ?? items;
    if (resolved is core.ChildType) return const ComponentListType();
    if (resolved is core.ObjectType && resolved.properties.isNotEmpty) {
      final ObjectModelType itemModel = _registerObjectModel(
        _itemModelName(parentName, propName),
        resolved,
        model,
        fallbackDescription: fallbackDescription,
      );
      return _wrapDynamic(ListType(itemModel), isDynamic);
    }
    final TypeDescriptor elem = _analyzeType(
      parentName,
      '${propName}Item',
      resolved,
      model,
    );
    return _wrapDynamic(ListType(elem), isDynamic);
  }

  TypeDescriptor _analyzeUnion(
    String parentName,
    String propName,
    List<core.TypeDefinition> variants,
    core.CatalogModel model, {
    required bool isDynamic,
  }) {
    var hasDynamic = isDynamic;
    final baseTypes = <TypeDescriptor>[];

    for (final variant in variants) {
      final core.TypeDefinition resolved =
          model.resolveType(variant) ?? variant;
      if (resolved is core.DataBindingType ||
          resolved is core.FunctionCallType) {
        hasDynamic = true;
        continue;
      }
      if (resolved is core.ConstType && resolved.value == null) continue;
      final TypeDescriptor analyzed = _analyzeType(
        parentName,
        propName,
        resolved,
        model,
      );
      if (analyzed is! DynamicType &&
          analyzed is! DataBindingType &&
          analyzed is! ActionType) {
        baseTypes.add(analyzed);
      }
    }

    if (baseTypes.isNotEmpty) {
      final TypeDescriptor base = baseTypes.length == 1
          ? baseTypes.first
          : UnionType(baseTypes);
      return _wrapDynamic(base, hasDynamic);
    }
    if (hasDynamic) {
      return const DynamicType(PrimitiveType(PrimitiveKind.any));
    }
    return const PrimitiveType(PrimitiveKind.any);
  }

  static TypeDescriptor _wrapDynamic(TypeDescriptor inner, bool isDynamic) =>
      isDynamic ? DynamicType(inner) : inner;

  EnumType _registerEnum(
    String parentName,
    String propName,
    List<String> values, {
    String? description,
  }) {
    var preferred = '$parentName${capitalize(propName)}';
    if ((parentName == 'Row' || parentName == 'Column') &&
        (propName == 'justify' || propName == 'align')) {
      preferred = 'Flex${capitalize(propName)}';
    }

    var enumName = preferred;
    var suffix = 2;
    while (_reservedNames.contains(enumName)) {
      final EnumType? existing = _enums[enumName];
      if (existing != null && _sameValues(existing.values, values)) break;
      enumName = '$preferred$suffix';
      suffix++;
    }

    final enumType = EnumType(
      name: enumName,
      values: values,
      description: description,
    );
    _enums[enumName] = enumType;
    _reservedNames.add(enumName);
    return enumType;
  }

  ObjectModelType _registerObjectModel(
    String preferredName,
    core.ObjectType obj,
    core.CatalogModel model, {
    String? fallbackDescription,
  }) {
    var name = preferredName;
    final properties = <String, PropertyDescriptor>{
      for (final core.ParameterDefinition prop in obj.properties)
        prop.name: _analyzeParameter(name, prop, model),
    };

    var suffix = 2;
    while (_reservedNames.contains(name)) {
      final AnalysedObjectModel? existing = _objectModels[name];
      if (existing != null && _sameShape(existing.properties, properties)) {
        return ObjectModelType(name);
      }
      name = suffix == 2
          ? '$preferredName${capitalize(properties.keys.first)}'
          : '$preferredName$suffix';
      suffix++;
    }

    _objectModels[name] = AnalysedObjectModel(
      name: name,
      description: obj.description ?? fallbackDescription,
      properties: properties,
    );
    _reservedNames.add(name);
    return ObjectModelType(name);
  }

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

  static String _itemModelName(String parentName, String propName) {
    final String base = capitalize(_singular(propName));
    if (_singular(parentName).toLowerCase() == base.toLowerCase()) {
      return '${base}Item';
    }
    return '$parentName$base';
  }

  static bool _sameValues(List<String> a, List<String> b) =>
      a.length == b.length && a.toSet().containsAll(b);

  static bool _sameType(TypeDescriptor a, TypeDescriptor b) {
    if (a.runtimeType != b.runtimeType) return false;
    return switch ((a, b)) {
      (
        PrimitiveType(primitive: final pa),
        PrimitiveType(primitive: final pb),
      ) =>
        pa == pb,
      (EnumType(values: final va), EnumType(values: final vb)) => _sameValues(
        va,
        vb,
      ),
      (
        ComponentRefType(allowedComponents: final ca),
        ComponentRefType(allowedComponents: final cb),
      ) =>
        _sameValues(ca, cb),
      (
        ComponentListType(allowedComponents: final ca),
        ComponentListType(allowedComponents: final cb),
      ) =>
        _sameValues(ca, cb),
      (DynamicType(inner: final ia), DynamicType(inner: final ib)) => _sameType(
        ia,
        ib,
      ),
      (ObjectModelType(name: final na), ObjectModelType(name: final nb)) =>
        na == nb,
      (ListType(elementType: final ea), ListType(elementType: final eb)) =>
        _sameType(ea, eb),
      (MapType(valueType: final va), MapType(valueType: final vb)) => _sameType(
        va,
        vb,
      ),
      (UnionType(options: final oa), UnionType(options: final ob)) =>
        oa.length == ob.length &&
            oa.every((o) => ob.any((other) => _sameType(o, other))),
      _ => true,
    };
  }

  static bool _sameShape(
    Map<String, PropertyDescriptor> a,
    Map<String, PropertyDescriptor> b,
  ) {
    if (a.length != b.length) return false;
    for (final String key in a.keys) {
      final PropertyDescriptor? other = b[key];
      if (other == null) return false;
      if (a[key]!.isRequired != other.isRequired) return false;
      if (!_sameType(a[key]!.type, other.type)) return false;
    }
    return true;
  }

  static TypeDescriptor _returnTypeToTypeDescriptor(core.A2uiReturnType ret) =>
      switch (ret) {
        core.A2uiReturnType.string => const PrimitiveType(PrimitiveKind.string),
        core.A2uiReturnType.number => const PrimitiveType(PrimitiveKind.float),
        core.A2uiReturnType.boolean => const PrimitiveType(
          PrimitiveKind.boolean,
        ),
        core.A2uiReturnType.array => const ListType(
          PrimitiveType(PrimitiveKind.any),
        ),
        core.A2uiReturnType.object || core.A2uiReturnType.validationResult =>
          const MapType(PrimitiveType(PrimitiveKind.any)),
        core.A2uiReturnType.any ||
        core.A2uiReturnType.void_ => const PrimitiveType(PrimitiveKind.any),
      };
}
