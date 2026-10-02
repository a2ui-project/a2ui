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

// ignore_for_file: avoid_print

import 'dart:convert';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'test_infra/ai_client.dart';
import 'test_infra/login_form.dart';
import 'test_infra/renderer_catalog.dart';

void main() {
  const timeout = Timeout(Duration(minutes: 3));

  late CatalogApi catalog;
  late A2uiRequestProcessor processor;

  setUp(() {
    catalog = loadBasicCatalog();
    // Direct JSON is the default format, so the generator names none.
    processor = A2uiGenerator(
      catalogs: [CatalogConfig(catalog)],
    ).createProcessor(A2uiRendererCapabilities.forCatalogIds([catalog.id]));
  });

  /// Waits for the whole response, then parses it at once with
  /// [A2uiRequestProcessor.parseResponse].
  test(
    'a direct JSON agent turn produces a surface the renderer accepts',
    () async {
      final String llmOutput = await AiClient().send(
        processor.promptSnippet,
        loginFormRequest,
      );

      print('LLM output:\n$llmOutput');

      final List<ResponsePart> parts = processor.parseResponse(llmOutput);
      expectLoginForm(catalog, [
        for (final A2uiPart part in parts.whereType<A2uiPart>()) ...part.a2ui,
      ], llmOutput: llmOutput);
    },
    timeout: timeout,
  );

  /// Parses the response chunk by chunk with [Parser.parseChunk] while it
  /// streams, and hands each part to a renderer as soon as it is parsed.
  ///
  /// The parser returns a message as soon as it is valid JSON and matches the
  /// catalog. While the model keeps writing that message, the parser returns
  /// it again after every chunk that changes it. Each time, it returns the
  /// whole message, from its start to the last complete component, not only
  /// the new part. A message that did not change is not returned again.
  ///
  /// If the model is in the middle of a component, the parser collects chunks
  /// until the component is complete, and then returns the message. There is
  /// one exception, which this test turns on with `progressiveKeys`: a `text`
  /// or `label` string is returned while the model is still writing it, cut
  /// where it stands. This happens only if the rest of the component is
  /// already valid.
  ///
  /// The test passes each message to the renderer. The renderer replaces the
  /// components it already holds with the ones in the message, by id.
  ///
  /// A component can name a child that a later chunk brings. The renderer
  /// runs with [ValidationConfig.relaxed], so it accepts that reference, and
  /// the child fills in when it arrives.
  test(
    'a streamed direct JSON turn builds the surface as it arrives',
    () async {
      final Parser parser = const DirectJsonFormatFactory(
        progressiveKeys: {'text', 'label'},
      ).createFormat(processor.activeCatalogs).createParser();

      // A renderer applying each part as it arrives. A surface is incomplete
      // until the stream ends, so the checks that need a whole surface wait
      // for the end.
      final renderer = MessageProcessor<ComponentApi>(
        catalogs: [rendererCatalog(catalog)],
        protocolVersion: A2uiProtocolVersion.v0_9,
        validationConfig: ValidationConfig.relaxed,
      );
      addTearDown(renderer.groupModel.dispose);

      final llmOutput = StringBuffer();
      var chunks = 0;
      var partsBeforeTheEnd = 0;
      String? surfaceId;
      // The components sent so far, encoded, by surface and id.
      final sentComponents = <String, String>{};
      await for (final String chunk in AiClient().sendStream(
        processor.promptSnippet,
        loginFormRequest,
      )) {
        llmOutput.write(chunk);
        print('\n=== Chunk ${++chunks} from the model:');
        print(chunk.split('\n').map((line) => '  | $line').join('\n'));
        final List<ResponsePart> sent = parser.parseChunk(chunk);
        if (sent.isEmpty) {
          print('Parser kept the chunk and sent nothing.');
          continue;
        }
        print('Parser sent to the renderer:');
        for (final part in sent) {
          switch (part) {
            case TextPart(:final String text):
              print('  text: ${jsonEncode(text)}');
            case A2uiPart(:final List<AgentToRendererMessage> a2ui):
              for (final message in a2ui) {
                print(_describe(message, sentComponents));
              }
              partsBeforeTheEnd++;
              surfaceId ??= a2ui
                  .whereType<CreateSurfaceMessage>()
                  .firstOrNull
                  ?.surfaceId;
              renderer.processMessages(AgentToRendererMessagePayload(a2ui));
          }
        }
      }

      print('LLM output ($partsBeforeTheEnd parts):\n$llmOutput');

      expect(partsBeforeTheEnd, greaterThan(0), reason: '$llmOutput');
      expect(surfaceId, isNotNull, reason: '$llmOutput');
      expectLoginFormSurface(
        renderer.groupModel.getSurface(surfaceId!)!,
        llmOutput: '$llmOutput',
      );

      // The whole response passes the checks a streamed surface skipped.
      final List<ResponsePart> parts = processor.parseResponse('$llmOutput');
      expectLoginForm(catalog, [
        for (final A2uiPart part in parts.whereType<A2uiPart>()) ...part.a2ui,
      ], llmOutput: '$llmOutput');
    },
    timeout: timeout,
  );
}

/// Describes [message] as the parser sent it, for the console.
///
/// The parser sends a message whole each time it changes, so the components
/// of an `updateComponents` are marked new, changed, or unchanged against
/// [sentComponents], which this updates.
String _describe(
  AgentToRendererMessage message,
  Map<String, String> sentComponents,
) {
  final Map<String, Object?> json = message.toJson();
  final String type = json.keys.firstWhere((key) => key != 'version');
  final body = json[type]! as Map<String, Object?>;
  if (body['components'] case final List<Object?> components) {
    final lines = ['  $type, the whole message so far:'];
    for (final Map<String, Object?> component
        in components.cast<Map<String, Object?>>()) {
      final key = '${body['surfaceId']}/${component['id']}';
      final String encoded = jsonEncode(component);
      final String? previous = sentComponents[key];
      sentComponents[key] = encoded;
      lines.add(switch (previous) {
        null => '    ${component['id']}: new $encoded',
        _ when previous == encoded =>
          '    ${component['id']}: unchanged, sent again',
        _ => '    ${component['id']}: changed $encoded',
      });
    }
    return lines.join('\n');
  }
  return '  $type: ${jsonEncode(body)}';
}
