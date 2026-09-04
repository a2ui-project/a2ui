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

enum PrimitiveKind { string, integer, float, boolean, any }

sealed class TypeDescriptor {
  const TypeDescriptor();
}

class PrimitiveType extends TypeDescriptor {
  final PrimitiveKind primitive;
  const PrimitiveType(this.primitive);
}

class EnumType extends TypeDescriptor {
  final String name;
  final List<String> values;
  final String? description;

  const EnumType({required this.name, required this.values, this.description});
}

class ComponentRefType extends TypeDescriptor {
  final List<String> allowedComponents;
  const ComponentRefType({this.allowedComponents = const []});
}

class ComponentListType extends TypeDescriptor {
  final List<String> allowedComponents;
  const ComponentListType({this.allowedComponents = const []});
}

class DynamicType extends TypeDescriptor {
  final TypeDescriptor inner;
  const DynamicType(this.inner);
}

class ActionType extends TypeDescriptor {
  const ActionType();
}

class DataBindingType extends TypeDescriptor {
  const DataBindingType();
}

class CheckRuleType extends TypeDescriptor {
  const CheckRuleType();
}

class ListType extends TypeDescriptor {
  final TypeDescriptor elementType;
  const ListType(this.elementType);
}

class MapType extends TypeDescriptor {
  final TypeDescriptor valueType;
  const MapType(this.valueType);
}

class UnionType extends TypeDescriptor {
  final List<TypeDescriptor> options;
  const UnionType(this.options);
}

class PropertyDescriptor {
  final String name;
  final TypeDescriptor type;
  final String? description;
  final dynamic defaultValue;
  final bool isRequired;

  const PropertyDescriptor({
    required this.name,
    required this.type,
    this.description,
    this.defaultValue,
    required this.isRequired,
  });
}

class AnalysedComponentApi {
  final String name;
  final String? description;
  final Map<String, PropertyDescriptor> properties;
  final List<String> requiredProperties;
  final bool isCheckable;

  const AnalysedComponentApi({
    required this.name,
    this.description,
    required this.properties,
    required this.requiredProperties,
    this.isCheckable = false,
  });
}

class AnalysedFunctionApi {
  final String name;
  final String? description;
  final Map<String, PropertyDescriptor> parameters;
  final List<String> requiredParameters;
  final TypeDescriptor? returnType;

  const AnalysedFunctionApi({
    required this.name,
    this.description,
    required this.parameters,
    required this.requiredParameters,
    this.returnType,
  });
}

class AnalysedCatalog {
  final String catalogId;
  final String specVersion;
  final Map<String, AnalysedComponentApi> components;
  final Map<String, AnalysedFunctionApi> functions;
  final Map<String, EnumType> enums;

  const AnalysedCatalog({
    required this.catalogId,
    required this.specVersion,
    required this.components,
    required this.functions,
    required this.enums,
  });
}
