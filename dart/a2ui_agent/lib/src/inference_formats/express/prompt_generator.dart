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

import '../../prompt/generator.dart';
import 'schema_helper.dart';

/// Renders the system prompt snippet teaching a model to write Express for
/// [catalogs].
class ExpressPromptGenerator extends PromptGenerator {
  /// The first of [catalogs] is the default for a surface that does not name
  /// its catalog.
  ExpressPromptGenerator(this.catalogs);

  final List<SchemaCatalog> catalogs;

  /// Throws [A2uiCatalogError] if [catalogs] is empty, since there would be
  /// nothing the model could be told to write.
  @override
  String generate() {
    if (catalogs.isEmpty) {
      throw A2uiCatalogError('An Express prompt needs at least one catalog.');
    }
    final buffer = StringBuffer(_rules);
    if (catalogs.length == 1) {
      buffer
        ..write('\n\n')
        ..write(_catalogSection(CatalogSchemaHelper(catalogs.single), '##'));
      return buffer.toString();
    }
    buffer.write(
      '\n\n## Catalogs\n\n'
      'Components and functions come from the catalogs below. A surface uses '
      'one catalog. The first catalog, `${catalogs.first.id}`, is the default. '
      'To build a surface from another catalog, name it in the surface line, '
      'e.g. surface("my-surface", "${catalogs.last.id}").',
    );
    for (final SchemaCatalog catalog in catalogs) {
      buffer
        ..write('\n\n## Catalog `${catalog.id}`\n\n')
        ..write(_catalogSection(CatalogSchemaHelper(catalog), '###'));
    }
    return buffer.toString();
  }
}

String _catalogSection(CatalogSchemaHelper helper, String heading) =>
    '$heading Positional Component Signatures\n\n'
    'Use these exact positional signatures to instantiate components. Do not '
    'output property keys:\n'
    '${_componentSignatures(helper)}\n\n'
    '$heading Positional Function Signatures\n\n'
    'Use these exact positional signatures to instantiate check rules or '
    'logic functions:\n'
    '${_functionSignatures(helper)}';

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
    signatures.add(['• $name(${arguments.join(', ')})', ...details].join('\n'));
  }
  return signatures.join('\n');
}

String _indent(String text) => text.replaceAll('\n', '\n    ');

/// The Express syntax contract, as the Python SDK words it.
const String _rules = r'''# A2UI Express DSL Output Contract

You must output the user interface using A2UI Express.

IMPORTANT: You MUST always surround the entire A2UI Express block with the sentinel tags `<a2ui>` and `</a2ui>`.

The host compiler will compile your A2UI Express output into the correct JSON envelopes automatically.

## Grammar Rules

1. Component constructors can be assigned to variables or nested inline inside parent component arguments:
   header = ComponentA(prop1="val1")
   root = ComponentB([header, ComponentC("Click", action=Event("submit"))])

   Keyword arguments (`param=value`) and positional arguments with `_` placeholders are supported.

   Variable names MUST start with a letter or underscore, and only contain letters, digits, and underscores.

2. The interface tree must have a single entry point assigned to the reserved variable 'root'.

3. Primitives:
   - Strings: Quoted with `"` or `"""`. Support for `\n`, `\t`, `\\`, and `\"` escapes.
     Raw Strings: Prefaced by `r` (e.g., `r"..."` or `r"""..."""`), with no escape processing.
   - Numbers: write as integers or decimals, e.g., 42
   - Booleans: write true or false
   - Null values: write null
   - Dates & Times: Values for date-time inputs (e.g. in DateTimeInput) must strictly use RFC 3339 format with a timezone offset (e.g. "2026-03-14T00:00:00Z").

4. Lists: represent as arrays, e.g., [child1, child2].

5. Maps: represent as key-value blocks, e.g., {title: "Overview", child: contentCol}. Map keys are always literal strings (dynamic variable resolution is not supported for keys).

6. Data bindings: prefix absolute paths in the data model with '$', e.g., $/user/firstName.
   Prefix relative list scopes with '$', e.g., $firstName.
   A lone '$' represents an empty relative path which resolves to the root of the current context (e.g. inside a template, representing the entire item itself).

7. Logic and validation: prefix client check rules with '?', e.g., ?required or ?regex("^[0-9]{5}$"). To specify a custom error message for validation failures, append it as an extra string argument, e.g. ?regex("^[0-9]{5}$", "Postal code must be 5 digits").

8. Action events: represent server-side actions using the Event helper:
   Event("save_deal", {rep: $/form/rep})

9. Nested functions: call client functions directly using catalog signatures, for example myFunction("value").

10. Data model population: Assign a value directly to an absolute data path (e.g. $/path/to/key = "value") to populate or initialize values inside the shared dataModel. The value can be a primitive, array, or map.

11. Dynamic list templates: If a component expects a template child list, represent it using the _template helper:
    _template($/path/to/list, itemTemplate)
    And define the template component variable on another line, utilizing relative path references prefixed with $:
    itemTemplate = Image($url)

12. To delete a user interface surface, output the standalone `deleteSurface(surfaceId)` command (no variable assignment):
    deleteSurface("dashboard-surface-1")

13. Static properties: Arguments annotated with '(static)' in the signatures below MUST be defined as literal values or arrays inline. You CANNOT use a dynamic data binding path (prefixed by $) for these arguments.

14. Required actions: Parameters named 'action' (or annotated in component signatures) are strictly required. You must pass a valid Event (e.g. Event("click")) or function call. If no specific action is described in the user request, you must provide a dummy click event like Event("click") instead of passing null or omitting the parameter.

15. Surface targeting: Output `surface(surfaceId)` to specify or target a user interface surface:
    surface("dashboard-surface-1")
    root = Card(...)''';
