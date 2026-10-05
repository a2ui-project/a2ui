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
import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_core/src/validation/component_refs.dart';
import 'package:test/test.dart';

import 'conformance/conformance_harness.dart';
import 'support/renderer_catalog.dart';

/// Exercises payload validation against the published basic catalog and the
/// example payloads that ship with it, rather than against a catalog written
/// for the test. Those examples are the specification's own statement of what
/// a valid v0.9 payload looks like, so they are the sharpest available check
/// that validation is neither too strict nor too permissive.

typedef _RendererCatalog = Catalog<ComponentApi, FunctionImplementation>;

Map<String, Object?> _readJson(String relativePath) =>
    jsonDecode(File(resolveConformancePath(relativePath)).readAsStringSync())
        as Map<String, Object?>;

Map<String, Object?> basicCatalogDocument() =>
    _readJson('../specification/v0_9_1/catalogs/basic/catalog.json');

void main() {
  group('the basic catalog', () {
    test('declares the child references of its layout components', () {
      final CatalogApi catalog = Catalog.fromJson(basicCatalogDocument());
      final Map<String, ComponentRefFields> refs = extractComponentRefFields(
        catalog,
      );

      expect(refs['Card']!.single, {'child'});
      expect(refs['Button']!.single, {'child'});
      expect(refs['Modal']!.single, {'trigger', 'content'});
      expect(refs['Row']!.list, {'children'});
      expect(refs['Column']!.list, {'children'});
      expect(refs['List']!.list, {'children'});
      expect(refs['Tabs']!.list, {'tabs'});
      expect(refs['Tabs']!.nested, {
        'tabs': {'child'},
      });
      // Components that reference nothing are absent, not empty entries.
      expect(refs.keys, isNot(contains('Text')));
      expect(refs.keys, isNot(contains('Image')));
    });
  });

  group('BasicCatalog child references', () {
    for (final (String label, _RendererCatalog catalog, String? skip) in [
      ('v0.9', BasicCatalog.v0_9(), null),
      (
        'v1.0',
        BasicCatalog.v1_0(),
        'Child references are found through `ComponentId` and '
            '`ChildList`, not the v1.0 `Child` type yet.',
      ),
    ]) {
      test('$label declares the child references of its layout components',
          skip: skip, () {
        final Map<String, ComponentRefFields> refs = extractComponentRefFields(
          catalog,
        );

        expect(refs['Card']!.single, {'child'});
        expect(refs['Button']!.single, {'child'});
        expect(refs['Modal']!.single, {'trigger', 'content'});
        expect(refs['Row']!.list, {'children'});
        expect(refs['Column']!.list, {'children'});
        expect(refs['List']!.list, {'children'});
        expect(refs['Tabs']!.list, {'tabs'});
        expect(refs['Tabs']!.nested, {
          'tabs': {'child'},
        });
        expect(refs.keys, isNot(contains('Text')));
      });
    }
  });

  _registerExamples(
    'the v0.9.1 basic catalog examples against the v0.9.1 document',
    '../specification/v0_9_1/catalogs/basic/examples',
    () => rendererCatalog(basicCatalogDocument()),
    A2uiProtocolVersion.v0_9,
  );
  _registerExamples(
    'the v0.9 basic catalog examples against BasicCatalog.v0_9()',
    '../specification/v0_9/catalogs/basic/examples',
    BasicCatalog.v0_9,
    A2uiProtocolVersion.v0_9,
  );
  _registerExamples(
    'the v1.0 basic catalog examples against BasicCatalog.v1_0()',
    '../catalogs/basic/v1/examples',
    BasicCatalog.v1_0,
    A2uiProtocolVersion.v1_0,
    skip: 'The v1.0 common types the v1.0 component schemas '
        'reference are not embedded yet.',
  );
}

/// Registers a test per example payload in [directory], each processed by a
/// [MessageProcessor] over the catalog [catalog] builds.
void _registerExamples(
  String description,
  String directory,
  _RendererCatalog Function() catalog,
  A2uiProtocolVersion version, {
  String? skip,
}) {
  group(description, skip: skip, () {
    final examples = Directory(resolveConformancePath(directory));
    final List<File> files = examples.listSync().whereType<File>().where((f) {
      return f.path.endsWith('.json');
    }).toList()
      ..sort((a, b) => a.path.compareTo(b.path));

    test('the examples are present', () {
      expect(files, isNotEmpty, reason: examples.path);
    });

    for (final file in files) {
      final String name = file.uri.pathSegments.last;
      test(name, () async {
        final Object? document = jsonDecode(file.readAsStringSync());
        final Object? messages =
            document is Map ? document['messages'] : document;
        expect(
          messages,
          isA<List<Object?>>(),
          reason: '$name declares no message list',
        );
        final List<Map<String, Object?>> payload = [
          for (final Object? message in messages! as List<Object?>)
            (message! as Map).cast<String, Object?>(),
        ];

        // `31_incremental-dashboard` streams components across messages where
        // placeholders become orphaned when their parents are updated.
        final processor = MessageProcessor<ComponentApi>(
          catalogs: [catalog()],
          defaultVersion: version,
          validationConfig: ValidationConfig.relaxed,
        );
        expect(
          () => processor.processMessages(
            AgentToRendererMessage.parseAll(payload, protocolVersion: version),
          ),
          returnsNormally,
        );
      });
    }
  });
}
