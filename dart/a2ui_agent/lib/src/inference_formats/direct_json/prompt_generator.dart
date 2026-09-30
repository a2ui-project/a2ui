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

import '../../prompt/generator.dart';
import 'parser.dart';
import 'server_to_client.g.dart';

/// The v0.9 message types, in the order the prompt describes them.
const List<String> _messageTypes = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
];

/// Renders the system prompt snippet teaching a model to write A2UI messages
/// as JSON inside `<a2ui-json>` tags.
class DirectJsonPromptGenerator extends PromptGenerator {
  const DirectJsonPromptGenerator(
    this.catalogs, {
    this.examples = const [],
    this.allowedMessages,
  });

  /// The catalogs whose components and functions the snippet describes.
  final List<SchemaCatalog> catalogs;

  /// Example turns the snippet shows the model, in order. Each is the list of
  /// messages making up one turn.
  final List<List<AgentToRendererMessage>> examples;

  /// The message types the model may write, such as `createSurface`, or null
  /// for all of them.
  final List<String>? allowedMessages;

  /// Renders the output rules and the JSON schemas of the messages, the
  /// components and the functions [catalogs] declare, pruned to
  /// [allowedMessages], followed by [examples] as JSON payloads.
  ///
  /// Throws [A2uiCatalogError] if [catalogs] is empty, since there would be
  /// nothing the model could be told to write, and [ArgumentError] if
  /// [allowedMessages] names a message type v0.9 does not have.
  @override
  String generate() {
    if (catalogs.isEmpty) {
      throw A2uiCatalogError(
        'A direct JSON prompt needs at least one catalog.',
      );
    }
    final List<String> allowed = _allowed();
    final buffer = StringBuffer(_rules(allowed))
      ..write('\n\n## Message schema\n\n')
      ..write(
        'Each message matches this schema. In it, `catalog.json` stands for '
        'the catalog the surface names.\n\n',
      )
      ..write(_schemaBlock(_messageSchema(allowed)))
      ..write('\n\n## Common types\n\n')
      ..write(
        'The message and catalog schemas refer to these definitions as '
        '`common_types.json`.\n\n',
      )
      ..write(
        _schemaBlock(PayloadValidator.commonTypesFor(A2uiProtocolVersion.v0_9)),
      );
    if (catalogs.length > 1) {
      buffer.write(
        '\n\n## Catalogs\n\n'
        'A surface uses the catalog its createSurface names. The catalogs, '
        'in order of preference: '
        '${catalogs.map((c) => '`${c.id}`').join(', ')}.',
      );
    }
    for (final SchemaCatalog catalog in catalogs) {
      buffer
        ..write('\n\n## Catalog `${catalog.id}`\n\n')
        ..write(_schemaBlock(catalog.catalogSchema));
    }
    if (examples.isNotEmpty) {
      final parser = DirectJsonParser(catalogs);
      buffer.write(
        '\n\n## Examples\n\n'
        'Each example is one complete payload.',
      );
      for (final List<AgentToRendererMessage> example in examples) {
        buffer.write(
          '\n\n<a2ui-json>\n${parser.decompile(example)}\n</a2ui-json>',
        );
      }
    }
    return buffer.toString();
  }

  List<String> _allowed() {
    final List<String>? allowed = allowedMessages;
    if (allowed == null) return _messageTypes;
    for (final String type in allowed) {
      if (!_messageTypes.contains(type)) {
        throw ArgumentError.value(
          allowedMessages,
          'allowedMessages',
          "'$type' is not a v0.9 message type. The types are: "
              '${_messageTypes.join(', ')}',
        );
      }
    }
    return [
      for (final String type in _messageTypes)
        if (allowed.contains(type)) type,
    ];
  }
}

/// The v0.9 message schema, describing only the [allowed] message types.
Map<String, Object?> _messageSchema(List<String> allowed) {
  final schema = jsonDecode(serverToClientV0_9Json) as Map<String, Object?>;
  final defs = schema[r'$defs']! as Map<String, Object?>;
  final removed = <String>{
    for (final MapEntry<String, Object?> def in defs.entries)
      if (_messageType(def.value) case final String type
          when !allowed.contains(type))
        def.key,
  };
  defs.removeWhere((String name, _) => removed.contains(name));
  schema['oneOf'] = [
    for (final Object? option in schema['oneOf']! as List<Object?>)
      if (option case {
        r'$ref': final String ref,
      } when !removed.contains(ref.substring(ref.lastIndexOf('/') + 1)))
        option,
  ];
  return schema;
}

/// The message type a definition of the message schema describes, or null.
String? _messageType(Object? definition) {
  if (definition case {'properties': final Map<Object?, Object?> properties}) {
    for (final Object? key in properties.keys) {
      if (_messageTypes.contains(key)) return key! as String;
    }
  }
  return null;
}

String _schemaBlock(Map<String, Object?> schema) =>
    '<a2ui_schema>\n${jsonEncode(schema)}\n</a2ui_schema>';

String _rules(List<String> allowed) {
  final String types = allowed.map((t) => '`$t`').join(', ');
  final descriptions = [
    if (allowed.contains('createSurface'))
      '`createSurface` starts a surface and names the catalog its components '
          'come from.',
    if (allowed.contains('updateComponents'))
      '`updateComponents` adds components to a surface, or replaces them by '
          'id, as a flat list. One component has the id `root`, and every '
          'other component is reached from it. A component refers to another '
          'by its id.',
    if (allowed.contains('updateDataModel'))
      '`updateDataModel` sets the value at a JSON Pointer `path` in the data '
          'model of a surface. Without a path it replaces the whole data '
          'model.',
    if (allowed.contains('deleteSurface')) '`deleteSurface` removes a surface.',
  ];
  return '''
# A2UI JSON Output Contract

You must output the user interface as A2UI messages written in JSON.

IMPORTANT: You MUST always surround each JSON payload with the sentinel tags `<a2ui-json>` and `</a2ui-json>`. Text outside the tags is shown to the user as conversation.

## Rules

1. A payload is a JSON array of messages, which the renderer applies in order.

2. Each message is an object with `"version": "v0.9"` and exactly one of these keys: $types.
${[for (final String d in descriptions) '   $d'].join('\n')}

3. Use only the components and functions of the catalogs below, with only the properties their schemas declare.

4. Bind a value to the data model with `{"path": "/absolute/path"}`. Inside a template, a path without a leading slash is relative to the current item.

5. Call a catalog function with `{"call": "functionName", "args": {...}}`.

6. Write plain JSON: double quotes, no comments and no trailing commas.''';
}
