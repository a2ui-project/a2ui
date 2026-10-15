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

/// Dart bridge runner for evaluating `package:a2ui_agent`.
///
/// Reads a JSON request from stdin and writes a JSON response to stdout.
library;

// ignore_for_file: depend_on_referenced_packages

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';

bool _isVersionAtLeast1_0(Object? versionStr) =>
    versionStr is String && compareVersions(versionStr, '1.0') >= 0;

/// Lowers a v1.0 catalog document to v0.9 so `package:a2ui_agent` can load it.
Map<String, Object?> _lowerCatalogDocument(Map<String, Object?> document) {
  if (!_isVersionAtLeast1_0(document['protocolVersion'])) {
    return {...document};
  }
  return {
    ...document,
    'protocolVersion': '0.9',
    if (document['functions'] case final Map<Object?, Object?> functions)
      'functions': {
        for (final MapEntry<Object?, Object?> entry in functions.entries)
          entry.key.toString(): switch (entry.value) {
            final Map<Object?, Object?> fn => {
              ...fn,
              if (fn['returnType'] == 'validationResult')
                'returnType': 'boolean',
              if (fn['properties'] case final Map<Object?, Object?> props
                  when (props['returnType'] as Map?)?['const'] ==
                      'validationResult')
                'properties': {
                  ...props,
                  'returnType': {'const': 'boolean'},
                },
            },
            final Object? other => other,
          },
      },
  };
}

CatalogApi _loadCatalog(String resolvedCatalogPath) {
  final String text = File(resolvedCatalogPath).readAsStringSync();
  final rawDoc = jsonDecode(text) as Map<String, Object?>;
  final Map<String, Object?> doc = _lowerCatalogDocument(rawDoc);
  final String? fallbackId = doc['catalogId'] != null
      ? null
      : (doc[r'$id']?.toString() ?? 'https://a2ui.org/eval/default_catalog');

  final provider = InMemoryCatalogProvider(
    doc,
    protocolVersion: A2uiProtocolVersion.v0_9,
    catalogId: fallbackId,
  );
  return CatalogConfig(provider.load()).transformedCatalog;
}

InferenceFormat _createStrategy(String formatName, CatalogApi catalog) {
  if (formatName == 'direct_json') {
    return const DirectJsonFormatFactory().createFormat([catalog]);
  }
  if (formatName == 'express') {
    return const ExpressFormatFactory().createFormat([catalog]);
  }
  throw ArgumentError('Unknown format strategy for Dart SDK: $formatName');
}

Map<String, Object?> _cleanMessageJson(AgentToRendererMessage message) {
  final Map<String, Object?> json = message.toJson();
  if (message is CreateSurfaceMessage && !message.sendDataModel) {
    final Object? create = json['createSurface'];
    if (create is Map) {
      return <String, Object?>{
        ...json,
        'createSurface': <String, Object?>{
          for (final MapEntry<String, Object?> e
              in create.cast<String, Object?>().entries)
            if (e.key != 'sendDataModel') e.key: e.value,
        },
      };
    }
  }
  return json;
}

class _SignatureOnlyFunction extends FunctionImplementation {
  _SignatureOnlyFunction(FunctionApi api)
    : super(
        name: api.name,
        argumentSchema: api.argumentSchema,
        returnType: api.returnType,
        description: api.description,
        allowedCallers: api.declaredAllowedCallers,
        requiresUserActivation: api.declaredRequiresUserActivation,
        definition: api.definition,
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) => throw UnsupportedError(
    "Function '$name' is a signature only and cannot be invoked.",
  );
}

Catalog<ComponentApi, FunctionImplementation> _signedCatalog(
  CatalogApi catalog,
) => catalog.withFunctions(
  catalog.functions.values.map(_SignatureOnlyFunction.new),
);

Future<void> main() async {
  try {
    final String rawInput = await utf8.decoder.bind(stdin).join();
    final req = jsonDecode(rawInput) as Map<String, Object?>;
    final action = req['action']! as String;
    final formatName = req['format_name']! as String;
    final resolvedCatalogPath = req['resolved_catalog_path']! as String;
    final String completion = (req['completion'] as String?) ?? '';
    final bool requireCompleteTags =
        (req['require_complete_tags'] as bool?) ?? false;

    final CatalogApi catalog = _loadCatalog(resolvedCatalogPath);
    final InferenceFormat strategy = _createStrategy(formatName, catalog);

    if (action == 'generate_prompt') {
      final String prompt = strategy.promptGenerator.generate();
      stdout.write(jsonEncode({'result': prompt}));
      return;
    }

    if (action == 'parse_and_validate') {
      final Parser parser = strategy.createParser();
      if (requireCompleteTags &&
          !parser.hasFormatContent(completion, complete: true)) {
        if (formatName == 'direct_json') {
          throw StateError(
            "A2UI tags '<a2ui-json>' and '</a2ui-json>' not found in response.",
          );
        }
        throw StateError(
          "A2UI tags '<a2ui>' and '</a2ui>' not found in response.",
        );
      }

      final List<ResponsePart> parts = parser.parseResponse(completion);
      final compiledMessages = <AgentToRendererMessage>[];
      final compiledJsons = <Map<String, Object?>>[];
      final serializedParts = <Map<String, Object?>>[];

      for (final part in parts) {
        switch (part) {
          case TextPart(:final String text):
            serializedParts.add({'text': text, 'a2ui_json': null});
          case A2uiPart(:final List<AgentToRendererMessage> a2ui):
            final List<Map<String, Object?>> msgDicts = [
              for (final AgentToRendererMessage m in a2ui) _cleanMessageJson(m),
            ];
            serializedParts.add({'text': '', 'a2ui_json': msgDicts});
            compiledMessages.addAll(a2ui);
            compiledJsons.addAll(msgDicts);
        }
      }

      if (compiledMessages.isEmpty) {
        if (formatName == 'direct_json') {
          throw StateError(
            'No A2UI JSON found in response (tags missing or empty)',
          );
        }
        throw StateError(
          'No compiled A2UI $formatName user interface found in parsed parts.',
        );
      }

      final renderer = MessageProcessor<ComponentApi>(
        catalogs: [_signedCatalog(catalog)],
        defaultVersion: A2uiProtocolVersion.v0_9,
        validationConfig: ValidationConfig.strict,
      );
      try {
        renderer.processMessages(
          AgentToRendererMessagePayload(compiledMessages),
        );
      } finally {
        renderer.model.dispose();
      }

      stdout.write(
        jsonEncode({
          'result': {'compiled_jsons': compiledJsons, 'parts': serializedParts},
        }),
      );
      return;
    }

    throw ArgumentError('Unsupported bridge action: $action');
  } on Object catch (err, stackTrace) {
    stdout.write(jsonEncode({'error': '$err\n$stackTrace'.trim()}));
  }
}
