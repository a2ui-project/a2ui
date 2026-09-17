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

import 'package:flutter/material.dart';

import '../model/catalog.dart';
import '../primitives/constants.dart';
import '../primitives/embedded_schemas.g.dart';
import '../primitives/simple_items.dart';

/// Common fragments for prompts, to explain agent behavior.
// This class should not contain technical details.
// Technical details should be communicated in the [PromptBuilder] constructors.
abstract class PromptFragments {
  /// Requirement to acknowledges the user message.
  ///
  /// This is useful for chat-based prompts where the AI should
  /// acknowledge the user's message before responding.
  ///
  /// [prefix] is a prefix to be added to the prompt.
  /// Is useful when you want to emphasize the importance of this fragment.
  static String acknowledgeUser({String prefix = ''}) =>
      '''
${prefix}Your responses should contain acknowledgment of the user message.
'''
          .trim();

  /// Requirement to include at least one submit element.
  ///
  /// This is useful for chat-based prompts where the AI should
  /// include at least one submit element in each response.
  ///
  /// [prefix] is a prefix to be added to the prompt.
  /// Is useful when you want to emphasize the importance of this fragment.
  static String requireAtLeastOneSubmitElement({String prefix = ''}) =>
      '''
${prefix}When you are asking for information from the user, you should always include
at least one submit button of some kind or another submitting element so that
the user can indicate that they are done providing information.
'''
          .trim();

  /// Current date.
  ///
  /// This is useful when AI needs to know the current date.
  ///
  /// [prefix] is a prefix to be added to the prompt.
  /// Is useful when you want to emphasize the importance of this fragment.
  static String currentDate({String prefix = ''}) =>
      '${prefix}Current Date: '
      '${DateTime.now().toIso8601String().split('T').first}';

  /// Restriction on using tools or function calls for UI generation.
  ///
  /// This is useful to communicate limitations of UI generation to the AI.
  ///
  /// [prefix] is a prefix to be added to the prompt.
  /// Is useful when you want to emphasize the importance of this fragment.
  static String uiGenerationRestriction({String prefix = ''}) =>
      '${prefix}Do not use tools or function calls for UI generation. '
      'Use JSON text blocks.\n'
      'Ensure all JSON is valid and fenced with ```json ... ```.';
}

/// A builder for a prompt to generate UI.
// TODO: consider adding operations that incorporate the user message
// and produce a final [ChatMessage].
// TODO: consider supporting non-text parts in system prompt.
abstract class PromptBuilder {
  static const String defaultImportancePrefix = 'IMPORTANT: ';

  const PromptBuilder._();

  /// Creates a chat prompt builder.
  ///
  /// The builder will generate a prompt for a chat session,
  /// that instructs to create new surfaces for each response
  /// and restrict surface deletion and updates.
  static PromptBuilder chat({
    required Catalog catalog,
    Iterable<String> systemPromptFragments = const [],
    String importancePrefix = defaultImportancePrefix,
    JsonMap? clientDataModel,
  }) {
    final ({String commonTypes, String serverToClient}) schemas =
        _loadSchemas();
    return _BasicPromptBuilder(
      catalog: catalog,
      systemPromptFragments: systemPromptFragments,
      allowedOperations: SurfaceOperations.createOnly(dataModel: false),
      importancePrefix: importancePrefix,
      clientDataModel: clientDataModel,
      technicalPossibilities: const TechnicalPossibilities(),
      commonTypesSchema: schemas.commonTypes,
      serverToClientSchema: schemas.serverToClient,
    );
  }

  static PromptBuilder custom({
    required Catalog catalog,
    required SurfaceOperations allowedOperations,
    Iterable<String> systemPromptFragments = const [],
    String importancePrefix = defaultImportancePrefix,
    TechnicalPossibilities technicalPossibilities =
        const TechnicalPossibilities(),
    JsonMap? clientDataModel,
  }) {
    final ({String commonTypes, String serverToClient}) schemas =
        _loadSchemas();
    return _BasicPromptBuilder(
      catalog: catalog,
      systemPromptFragments: systemPromptFragments,
      allowedOperations: allowedOperations,
      importancePrefix: importancePrefix,
      clientDataModel: clientDataModel,
      technicalPossibilities: technicalPossibilities,
      commonTypesSchema: schemas.commonTypes,
      serverToClientSchema: schemas.serverToClient,
    );
  }

  static ({String commonTypes, String serverToClient}) _loadSchemas() {
    return (
      commonTypes: commonTypesSchemaJson,
      serverToClient: serverToClientSchemaJson,
    );
  }

  Iterable<String> systemPrompt();

  /// Returns the system prompt as a single string.
  ///
  /// The prompt sections are trimmed and then
  /// joined with the given section separator.
  String systemPromptJoined({
    String sectionSeparator = '\n-------------------------------------\n\n',
  }) => systemPrompt().map((e) => '${e.trim()}\n').join(sectionSeparator);
}

@visibleForTesting
enum ProtocolMessages {
  createSurface(
    name: 'createSurface',
    explanation: 'Creates a new surface.',
    properties: '''
Requires `surfaceId` (you must always use a unique ID for each created surface),
`catalogId` (use the active catalog ID if provided in system instructions),
and `sendDataModel: true`.
''',
    // TODO: figure out why we instruct AI to always set sendDataModel: true,
    // instead of always sending it deterministically when needed.
    // TODO: generate warning or error if surfaceId is not unique.
  ),
  updateComponents(
    name: 'updateComponents',
    explanation: 'Updates components in a surface.',
    properties: '''
Requires `surfaceId` and a list of `components`.
One component MUST have `id: "root"`.
''',
  ),
  updateDataModel(
    name: 'updateDataModel',
    explanation: 'Updates the data model.',
    properties: '''
Requires `surfaceId`, `path` and `value`.
''',
  ),
  deleteSurface(
    name: 'deleteSurface',
    explanation: 'Deletes a surface.',
    properties: '''
Requires `surfaceId`.
''',
  );

  const ProtocolMessages({
    required this.name,
    required this.explanation,
    required this.properties,
  });

  final String name;
  final String explanation;
  final String properties;

  String get tickedName => '`$name`';

  static String explainMessages(Set<ProtocolMessages> operations) {
    final String names = operations.map((e) => e.tickedName).join(', ');
    final String explanations = operations
        .map((e) => '- ${e.tickedName}: ${e.explanation.trim()}')
        .join('\n');
    final String properties = operations
        .map((e) => '- ${e.tickedName}: ${e.properties.trim()}')
        .join('\n');

    return '''
Supported messages are: $names.

$explanations

Properties:

$properties

''';
  }
}

final class TechnicalPossibilities {
  final bool codeExecution;
  final bool toolCall;
  final bool functionCall;
  final String importancePrefix;

  const TechnicalPossibilities({
    this.codeExecution = false,
    this.toolCall = false,
    this.functionCall = false,
    this.importancePrefix = PromptBuilder.defaultImportancePrefix,
  });

  /// System prompt fragment related to the surface operations.
  ///
  /// This fragment should be added to the system prompt and should be used to
  /// instruct the model on how to use the surface operations.
  Iterable<String> systemPromptFragment() {
    final result = <String>[];

    if (!codeExecution) {
      result.add(
        '${importancePrefix}You do not have the ability to execute code. '
        'If you need to perform calculations, do them yourself.',
      );
    }
    if (!toolCall) {
      result.add(
        '${importancePrefix}You do not have the ability '
        'to use tools for UI generation.',
      );
    }
    if (!functionCall) {
      result.add(
        '${importancePrefix}You do not have the ability '
        'to use function calls for UI generation.',
      );
    }
    return result;
  }
}

/// Pieces of prompt that defines allowed surface operations.
final class SurfaceOperations {
  SurfaceOperations({
    this.create = false,
    this.update = false,
    this.delete = false,
    this.dataModel = false,
  }) : assert(
         create || update || delete,
         'At least one operation must be enabled.',
       );
  SurfaceOperations.createOnly({required bool dataModel})
    : this(create: true, update: false, delete: false, dataModel: dataModel);
  SurfaceOperations.updateOnly({required bool dataModel})
    : this(create: false, update: true, delete: false, dataModel: dataModel);
  SurfaceOperations.createAndUpdate({required bool dataModel})
    : this(create: true, update: true, delete: false, dataModel: dataModel);
  SurfaceOperations.all({required bool dataModel})
    : this(create: true, update: true, delete: true, dataModel: dataModel);

  final bool create;
  final bool update;
  final bool delete;
  final bool dataModel;

  late final _operations = <ProtocolMessages>{
    if (create) ...{
      ProtocolMessages.createSurface,
      ProtocolMessages.updateComponents,
    },
    if (update) ProtocolMessages.updateComponents,
    if (delete) ProtocolMessages.deleteSurface,
    if (dataModel) ProtocolMessages.updateDataModel,
  };

  late final String _operationsFormatted = _operations
      .map((e) => e.tickedName)
      .join(', ');

  late final String _controllingUI = [
    '''
You can control the UI by outputting valid A2UI JSON messages wrapped in markdown code blocks.
    ''',
    ProtocolMessages.explainMessages(_operations),
    if (create)
      '''
To create a new UI:
1. Output a ${ProtocolMessages.createSurface.tickedName} message with a unique `surfaceId` and `catalogId` (use the active catalog ID if provided in system instructions).
2. Output an ${ProtocolMessages.updateComponents.tickedName} message with the `surfaceId` and the component definitions.
''',
    if (!update)
      '''
IMPORTANT: DO NOT update or modify surfaces created in previous turns. If the UI needs to change, you MUST create a NEW surface with a new unique `surfaceId`. You may only use ${ProtocolMessages.updateComponents.tickedName} to populate the components of a freshly created surface.
''',
    if (update)
      '''
To update an existing UI:
1. Output an ${ProtocolMessages.updateComponents.tickedName} message with the existing `surfaceId` and the new component definitions.
''',
  ].map((e) => e.trim()).join('\n\n');

  /// System prompt fragment related to the surface operations.
  ///
  /// This fragment should be added to the system prompt and should be used to
  /// instruct the model on how to use the surface operations.
  late final Iterable<String> systemPromptFragments = () {
    final parts = <String>[];

    parts.add(_fenced(_controllingUI, sectionName: 'CONTROLLING THE UI'));

    parts.add(
      _fenced('''
When constructing UI, you must output a VALID A2UI JSON object representing one of the A2UI message types ($_operationsFormatted).
- You can treat the A2UI schema as a specification for the JSON you typically output.
- The JSON block must be valid and complete.
- Ensure your JSON is fenced with ```json and ```.
''', sectionName: 'OUTPUT FORMAT'),
    );

    return parts;
  }();
}

final class _BasicPromptBuilder extends PromptBuilder {
  /// Creates a prompt builder.
  ///
  /// Even nullable parameters are required for readability, discoverability and
  /// reliability. To skip them, use helper methods of [PromptBuilder].
  const _BasicPromptBuilder({
    required this.catalog,
    required this.systemPromptFragments,
    required this.allowedOperations,
    required this.importancePrefix,
    required this.clientDataModel,
    required this.technicalPossibilities,
    required this.commonTypesSchema,
    required this.serverToClientSchema,
  }) : super._();

  final Catalog catalog;
  final String commonTypesSchema;
  final String serverToClientSchema;

  final SurfaceOperations allowedOperations;

  /// Prefix for important sections of the prompt.
  ///
  /// Sections, generated from the catalog that are marked,
  /// to make sure AI follows them
  /// will be prefixed with this string.
  final String importancePrefix;

  /// Additional system prompt fragments.
  ///
  /// These fragments are added on top of what is provided by the catalog.
  final Iterable<String> systemPromptFragments;

  final JsonMap? clientDataModel;

  final TechnicalPossibilities technicalPossibilities;

  Iterable<String> _fragmentsToPrompt(Iterable<String> fragments) =>
      fragments.map((e) => e.trim());

  @override
  Iterable<String> systemPrompt() {
    final String catalogSchema = _generateCatalogSchema(catalog);

    final String cleanCommonTypes = commonTypesSchema.replaceAll(
      commonTypesSchemaId,
      'common_types.json',
    );
    final String cleanServerToClient = serverToClientSchema.replaceAll(
      commonTypesSchemaId,
      'common_types.json',
    );

    final String? activeCatalogId = catalog.catalogId;

    final fragments = <String>[
      ...systemPromptFragments,
      'Use the provided tools to respond to user using rich UI elements.',
      if (activeCatalogId != null)
        'The active catalog ID is: "$activeCatalogId". '
            'You must use this catalog ID when creating surfaces.',
      ...technicalPossibilities.systemPromptFragment(),
      ...catalog.systemPromptFragments,
      ...allowedOperations.systemPromptFragments,
      _fenced(cleanCommonTypes, sectionName: 'COMMON TYPES'),
      _fenced(catalogSchema, sectionName: 'CATALOG SCHEMA'),
      _fenced(cleanServerToClient, sectionName: 'MESSAGE SCHEMA'),
      ?_encodedDataModel(clientDataModel),
    ];

    return _fragmentsToPrompt(fragments);
  }

  String _generateCatalogSchema(Catalog catalog) {
    final catalogJson = Map<String, dynamic>.from(
      catalog.fullSchema.value as Map<String, dynamic>,
    );

    final Map<String, dynamic> functions = {
      for (final func in catalog.functions)
        func.name: {
          'description': func.description,
          'parameters': func.argumentSchema.value,
          'returnType': func.returnType.value,
        },
    };

    final defs = Map<String, dynamic>.from(
      catalogJson[r'$defs'] as Map<String, dynamic>,
    );
    catalogJson[r'$defs'] = defs;

    if (functions.isNotEmpty) {
      catalogJson['functions'] = functions;
      defs['anyFunction'] = {
        'oneOf': [
          for (final name in functions.keys) {r'$ref': '#/functions/$name'},
        ],
      };
    } else {
      catalogJson.remove('functions');
      defs['anyFunction'] = {'not': <String, dynamic>{}};
    }

    final String json = const JsonEncoder.withIndent('  ').convert(catalogJson);
    return json.replaceAll(commonTypesSchemaId, 'common_types.json');
  }

  static String? _encodedDataModel(JsonMap? clientDataModel) {
    if (clientDataModel == null) return null;
    final String encodedModel = const JsonEncoder.withIndent(
      '  ',
    ).convert(clientDataModel);
    return 'Client Data Model:\n$encodedModel';
  }
}

String _fenced(String content, {required String sectionName}) {
  final String name = sectionName.toUpperCase().replaceAll(' ', '_');
  return '-----${name}_START-----\n'
      '${content.trim()}\n'
      '-----${name}_END-----';
}
