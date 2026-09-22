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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

class _OtherFormatFactory extends InferenceFormatFactory {
  const _OtherFormatFactory();
}

void main() {
  final SchemaCatalog a = SchemaCatalog(
    id: 'https://example.com/a.json',
    components: [],
  );
  final SchemaCatalog b = SchemaCatalog(
    id: 'https://example.com/b.json',
    components: [],
  );

  A2uiGenerator generator({
    InferenceFormatFactory format = const ExpressFormatFactory(),
  }) => A2uiGenerator(
    catalogs: [CatalogConfig(a), CatalogConfig(b)],
    inferenceFormatFactory: format,
  );

  group('A2uiGenerator.createProcessor', () {
    test('activates supported catalogs in the renderer preference order', () {
      final A2uiRequestProcessor processor = generator().createProcessor(
        A2uiRendererCapabilities.forCatalogIds([
          b.id,
          'https://example.com/unknown.json',
          a.id,
          b.id,
        ]),
      );
      expect(processor.activeCatalogs, [b, a]);
    });

    test('rejects a renderer supporting no registered catalog', () {
      expect(
        () => generator().createProcessor(
          A2uiRendererCapabilities.forCatalogIds([
            'https://example.com/unknown.json',
          ]),
        ),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('rejects a format other than Express', () {
      expect(
        () => generator(
          format: const _OtherFormatFactory(),
        ).createProcessor(A2uiRendererCapabilities.forCatalogIds([a.id])),
        throwsUnsupportedError,
      );
    });
  });

  group('A2uiRequestProcessor.parseResponse', () {
    final processor = A2uiRequestProcessor(
      activeCatalogs: [a],
      formatFactory: const ExpressFormatFactory(),
    );

    test('rejects a direct JSON payload', () {
      expect(
        () => processor.parseResponse('Here: <a2ui-json>[]</a2ui-json>'),
        throwsA(isA<A2uiParseError>()),
      );
    });
  });
}
