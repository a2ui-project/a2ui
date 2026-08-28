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

import '../test_catalogs.dart';

/// Marks behaviour the EXPRESS format does not implement yet: it is selectable
/// through [InferenceFormatFactory], but its grammar is still to be written.
const String pendingExpress = 'The EXPRESS format is not implemented yet.';

const String expressSource = 'createSurface(s1, "$basicCatalogId")';

void main() {
  group('ExpressFormatFactory', () {
    test('builds a format bound to the given catalogs', () {
      final ExpressFormat<CatalogComponent, CatalogFunction> format =
          const ExpressFormatFactory<CatalogComponent, CatalogFunction>()
              .createFormat([smallCatalog()]);

      expect(format, isA<ExpressFormat<CatalogComponent, CatalogFunction>>());
      expect(format.catalogs, hasLength(1));
    });

    test('passes examples through to the prompt generator', () {
      final examples = <String, List<A2uiMessage>>{
        'a greeting': [
          CreateSurfaceMessage(surfaceId: 's1', catalogId: basicCatalogId),
        ],
      };

      final ExpressFormat<CatalogComponent, CatalogFunction> format =
          const ExpressFormatFactory<CatalogComponent, CatalogFunction>()
              .createFormat([smallCatalog()], examples: examples);

      expect(format.promptGenerator.examples, same(examples));
    });

    test('is interchangeable with the DIRECT_JSON factory', () {
      final factories =
          <InferenceFormatFactory<CatalogComponent, CatalogFunction>>[
            const DirectJsonFormatFactory(),
            const ExpressFormatFactory(),
          ];

      for (final factory in factories) {
        expect(
          factory.createFormat([smallCatalog()]).promptGenerator.catalogs,
          hasLength(1),
        );
      }
    });
  });

  group('ExpressFormat', () {
    test('creates a fresh parser for each turn', () {
      final format = ExpressFormat<CatalogComponent, CatalogFunction>([
        smallCatalog(),
      ]);

      final Parser first = format.createParser();

      expect(first, isA<ExpressParser<CatalogComponent, CatalogFunction>>());
      expect(identical(first, format.createParser()), isFalse);
    });
  });

  group('ExpressPromptGenerator', () {
    test('renders compact positional signatures for the catalog', () {
      final String prompt =
          ExpressPromptGenerator<CatalogComponent, CatalogFunction>([
            smallCatalog(),
          ]).generate();

      expect(prompt, contains(a2uiExpressOpenTag));
      expect(prompt, contains('Text'));
      expect(prompt, contains('Card'));
    }, skip: pendingExpress);
  });

  group('ExpressCompiler', () {
    test('compiles a DSL expression into A2UI messages', () {
      final List<A2uiMessage> messages =
          ExpressCompiler<CatalogComponent, CatalogFunction>(
            catalogs: [basicCatalog()],
          ).compile(expressSource);

      expect(messages.single, isA<CreateSurfaceMessage>());
    }, skip: pendingExpress);

    test('rejects a malformed expression', () {
      expect(
        () => ExpressCompiler<CatalogComponent, CatalogFunction>(
          catalogs: [basicCatalog()],
        ).compile('createSurface('),
        throwsA(isA<A2uiCompileError>()),
      );
    }, skip: pendingExpress);

    test('rejects a component the active catalogs do not declare', () {
      expect(
        () => ExpressCompiler<CatalogComponent, CatalogFunction>(
          catalogs: [smallCatalog()],
        ).compile('Video(v1, "https://example.com/clip.mp4")'),
        throwsA(isA<A2uiValidationError>()),
      );
    }, skip: pendingExpress);
  });

  group('ExpressDecompiler', () {
    test('renders A2UI messages back into DSL notation', () {
      final String rendered =
          ExpressDecompiler<CatalogComponent, CatalogFunction>(
            catalogs: [basicCatalog()],
          ).decompile([
            CreateSurfaceMessage(surfaceId: 's1', catalogId: basicCatalogId),
          ]);

      expect(rendered, contains('createSurface'));
    }, skip: pendingExpress);
  });

  group('ExpressParser', () {
    test('declares streaming support', () {
      expect(
        ExpressParser<CatalogComponent, CatalogFunction>(
          catalogs: [smallCatalog()],
        ).supportsStreaming,
        isTrue,
      );
    });

    test('builds a compiler and decompiler over the same catalogs', () {
      final parser = ExpressParser<CatalogComponent, CatalogFunction>(
        catalogs: [smallCatalog()],
      );

      expect(parser.compiler.catalogs, same(parser.catalogs));
      expect(parser.decompiler.catalogs, same(parser.catalogs));
    });

    test('unwraps payloads from a2ui-express tags', () {
      final List<RawResponsePart> parts =
          ExpressParser<CatalogComponent, CatalogFunction>(
            catalogs: [basicCatalog()],
          ).unwrap('Hi\n$a2uiExpressOpenTag$expressSource$a2uiExpressCloseTag');

      expect(parts, hasLength(2));
      expect(parts.first.part, const TextPart('Hi'));
    }, skip: pendingExpress);

    test('delegates compilation to the compiler', () {
      final List<A2uiMessage> messages =
          ExpressParser<CatalogComponent, CatalogFunction>(
            catalogs: [basicCatalog()],
          ).compile(expressSource);

      expect(messages.single, isA<CreateSurfaceMessage>());
    }, skip: pendingExpress);

    test('delegates decompilation to the decompiler', () {
      final String rendered =
          ExpressParser<CatalogComponent, CatalogFunction>(
            catalogs: [basicCatalog()],
          ).decompile([
            CreateSurfaceMessage(surfaceId: 's1', catalogId: basicCatalogId),
          ]);

      expect(rendered, contains('createSurface'));
    }, skip: pendingExpress);

    test('processes streamed chunks', () {
      final parser = ExpressParser<CatalogComponent, CatalogFunction>(
        catalogs: [basicCatalog()],
      );

      expect(parser.parseChunk('Hello'), [const TextPart('Hello')]);
    }, skip: pendingExpress);

    test('rejects a message declaring another protocol version', () {
      expect(
        () => ExpressParser<CatalogComponent, CatalogFunction>(
          catalogs: [basicCatalog()],
        ).compile('createSurface(s1, "$basicCatalogId", version: "v1.0")'),
        throwsA(isA<A2uiValidationError>()),
      );
    }, skip: pendingExpress);
  });

  group('EXPRESS constants', () {
    test('name the sentinel tags the format uses', () {
      expect(a2uiExpressOpenTag, '<a2ui-express>');
      expect(a2uiExpressCloseTag, '</a2ui-express>');
    });
  });
}
