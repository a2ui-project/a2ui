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

/// Emits the Python fluent builder module for an analysed catalog.
///
/// The generated module carries no serialization code of its own. Component
/// classes are plain Pydantic models over the builder base types, and the
/// tree-to-flat-wire transformation is attached to the `Child` annotation in
/// the runtime package. Everything this emitter produces is therefore
/// declarative: field types, defaults, aliases and docstrings.
library;

import 'dart:io';
import 'package:path/path.dart' as p;
import '../../analyzer/types.dart';
import 'type_mapper.dart';

const licenseHeader = '''# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
''';

/// Column budget used when deciding whether to wrap a generated line.
const _lineWidth = 88;

/// Names re-exported from the versioned builder runtime by every catalog
/// module.
///
/// The list is fixed rather than computed from usage: a catalog module is the
/// single import an author needs, so it re-exports the runtime vocabulary even
/// when this particular catalog happens not to reference part of it.
const _runtimeImports = <String>[
  'AccessibilityAttributes',
  'Action',
  'ActionEvent',
  'BuilderBaseModel',
  'CheckRule',
  'Child',
  'ChildList',
  'ComponentBuilderNode',
  'ComponentRef',
  'ComponentTree',
  'DataBinding',
  'DynamicChildList',
  'FunctionCall',
  'IdAllocator',
  'OPEN_ENUM',
  'flatten_component_tree',
];

const _sectionRule =
    '# ======================================='
    '======================================';

String extractCatalogName(String catalogId) {
  final List<String> parts = catalogId
      .split('/')
      .where((s) => s.isNotEmpty)
      .toList();
  String last = parts.isNotEmpty ? parts.last : 'catalog';
  last = last.replaceAll(RegExp(r'\.json$'), '');
  if (last == 'catalog' && parts.length > 1) {
    final String prev = parts[parts.length - 2].replaceAll(
      RegExp(r'\.json$'),
      '',
    );
    if (prev.isNotEmpty) {
      last = prev;
    }
  }
  return last.replaceAll(RegExp(r'[^a-zA-Z0-9_]'), '_');
}

String _resolveDefaultBaseImport(String specVersion) {
  final String clean = specVersion.startsWith('v')
      ? specVersion.substring(1)
      : specVersion;
  if (clean.startsWith('1.')) {
    return 'a2ui.builder.v1_0';
  }
  return 'a2ui.builder.v0_9';
}

/// Renders a catalog description as a one-line Python docstring.
///
/// Schema descriptions are prose and occasionally span lines; they are folded
/// onto one line so the generated source stays predictable. A raw string is
/// used unless the text contains something a raw string cannot carry.
String _docstring(String text) {
  final String folded = text.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (!folded.contains('"""') &&
      !folded.contains(r'\') &&
      !folded.endsWith('"')) {
    return 'r"""$folded"""';
  }
  final String escaped = folded
      .replaceAll(r'\', r'\\')
      .replaceAll('"""', r'\"\"\"')
      .replaceAll(RegExp(r'"$'), r'\"');
  return '"""$escaped"""';
}

String _pyString(String value) =>
    '"${value.replaceAll(r'\', r'\\').replaceAll('"', r'\"')}"';

/// Renders a JSON schema default as a Python literal, or null if unsupported.
String? _pyDefault(Object? value) {
  if (value == null) return null;
  if (value is String) return _pyString(value);
  if (value is bool) return value ? 'True' : 'False';
  if (value is num) return value.toString();
  if (value is List && value.isEmpty) return '[]';
  return null;
}

class PythonEmitter {
  final AnalysedCatalog catalog;
  final String baseImport;
  final String catalogName;

  PythonEmitter(this.catalog, {String? baseImport, String? catalogName})
    : baseImport = baseImport ?? _resolveDefaultBaseImport(catalog.specVersion),
      catalogName = catalogName ?? extractCatalogName(catalog.catalogId);

  String generate() {
    final Map<String, String> functionClasses = _functionClassNames();
    final String body = <String>[
      if (catalog.enums.isNotEmpty) _enumSection(),
      if (catalog.objectModels.isNotEmpty) _objectModelSection(),
      if (catalog.components.isNotEmpty) _componentSection(),
      if (catalog.functions.isNotEmpty) _functionSection(functionClasses),
    ].join('\n\n\n');

    final blocks = <String>[
      '${_header()}\n\n${_imports(body)}',
      if (body.isNotEmpty) body,
      _exportSection(functionClasses),
    ];
    return '${blocks.join('\n\n\n')}\n';
  }

  List<String> emit(String targetPath) {
    String filePath;
    if (targetPath.endsWith('.py')) {
      filePath = targetPath;
      final parentDir = Directory(p.dirname(filePath));
      if (!parentDir.existsSync()) {
        parentDir.createSync(recursive: true);
      }
    } else {
      final outDir = Directory(targetPath);
      if (!outDir.existsSync()) {
        outDir.createSync(recursive: true);
      }
      filePath = p.join(targetPath, '$catalogName.py');
    }

    File(filePath).writeAsStringSync(generate());
    return [filePath];
  }

  // ---------------------------------------------------------------------------
  // File scaffolding
  // ---------------------------------------------------------------------------

  String _header() => [
    licenseHeader.trim(),
    '',
    '$_sectionRule=',
    '# CODE GENERATED BY @a2ui/cli. DO NOT EDIT DIRECTLY.',
    '#',
    '# Catalog ID: ${catalog.catalogId}',
    '#',
    '# This file was automatically generated by the A2UI CLI code generator.',
    '# Any manual modifications will be lost upon regeneration.',
    '$_sectionRule=',
    '"""Type-safe A2UI builders for $catalogName '
        '(version ${catalog.specVersion}).',
    '',
    'AUTO-GENERATED FILE - DO NOT EDIT MANUALLY.',
    'Generated by @a2ui/cli.',
    '"""',
    '',
    '__a2ui_codegen__ = "@a2ui/cli"',
  ].join('\n');

  /// Emits the import block, listing only names the generated body mentions.
  String _imports(String body) {
    bool used(String name) => RegExp('\\b$name\\b').hasMatch(body);

    final lines = <String>[];
    final List<String> typingNames = [
      'Annotated',
      'Any',
      'Literal',
      'Mapping',
      'Optional',
      'Sequence',
    ].where(used).toList();
    if (typingNames.isNotEmpty) {
      lines.add('from typing import ${typingNames.join(', ')}');
    }

    final Iterable<String> pydanticNames = [
      'BaseModel',
      'ConfigDict',
      'Field',
    ].where(used);
    if (pydanticNames.isNotEmpty) {
      lines.add('from pydantic import ${pydanticNames.join(', ')}');
    }

    if (lines.isNotEmpty) lines.add('');
    lines.add('from $baseImport import (');
    for (final String name in _runtimeImports) {
      lines.add('    $name,');
    }
    lines.add(')');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Enums
  // ---------------------------------------------------------------------------

  String _enumSection() {
    final lines = <String>[
      _sectionRule,
      '# Types & Enums',
      _sectionRule,
      '#',
      '# Catalog enums carry OPEN_ENUM metadata: the annotation stays the '
          'strict Literal',
      '# for authoring and type checking, and unknown values are only '
          'accepted when',
      '# parsing with a lenient validation context.',
      '',
    ];
    for (final MapEntry<String, EnumType> entry in catalog.enums.entries) {
      lines.add(_enumAlias(entry.key, entry.value.values));
    }
    return lines.join('\n');
  }

  /// Emits `Name = Annotated[Literal[...], OPEN_ENUM]`, wrapped when it is
  /// long.
  String _enumAlias(String name, List<String> values) {
    final List<String> rendered = values.map(_pyString).toList();
    final oneLine =
        '$name = Annotated[Literal[${rendered.join(', ')}], OPEN_ENUM]';
    if (oneLine.length <= _lineWidth) return oneLine;

    final indented = '    Literal[${rendered.join(', ')}], OPEN_ENUM';
    if (indented.length <= _lineWidth) {
      return '$name = Annotated[\n$indented\n]';
    }

    final String packed = _packValues(rendered, indent: 8);
    return '$name = Annotated[\n'
        '    Literal[\n$packed\n    ],\n'
        '    OPEN_ENUM,\n]';
  }

  /// Packs comma-separated values onto as few indented lines as fit the budget.
  String _packValues(List<String> values, {required int indent}) {
    final String pad = ' ' * indent;
    final lines = <String>[];
    var current = StringBuffer();
    for (final value in values) {
      final piece = '$value,';
      if (current.isEmpty) {
        current.write('$pad$piece');
      } else if (current.length + 1 + piece.length <= _lineWidth) {
        current.write(' $piece');
      } else {
        lines.add(current.toString());
        current = StringBuffer('$pad$piece');
      }
    }
    if (current.isNotEmpty) lines.add(current.toString());
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Item models
  // ---------------------------------------------------------------------------

  String _objectModelSection() {
    final blocks = <String>[
      [_sectionRule, '# Item Models', _sectionRule].join('\n'),
      for (final model in catalog.objectModels.values) _objectModelClass(model),
    ];
    return blocks.join('\n\n\n');
  }

  String _objectModelClass(AnalysedObjectModel model) {
    final lines = <String>[
      'class ${model.name}(BuilderBaseModel):',
      '    ${_docstring(model.description ?? '${model.name} item model.')}',
      '',
    ];
    for (final MapEntry<String, PropertyDescriptor> entry
        in model.properties.entries) {
      lines.add(_fieldDeclaration(entry.key, entry.value));
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Components
  // ---------------------------------------------------------------------------

  String _componentSection() {
    final blocks = <String>[
      [_sectionRule, '# Components', _sectionRule].join('\n'),
      for (final comp in catalog.components.values) _componentClass(comp),
    ];
    return blocks.join('\n\n\n');
  }

  String _componentClass(AnalysedComponentApi comp) {
    final String compLiteral = _pyString(comp.name);
    final lines = <String>[
      'class ${comp.name}(ComponentBuilderNode):',
      '    ${_docstring(comp.description ?? '${comp.name} component.')}',
      '',
      '    component: Literal[$compLiteral] = $compLiteral',
    ];

    for (final MapEntry<String, PropertyDescriptor> entry
        in comp.properties.entries) {
      // `component` is pinned above and `id` belongs to the base node.
      if (entry.key == 'component' || entry.key == 'id') continue;
      lines.add(_fieldDeclaration(entry.key, entry.value));
    }

    return lines.join('\n');
  }

  /// Emits one Pydantic field declaration, wrapping it when it runs long.
  String _fieldDeclaration(String rawName, PropertyDescriptor prop) {
    final String pyName = toSnakeCase(rawName);
    final String pyType = typeToPython(prop.type);
    final String? alias = pyName == rawName ? null : rawName;
    final String? defaultLiteral = _pyDefault(prop.defaultValue);

    if (alias == null) {
      if (prop.isRequired) return '    $pyName: $pyType';
      return '    $pyName: Optional[$pyType] = ${defaultLiteral ?? 'None'}';
    }

    final args = <String>[
      if (!prop.isRequired) 'default=${defaultLiteral ?? 'None'}',
      'serialization_alias=${_pyString(rawName)}',
    ];
    final annotation = prop.isRequired ? pyType : 'Optional[$pyType]';
    final oneLine = '    $pyName: $annotation = Field(${args.join(', ')})';
    if (oneLine.length <= _lineWidth) return oneLine;

    final packedArgs = '        ${args.join(', ')}';
    if (packedArgs.length <= _lineWidth) {
      return '    $pyName: $annotation = Field(\n$packedArgs\n    )';
    }
    final String perLine = args.map((a) => '        $a,').join('\n');
    return '    $pyName: $annotation = Field(\n$perLine\n    )';
  }

  // ---------------------------------------------------------------------------
  // Functions
  // ---------------------------------------------------------------------------

  /// Maps each catalog function name to the class name generated for it.
  ///
  /// A function class shares a namespace with the component classes, so a
  /// catalog with both a `Text` component and a `text` function would collide;
  /// the function yields and takes a suffix.
  Map<String, String> _functionClassNames() {
    final taken = <String>{
      ...catalog.components.keys,
      ...catalog.enums.keys,
      ...catalog.objectModels.keys,
    };
    final result = <String, String>{};
    for (final String name in catalog.functions.keys) {
      String className = capitalizeIdent(name);
      if (taken.contains(className)) className = '${className}Function';
      var suffix = 2;
      while (taken.contains(className)) {
        className = '${capitalizeIdent(name)}Function$suffix';
        suffix++;
      }
      taken.add(className);
      result[name] = className;
    }
    return result;
  }

  String _functionSection(Map<String, String> classNames) {
    final blocks = <String>[
      [_sectionRule, '# Functions & Function Classes', _sectionRule].join('\n'),
      for (final fn in catalog.functions.values)
        _functionBlock(fn, classNames[fn.name]!),
    ];
    return blocks.join('\n\n\n');
  }

  /// Emits a `FunctionCall` subclass for one catalog function.
  ///
  /// The subclass exists so a call site can be typed by the function it invokes
  /// (a `CheckRule.condition` of `Required` rather than any `FunctionCall`). It
  /// carries no call identifier: correlating a call with a response is a
  /// message-level concern, not a property of an invocation.
  String _functionBlock(AnalysedFunctionApi fn, String className) {
    final params = <String>[];
    final requiredArgs = <String>[];
    final optionalArgs = <String>[];

    for (final MapEntry<String, PropertyDescriptor> entry
        in fn.parameters.entries) {
      final String rawName = entry.key;
      final String pyName = sanitizeIdent(rawName);
      final String pyType = typeToPython(entry.value.type);
      if (entry.value.isRequired) {
        params.add('$pyName: $pyType');
        requiredArgs.add('${_pyString(rawName)}: $pyName');
      } else {
        params.add('$pyName: Optional[$pyType] = None');
        optionalArgs.add(
          '        if $pyName is not None:\n'
          '            args[${_pyString(rawName)}] = $pyName',
        );
      }
    }

    final String doc = _docstring(
      fn.description ?? 'Invokes catalog function ${fn.name}.',
    );

    final initParams = ['*', ...params, '**kwargs: Any'];
    final body = <String>[];
    if (optionalArgs.isEmpty) {
      final argsLiteral = '{${requiredArgs.join(', ')}}';
      body.add(
        _wrapCall(
          indent: 8,
          prefix: 'super().__init__(',
          args: ['call=${_pyString(fn.name)}', 'args=$argsLiteral', '**kwargs'],
          suffix: ')',
        ),
      );
    } else {
      body.add('        args: dict[str, Any] = {${requiredArgs.join(', ')}}');
      body.addAll(optionalArgs);
      body.add(
        _wrapCall(
          indent: 8,
          prefix: 'super().__init__(',
          args: ['call=${_pyString(fn.name)}', 'args=args', '**kwargs'],
          suffix: ')',
        ),
      );
    }

    final classLines = <String>[
      'class $className(FunctionCall):',
      '    $doc',
      '',
      _wrapCall(
        indent: 4,
        prefix: 'def __init__(',
        args: ['self', ...initParams],
        suffix: '):',
      ),
      ...body,
    ];

    return classLines.join('\n');
  }

  /// Renders `prefix(arg, arg)suffix`, breaking one argument per line if
  /// needed.
  String _wrapCall({
    required int indent,
    required String prefix,
    required List<String> args,
    required String suffix,
  }) {
    final String pad = ' ' * indent;
    final oneLine = '$pad$prefix${args.join(', ')}$suffix';
    if (oneLine.length <= _lineWidth) return oneLine;

    final String inner = args.map((a) => '$pad    $a,').join('\n');
    return '$pad$prefix\n$inner\n$pad$suffix';
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------

  String _exportSection(Map<String, String> functionClasses) {
    final names = <String>[
      ...catalog.enums.keys,
      ...catalog.objectModels.keys,
      ...catalog.components.keys,
      ...functionClasses.values,
      ..._runtimeImports.where((n) => n != 'OPEN_ENUM'),
    ];

    final lines = <String>[
      _sectionRule,
      '# Exports',
      _sectionRule,
      '',
      '__all__ = [',
      for (final name in names) '    ${_pyString(name)},',
      ']',
    ];
    return lines.join('\n');
  }
}
