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

import 'dart:collection';
import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';

import '../../prompt/generator.dart';
import 'server_to_client.g.dart';

const String _defaultWorkflowRules = '''

The generated response MUST follow these rules:
- The response can contain one or more A2UI JSON blocks.
- Each A2UI JSON block MUST be wrapped in `<a2ui-json>` and `</a2ui-json>` tags.
- Between or around these blocks, you can provide conversational text.
- The JSON part MUST be a single, raw JSON object (usually a list of A2UI messages) and MUST validate against the provided A2UI JSON SCHEMA.
- Top-Down Component Ordering: Within the `components` list of a message:
    - The 'root' component MUST be the FIRST element.
    - Parent components MUST appear before their child components.
    This specific ordering allows the streaming parser to yield and render the UI incrementally as it arrives.
''';

const String _schemaBlockStart = '---BEGIN A2UI JSON SCHEMA---';
const String _schemaBlockEnd = '---END A2UI JSON SCHEMA---';
const String _defsRefPrefix = r'#/$defs/';

/// Renders the system prompt snippet teaching a model to write A2UI messages
/// as JSON inside `<a2ui-json>` tags.
class DirectJsonPromptGenerator extends PromptGenerator {
  const DirectJsonPromptGenerator(
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

  /// Renders the output rules and the JSON schemas of the messages, the
  /// common types, and the catalogs [catalogs] declare, pruned to
  /// [allowedMessages], followed by [examples] as JSON payloads.
  ///
  /// Throws [A2uiCatalogError] if [catalogs] is empty or mixes protocol
  /// versions, and [ArgumentError] if [allowedMessages] names an unknown
  /// message type.
  @override
  String generate() {
    if (catalogs.isEmpty) {
      throw A2uiCatalogError(
        'A direct JSON prompt needs at least one catalog.',
      );
    }
    final Set<A2uiProtocolVersion> versions = {
      for (final CatalogApi c in catalogs)
        c.protocolVersion ?? A2uiProtocolVersion.v0_9,
    };
    if (versions.length > 1) {
      throw A2uiCatalogError(
        "The schema prompt's catalogs target different protocol versions: "
        '${versions.map((v) => v.semverValue).toList()..sort()}.',
      );
    }
    final A2uiProtocolVersion version = versions.single;
    Map<String, Object?> a2rSchema = _loadAgentToRendererSchema(version);
    if (allowedMessages != null) {
      a2rSchema = _pruneMessagesSchema(a2rSchema, allowedMessages!);
    }

    final List<Map<String, Object?>> catalogDocs = [
      for (final CatalogApi c in catalogs) c.toJson(),
    ];
    final Map<String, Object?> commonTypesSchema = _pruneCommonTypesSchema(
      PayloadValidator.commonTypesFor(version),
      [...catalogDocs, a2rSchema],
    );

    final schemaSections = <String>[
      _schemaBlockStart,
      '### Agent to Renderer Schema:\n${jsonEncode(a2rSchema)}',
    ];
    final Object? commonDefs = commonTypesSchema[r'$defs'];
    if (commonDefs is Map && commonDefs.isNotEmpty) {
      schemaSections.add(
        '### Common Types Schema:\n${jsonEncode(commonTypesSchema)}',
      );
    }
    for (final Map<String, Object?> catalogDoc in catalogDocs) {
      schemaSections.add('### Catalog Schema:\n${jsonEncode(catalogDoc)}');
    }
    schemaSections.add(_schemaBlockEnd);

    final parts = <String>[
      '## Workflow Description:\n$_defaultWorkflowRules',
      schemaSections.join('\n\n'),
    ];
    if (examples.isNotEmpty) {
      const encoder = JsonEncoder.withIndent('  ');
      final List<String> blocks = [
        for (final List<AgentToRendererMessage> turn in examples)
          '<a2ui-json>\n'
              '${encoder.convert([for (final m in turn) _exampleMessageJson(m)])}\n'
              '</a2ui-json>',
      ];
      parts.add('### Examples:\n${blocks.join('\n\n')}');
    }
    return parts.join('\n\n');
  }
}

Map<String, Object?> _exampleMessageJson(AgentToRendererMessage message) {
  final Map<String, Object?> json = message.toJson();
  if (message is CreateSurfaceMessage && !message.sendDataModel) {
    final Object? create = json['createSurface'];
    if (create is Map<String, Object?>) {
      return <String, Object?>{
        ...json,
        'createSurface': <String, Object?>{
          for (final MapEntry<String, Object?> e in create.entries)
            if (e.key != 'sendDataModel') e.key: e.value,
        },
      };
    }
  }
  return json;
}

Map<String, Object?> _loadAgentToRendererSchema(A2uiProtocolVersion version) {
  switch (version) {
    case A2uiProtocolVersion.v0_9:
      return jsonDecode(serverToClientV0_9Json) as Map<String, Object?>;
    case A2uiProtocolVersion.v0_9_1:
      final schema = jsonDecode(serverToClientV0_9Json) as Map<String, Object?>;
      final Object? defs = schema[r'$defs'];
      if (defs is Map<String, Object?>) {
        for (final Object? defSchema in defs.values) {
          if (defSchema is Map<String, Object?>) {
            final Object? props = defSchema['properties'];
            if (props is Map<String, Object?> && props.containsKey('version')) {
              props['version'] = {
                'enum': ['v0.9', 'v0.9.1'],
              };
            }
          }
        }
      }
      return schema;
    case A2uiProtocolVersion.v1_0:
      return jsonDecode(agentToRendererV1_0Json) as Map<String, Object?>;
  }
}

Set<String> _collectRefs(Object? node) {
  final refs = <String>{};
  if (node is Map) {
    for (final MapEntry<Object?, Object?> entry in node.entries) {
      if (entry.key == r'$ref' && entry.value is String) {
        refs.add(entry.value! as String);
      } else {
        refs.addAll(_collectRefs(entry.value));
      }
    }
  } else if (node is List) {
    for (final Object? item in node) {
      refs.addAll(_collectRefs(item));
    }
  }
  return refs;
}

Map<String, Object?> _reachableDefs(
  Map<String, Object?> defs,
  Iterable<String> roots,
) {
  final reachable = <String>{};
  final queue = Queue<String>.of(roots);
  while (queue.isNotEmpty) {
    final String name = queue.removeFirst();
    if (defs.containsKey(name) && reachable.add(name)) {
      for (final String ref in _collectRefs(defs[name])) {
        if (ref.startsWith(_defsRefPrefix)) {
          queue.add(ref.substring(_defsRefPrefix.length));
        }
      }
    }
  }
  return <String, Object?>{
    for (final MapEntry<String, Object?> entry in defs.entries)
      if (reachable.contains(entry.key)) entry.key: entry.value,
  };
}

Map<String, Object?> _pruneMessagesSchema(
  Map<String, Object?> a2rSchema,
  List<String> allowedMessages,
) {
  final defs = a2rSchema[r'$defs']! as Map<String, Object?>;
  final validMessageTypes = <String>{};
  for (final MapEntry<String, Object?> entry in defs.entries) {
    validMessageTypes.add(entry.key);
    if (entry.value case {'properties': final Map<Object?, Object?> props}) {
      for (final Object? key in props.keys) {
        if (key != 'version' && key is String) validMessageTypes.add(key);
      }
    }
  }
  for (final String name in allowedMessages) {
    if (!validMessageTypes.contains(name)) {
      throw ArgumentError.value(
        allowedMessages,
        'allowedMessages',
        "'$name' is not a supported message type.",
      );
    }
  }

  final allowedDefs = <String>{...allowedMessages};
  for (final MapEntry<String, Object?> entry in defs.entries) {
    if (entry.value case {'properties': final Map<Object?, Object?> props}) {
      if (props.keys.any(allowedDefs.contains)) {
        allowedDefs.add(entry.key);
      }
    }
  }

  return <String, Object?>{
    ...a2rSchema,
    if (a2rSchema['oneOf'] case final List<Object?> oneOf)
      'oneOf': <Object?>[
        for (final Object? item in oneOf)
          if (item case {r'$ref': final String ref}
              when ref.startsWith(_defsRefPrefix) &&
                  allowedDefs.contains(ref.substring(_defsRefPrefix.length)))
            item,
      ],
    r'$defs': _reachableDefs(defs, allowedDefs),
  };
}

Map<String, Object?> _pruneCommonTypesSchema(
  Map<String, Object?> commonTypesSchema,
  List<Map<String, Object?>> referencingSchemas,
) {
  final Object? defs = commonTypesSchema[r'$defs'];
  if (defs is! Map<String, Object?>) return commonTypesSchema;
  final roots = <String>{};
  for (final Map<String, Object?> schema in referencingSchemas) {
    for (final String ref in _collectRefs(schema)) {
      if (ref.contains(r'common_types.json#/$defs/') ||
          ref.startsWith(_defsRefPrefix)) {
        roots.add(ref.split(_defsRefPrefix).last);
      }
    }
  }
  return <String, Object?>{
    ...commonTypesSchema,
    r'$defs': _reachableDefs(defs, roots),
  };
}
