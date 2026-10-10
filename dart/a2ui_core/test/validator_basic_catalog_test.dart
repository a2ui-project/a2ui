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

  // `min` and `max` accept a date, a time or a date-time, told apart only by
  // their `format` inside a `oneOf`. Without format checking every string
  // matches all three branches, so `oneOf` rejects even a valid bound.
  final Map<String, PayloadValidator<ComponentApi, FunctionApi> Function()>
      dateTimeValidators = {
    'v0.9.1': () => PayloadValidator<ComponentApi, FunctionApi>(
          catalog: Catalog.fromJson(basicCatalogDocument()),
          protocolVersion: A2uiProtocolVersion.v0_9,
        ),
    'v1': () => PayloadValidator<ComponentApi, FunctionApi>(
          catalog:
              Catalog.fromJson(_readJson('../catalogs/basic/v1/catalog.json')),
          protocolVersion: A2uiProtocolVersion.v1_0,
          commonTypesSchema: _readJson(
            '../specification/v1_0/json/common_types.json',
          ),
        ),
  };

  Map<String, Object?> dateTimeInput(Map<String, Object?> bounds) => {
        'id': 'when',
        'component': 'DateTimeInput',
        'value': '',
        ...bounds,
      };

  for (final MapEntry(key: catalogName, value: newValidator)
      in dateTimeValidators.entries) {
    group('DateTimeInput bounds in the $catalogName basic catalog', () {
      // Built on first use and shared by the group's tests, so the catalog is
      // read and resolved once.
      late final PayloadValidator<ComponentApi, FunctionApi> validator =
          newValidator();

      for (final bound in [
        '2026-01-01',
        '09:00:00',
        '2026-01-01T09:00:00Z',
      ]) {
        test('accept the literal $bound', () {
          expect(
            () => validator.validateComponent(
              dateTimeInput({'min': bound, 'max': bound}),
            ),
            returnsNormally,
          );
        });
      }

      test('accept a data binding', () {
        expect(
          () => validator.validateComponent(
            dateTimeInput({
              // v1.0 renamed the binding key to `@path`.
              'min': {catalogName == 'v1' ? '@path' : 'path': '/earliest'},
            }),
          ),
          returnsNormally,
        );
      });

      for (final bound in ['tomorrow', '2026/01/01', '']) {
        test('reject the literal "$bound"', () {
          expect(
            () => validator.validateComponent(dateTimeInput({'max': bound})),
            throwsA(isA<A2uiValidationError>()),
          );
        });
      }
    });
  }

  group('validating the basic catalog examples', () {
    final examples = Directory(
      resolveConformancePath('../specification/v0_9_1/catalogs/basic/examples'),
    );
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
          catalogs: [rendererCatalog(basicCatalogDocument())],
          defaultVersion: A2uiProtocolVersion.v0_9,
          validationConfig: ValidationConfig.relaxed,
        );
        expect(
          () => processor.processMessages(
            AgentToRendererMessage.parseAll(
              payload,
              protocolVersion: A2uiProtocolVersion.v0_9,
            ),
          ),
          returnsNormally,
        );
      });
    }
  });
}
