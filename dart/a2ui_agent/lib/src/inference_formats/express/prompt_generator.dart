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

import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';

import '../../prompt/allowed_messages.dart';
import '../../prompt/generator.dart';
import '../../utils/catalogs.dart';
import 'decompiler.dart';
import 'schema_helper.dart';

/// Renders the system prompt snippet teaching a model to write Express for
/// [catalogs].
class ExpressPromptGenerator extends PromptGenerator {
  /// The first of [catalogs] is the default for a surface that does not name
  /// its catalog.
  const ExpressPromptGenerator(
    this.catalogs, {
    this.examples = const [],
    this.allowedMessages,
  });

  /// The catalogs whose components and functions the snippet describes.
  final List<CatalogApi> catalogs;

  /// Example turns the snippet shows the model, in order. Each is the list of
  /// messages making up one turn.
  final List<List<AgentToRendererMessage>> examples;

  /// The message types the model may write, such as `createSurface`, or null
  /// for all of them.
  final List<String>? allowedMessages;

  /// Each of [examples] is shown as the Express block it decompiles to.
  ///
  /// The grammar rules describe only the statements that compile to
  /// [allowedMessages], so without `deleteSurface` the model is not told about
  /// `deleteSurface(...)`.
  ///
  /// From v1.0 the snippet also carries each catalog's `instructions`, with
  /// the JSON examples in them written in Express where they can be, and,
  /// when `callRendererFunction` is allowed, the functions the model may ask
  /// the renderer to run: those the agent may call. With several catalogs it
  /// tells the model how a component or function call names its catalog.
  ///
  /// Throws [A2uiCatalogError] if [catalogs] is empty, since there would be
  /// nothing the model could be told to write, or target different protocol
  /// versions, [ArgumentError] if [allowedMessages] names a message type the
  /// catalogs' version does not have, and [A2uiValidationError] if an example
  /// has no Express notation; see [ExpressDecompiler.decompile].
  @override
  String generate() {
    if (catalogs.isEmpty) {
      throw A2uiCatalogError('An Express prompt needs at least one catalog.');
    }
    final decompiler = ExpressDecompiler(catalogs);
    final A2uiProtocolVersion version = catalogsProtocolVersion(catalogs);
    final bool v1 = version.isAtLeast(A2uiProtocolVersion.v1_0);
    final buffer = StringBuffer(
      _rules(
        resolveAllowedMessages(allowedMessages, version),
        callable: v1 ? _agentCallable(catalogs) : const [],
      ),
    );
    String section(CatalogApi catalog, String heading) => _catalogSection(
      CatalogSchemaHelper(catalog),
      heading,
      instructions: v1 ? _instructions(catalog, decompiler, version) : null,
    );
    if (catalogs.length == 1) {
      buffer
        ..write('\n\n')
        ..write(section(catalogs.single, '##'));
    } else {
      buffer.write(v1 ? _catalogsV1(catalogs) : _catalogsV0_9(catalogs));
      for (final CatalogApi catalog in catalogs) {
        buffer
          ..write('\n\n## Catalog `${catalog.id}`\n\n')
          ..write(section(catalog, '###'));
      }
    }
    if (examples.isNotEmpty) {
      buffer.write(
        '\n\n## Examples\n\n'
        'Each example is one complete response block.',
      );
      for (final List<AgentToRendererMessage> example in examples) {
        buffer.write('\n\n<a2ui>\n${decompiler.decompile(example)}\n</a2ui>');
      }
    }
    return buffer.toString();
  }
}

/// Before v1.0 a surface uses one catalog, which its `surface(...)` line
/// names unless it is the first.
String _catalogsV0_9(List<CatalogApi> catalogs) =>
    '\n\n## Catalogs\n\n'
    'Components and functions come from the catalogs below. A surface '
    'uses one catalog. The first catalog, `${catalogs.first.id}`, is the '
    'default. To build a surface from another catalog, name it in the '
    'surface line, e.g. surface("my-surface", "${catalogs.last.id}").';

/// From v1.0 a surface names no catalog, and each component and function
/// call belongs to the catalog declaring its name, which the model names
/// when several catalogs declare it.
String _catalogsV1(List<CatalogApi> catalogs) {
  final String example = catalogs.last.id;
  final buffer = StringBuffer(
    '\n\n## Catalogs\n\n'
    'Components and functions come from the catalogs below. A surface names '
    'no catalog, so do not name one in the surface line. Each component and '
    'function call, including checks, actions, nested calls and components '
    'written inline, belongs to the catalog that declares its name. When '
    'several catalogs declare a name, say which one you mean with a '
    'catalogId argument, e.g. Name(..., catalogId="$example") for a '
    'component or a function call, or ?check(..., {catalogId: "$example"}) '
    'for a check. Do not add catalogId to any other name.',
  );
  final shared = <String>[];
  for (final (String kind, bool components) in const [
    ('Component', true),
    ('Function', false),
  ]) {
    final Set<String> names = {
      for (final CatalogApi catalog in catalogs)
        ...(components ? catalog.components : catalog.functions).keys,
    };
    for (final String name in names.toList()..sort()) {
      final List<String> declaring = [
        for (final CatalogApi catalog in catalogs)
          if ((components ? catalog.components : catalog.functions).containsKey(
            name,
          ))
            '`${catalog.id}`',
      ];
      if (declaring.length > 1) {
        shared.add('- $kind `$name`: ${declaring.join(', ')}');
      }
    }
  }
  if (shared.isNotEmpty) {
    buffer
      ..write(
        '\n\nThese names are declared by several catalogs and need a '
        'catalogId:\n',
      )
      ..write(shared.join('\n'));
  }
  return buffer.toString();
}

/// The functions of [catalogs] the agent may ask the renderer to run with
/// `callRendererFunction`: those whose `allowedCallers` admits the agent, and
/// which need no user activation, which a call from the agent never has.
List<String> _agentCallable(List<CatalogApi> catalogs) => [
  for (final CatalogApi catalog in catalogs)
    for (final FunctionApi function in catalog.functions.values)
      if (function.allowedCallers != AllowedCallers.rendererOnly &&
          !function.requiresUserActivation)
        function.name,
];

/// The `instructions` of [catalog], with each JSON example of messages in
/// them written as the Express block it decompiles to, or null if it has
/// none.
///
/// An example that is not a list of messages Express can write is kept as it
/// is.
String? _instructions(
  CatalogApi catalog,
  ExpressDecompiler decompiler,
  A2uiProtocolVersion version,
) {
  final String? instructions = catalog.instructions;
  if (instructions == null || instructions.trim().isEmpty) return null;
  return instructions.replaceAllMapped(_jsonBlock, (Match match) {
    final String? express = _express(match[1]!, decompiler, version);
    return express == null ? match[0]! : '```\n<a2ui>\n$express\n</a2ui>\n```';
  });
}

/// A fenced JSON code block, and its content.
final RegExp _jsonBlock = RegExp(r'```json[ \t]*\n([\s\S]*?)\n```');

/// [json], a message or a list of messages of [version], as Express, or null
/// if it is not one or Express cannot write it.
String? _express(
  String json,
  ExpressDecompiler decompiler,
  A2uiProtocolVersion version,
) {
  final Object? decoded;
  try {
    decoded = jsonDecode(json);
  } on FormatException {
    return null;
  }
  final List<Object?> items = decoded is List ? decoded : [decoded];
  if (items.isEmpty || !items.every((i) => i is Map<String, Object?>)) {
    return null;
  }
  try {
    return decompiler.decompile(
      AgentToRendererMessage.parseAll(
        items.cast<Map<String, Object?>>(),
        protocolVersion: version,
      ).messages,
    );
  } on A2uiError {
    return null;
  }
}

String _catalogSection(
  CatalogSchemaHelper helper,
  String heading, {
  String? instructions,
}) {
  final buffer = StringBuffer(
    '$heading Positional Component Signatures\n\n'
    'Use these exact positional signatures to instantiate components. Do not '
    'output property keys:\n'
    '${_componentSignatures(helper)}\n\n'
    '$heading Positional Function Signatures\n\n'
    'Use these exact positional signatures to instantiate check rules or '
    'logic functions:\n'
    '${_functionSignatures(helper)}',
  );
  if (instructions != null) {
    buffer.write('\n\n$heading Catalog Instructions\n\n$instructions');
  }
  return buffer.toString();
}

String _componentSignatures(CatalogSchemaHelper helper) {
  final signatures = <String>[];
  for (final String name in helper.catalog.components.keys.toList()..sort()) {
    final List<String> required = helper.requiredProperties(name);
    final arguments = <String>[];
    final details = <String>[];
    for (final String property in helper.properties(name)) {
      final Map<String, Object?>? schema = helper.propertySchema(
        name,
        property,
      );
      final optional = required.contains(property) ? '' : '?';
      final annotation = isComponentId(schema)
          ? ' (component ID)'
          : isAction(schema)
          ? ' (action)'
          : allowsBinding(schema)
          ? ''
          : ' (static)';
      arguments.add('$property$optional$annotation');
      if (_propertyDetail(property, schema) case final String detail) {
        details.add(detail);
      }
    }
    if (helper.isCheckable(name)) {
      arguments.add('checks?');
      details.add(
        '  - checks: Validation checks on the value, e.g. [?required, ?email].',
      );
    }
    final signature = StringBuffer('• $name(${arguments.join(', ')})');
    if (helper.componentDescription(name) case final String description) {
      signature.write('\n  - Description: ${_indent(description)}');
    }
    for (final detail in details) {
      signature.write('\n$detail');
    }
    signatures.add(signature.toString());
  }
  return signatures.join('\n');
}

/// What the model needs to know about one property beyond its name.
String? _propertyDetail(String property, Map<String, Object?>? schema) {
  if (schema == null) return null;
  final parts = <String>[
    if (schema['description'] case final String description) description,
    if (enumOf(schema) case final List<Object?> values)
      "Must be one of: ${values.map((v) => "'$v'").join(', ')}",
  ];
  final String? keys = switch (schema) {
    {'type': 'object', 'properties': final Map<Object?, Object?> properties} =>
      'Map with keys:\n${_keys(properties)}',
    {'type': 'array', 'items': final Map<Object?, Object?> items} =>
      switch (items) {
        {
          'type': 'object',
          'properties': final Map<Object?, Object?> properties,
        } =>
          'List of maps with keys:\n${_keys(properties)}',
        _ => null,
      },
    _ => null,
  };
  if (parts.isEmpty && keys == null) return null;
  final line = StringBuffer('  - $property: ${parts.join(' ')}');
  if (keys != null) line.write(parts.isEmpty ? keys : '\n    $keys');
  return line.toString();
}

String _keys(Map<Object?, Object?> properties) => [
  for (final MapEntry<Object?, Object?> entry in properties.entries)
    switch (entry.value) {
      {'description': final String description} =>
        '    * ${entry.key} - $description',
      _ => '    * ${entry.key}',
    },
].join('\n');

String _functionSignatures(CatalogSchemaHelper helper) {
  final signatures = <String>[];
  for (final String name in helper.catalog.functions.keys.toList()..sort()) {
    final List<String> required = helper.requiredParameters(name);
    final arguments = <String>[];
    final details = <String>[];
    for (final String parameter in helper.parameters(name)) {
      arguments.add('$parameter${required.contains(parameter) ? '' : '?'}');
      if (helper.parameterSchema(name, parameter)?['description']
          case final String description) {
        details.add('  - $parameter: ${_indent(description)}');
      }
    }
    signatures.add(
      [
        '• $name(${arguments.join(', ')})',
        if (helper.catalog.functions[name]!.description
            case final String description)
          '  - Description: ${_indent(description)}',
        ...details,
      ].join('\n'),
    );
  }
  return signatures.join('\n');
}

String _indent(String text) => text.replaceAll('\n', '\n    ');

/// The Express syntax contract, as the Python SDK words it, except that the
/// examples name no real component, so a pruned one never appears.
/// The output contract and the grammar rules for the [allowed] message types,
/// numbered in order.
///
/// A rule is kept if a statement it describes compiles to an allowed type, or
/// if any statement may use it, such as the rule for strings. The rule for
/// standalone function calls names the [callable] functions, and is left out
/// when there are none.
String _rules(List<String> allowed, {required List<String> callable}) {
  final bool creates = allowed.contains('createSurface');
  final bool components = creates || allowed.contains('updateComponents');
  final bool data = allowed.contains('updateDataModel');
  final rules = <String>[
    if (components) _componentsRule,
    if (creates) _rootRule,
    ..._valueRules,
    if (components) ..._callRules,
    if (data) _dataModelRule,
    if (components) _templateRule,
    if (allowed.contains('deleteSurface')) _deleteSurfaceRule,
    if (allowed.contains('callRendererFunction') && callable.isNotEmpty)
      _rendererCallRule(callable),
    if (components) ..._argumentRules,
    if (components || data)
      creates ? '$_surfaceRule\nroot = ComponentB(...)' : _surfaceRule,
  ];
  final buffer = StringBuffer(_contract);
  for (final (int i, String rule) in rules.indexed) {
    final number = '${i + 1}. ';
    // Continuation lines line up with the text after the number.
    final String body = rule.replaceAll(
      RegExp(r'\n(?!\n)'),
      '\n${' ' * number.length}',
    );
    buffer.write('\n\n$number$body');
  }
  return buffer.toString();
}

const String _contract = '''# A2UI Express DSL Output Contract

You must output the user interface using A2UI Express.

IMPORTANT: You MUST always surround the entire A2UI Express block with the literal sentinel tags `<a2ui>` and `</a2ui>` (always include both the opening and closing tags; do NOT wrap the tags in backticks or replace the opening tag with a markdown code fence such as ```a2ui).

The host compiler will compile your A2UI Express output into the correct JSON envelopes automatically.

## Grammar Rules''';

const String _componentsRule =
    '''Component constructors can be assigned to variables or nested inline inside parent component arguments:
header = ComponentA(prop1="val1")
root = ComponentB([header, ComponentC("Click", action=Event("submit"))])

Keyword arguments (`param=value`) and positional arguments with `_` placeholders are supported.

Variable names MUST start with a letter or underscore, and only contain letters, digits, and underscores.''';

const String _rootRule =
    'The interface tree must have a single entry point assigned to the '
    "reserved variable 'root'.";

const List<String> _valueRules = [
  r'''Primitives:
- Strings: Quoted with `"` or `"""`. Support for `\n`, `\t`, `\\`, and `\"` escapes.
  Raw Strings: Prefaced by `r` (e.g., `r"..."` or `r"""..."""`), with no escape processing.
- Numbers: write as integers or decimals, e.g., 42
- Booleans: write true or false
- Null values: write null
- Dates & Times: Values for date-time inputs (e.g. in DateTimeInput) must strictly use RFC 3339 format with a timezone offset (e.g. "2026-03-14T00:00:00Z").''',
  'Lists: represent as arrays, e.g., [child1, child2].',
  'Maps: represent as key-value blocks, e.g., {title: "Overview", child: '
      'contentCol}. Map keys are always literal strings (dynamic variable '
      'resolution is not supported for keys).',
  r'''Data bindings: prefix absolute paths in the data model with '$', e.g., $/user/firstName.
Prefix relative list scopes with '$', e.g., $firstName.
A lone '$' represents an empty relative path which resolves to the root of the current context (e.g. inside a template, representing the entire item itself).''',
];

const List<String> _callRules = [
  r'''Logic and validation: prefix client check rules with '?', e.g., ?required or ?regex("^[0-9]{5}$"). To specify a custom error message for validation failures, append it as an extra string argument, e.g. ?regex("^[0-9]{5}$", "Postal code must be 5 digits").''',
  r'''Action events: represent server-side actions using the Event helper:
Event("save_deal", {rep: $/form/rep})''',
  'Nested functions: call client functions directly using catalog '
      'signatures, for example myFunction("value").',
];

const String _dataModelRule =
    r'Data model population: Assign a value directly to an absolute data path (e.g. $/path/to/key = "value") to populate or initialize values inside the shared dataModel. The value can be a primitive, array, or map.';

const String _templateRule =
    r'''Dynamic list templates: If a component expects a template child list, represent it using the _template helper:
_template($/path/to/list, itemTemplate)
And define the template component variable on another line, utilizing relative path references prefixed with $:
itemTemplate = Image($url)''';

const String _deleteSurfaceRule =
    '''To delete a user interface surface, output the standalone `deleteSurface(surfaceId)` command (no variable assignment):
deleteSurface("dashboard-surface-1")''';

String _rendererCallRule(List<String> callable) =>
    '''To have the renderer run a function right away, output the call as a standalone command (no variable assignment):
${callable.first}(...)
Only these functions can be called this way: ${callable.map((f) => '`$f`').join(', ')}.''';

const List<String> _argumentRules = [
  "Static properties: Arguments annotated with '(static)' in the "
      'signatures below MUST be defined as literal values or arrays inline. '
      r'You CANNOT use a dynamic data binding path (prefixed by $) for these '
      'arguments.',
  '''Required actions: Parameters named 'action' (or annotated in component signatures) are strictly required. You must pass a valid Event (e.g. Event("click")) or function call. If no specific action is described in the user request, you must provide a dummy click event like Event("click") instead of passing null or omitting the parameter.''',
];

const String _surfaceRule =
    '''Surface targeting: Output `surface(surfaceId)` to specify or target a user interface surface:
surface("dashboard-surface-1")''';
