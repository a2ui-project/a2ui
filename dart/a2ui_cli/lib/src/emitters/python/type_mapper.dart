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

import '../../analyzer/types.dart';

const pythonKeywords = {
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
};

String sanitizeIdent(String name) {
  if (pythonKeywords.contains(name)) {
    return '${name}_';
  }
  return name;
}

String toSnakeCase(String name) {
  final snake = name
      .replaceAllMapped(
        RegExp(r'([a-z0-9])([A-Z])'),
        (Match m) => '${m[1]}_${m[2]}',
      )
      .toLowerCase();
  if (pythonKeywords.contains(snake)) {
    return '${snake}_';
  }
  return snake;
}

String typeToPython(TypeDescriptor desc) {
  switch (desc) {
    case PrimitiveType(:final primitive):
      switch (primitive) {
        case PrimitiveKind.string:
          return 'str';
        case PrimitiveKind.integer:
          return 'int';
        case PrimitiveKind.float:
          return 'float';
        case PrimitiveKind.boolean:
          return 'bool';
        case PrimitiveKind.any:
          return 'Any';
      }
    case EnumType(:final name):
      return name;
    case ComponentRefType():
      return 'Slot';
    case ComponentListType():
      return 'SlotList | DynamicChildList';
    case DynamicType(:final inner):
      final innerPy = typeToPython(inner);
      return '$innerPy | DataBinding | FunctionCall';
    case ActionType():
      return 'Action';
    case DataBindingType():
      return 'DataBinding';
    case CheckRuleType():
      return 'CheckRule';
    case ListType(:final elementType):
      return 'Sequence[${typeToPython(elementType)}]';
    case MapType(:final valueType):
      return 'Mapping[str, ${typeToPython(valueType)}]';
    case UnionType(:final options):
      return options.map(typeToPython).join(' | ');
  }
}
