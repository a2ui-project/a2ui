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

/// Exercises `A2uiValidator` against the published basic catalog and the
/// example payloads that ship with it, rather than against a catalog written
/// for the test. Those examples are the specification's own statement of what
/// a valid v0.9 payload looks like, so they are the sharpest available check
/// that validation is neither too strict nor too permissive.

const String basicCatalogId =
    'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

Map<String, Object?> _readJson(String relativePath) =>
    jsonDecode(File(resolveConformancePath(relativePath)).readAsStringSync())
        as Map<String, Object?>;

Map<String, Object?> basicCatalogDocument() =>
    _readJson('../specification/v0_9_1/catalogs/basic/catalog.json');

/// A validator over the published basic catalog.
///
/// Supplies no shared types, so these tests run against the
/// `common_types.json` the package publishes — the same document a caller
/// installing from pub.dev gets.
A2uiValidator<ComponentApi, FunctionApi> basicValidator() =>
    A2uiValidator(catalogs: [Catalog.fromJson(basicCatalogDocument())]);

/// A payload declaring one surface against the basic catalog.
List<Map<String, Object?>> render(List<Map<String, Object?>> components) => [
  {
    'version': 'v0.9',
    'createSurface': {'surfaceId': 's', 'catalogId': basicCatalogId},
  },
  {
    'version': 'v0.9',
    'updateComponents': {'surfaceId': 's', 'components': components},
  },
];

void main() {
  group('the basic catalog', () {
    test('declares the child references of its layout components', () {
      final SchemaCatalog catalog = Catalog.fromJson(basicCatalogDocument());
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

  group('validating the basic catalog examples', () {
    final examples = Directory(
      resolveConformancePath('../specification/v0_9_1/catalogs/basic/examples'),
    );
    final List<File> files = examples.listSync().whereType<File>().where((f) {
      return f.path.endsWith('.json');
    }).toList()..sort((a, b) => a.path.compareTo(b.path));

    test('the examples are present', () {
      expect(files, isNotEmpty, reason: examples.path);
    });

    for (final file in files) {
      final String name = file.uri.pathSegments.last;
      test(name, () async {
        final Object? document = jsonDecode(file.readAsStringSync());
        final Object? messages = document is Map
            ? document['messages']
            : document;
        expect(
          messages,
          isA<List<Object?>>(),
          reason: '$name declares no message list',
        );
        final List<Map<String, Object?>> payload = [
          for (final Object? message in messages! as List<Object?>)
            (message! as Map).cast<String, Object?>(),
        ];

        expect(() => basicValidator().validate(payload), returnsNormally);
      });
    }
  });

  group('validating against the basic catalog rejects', () {
    late A2uiValidator<ComponentApi, FunctionApi> validator;

    setUp(() => validator = basicValidator());

    test('a component missing a required property', () {
      expect(
        () => validator.validate(
          render([
            {'id': 'root', 'component': 'Text'},
          ]),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('a value outside a property enum', () {
      expect(
        () => validator.validate(
          render([
            {'id': 'root', 'component': 'Text', 'text': 'hi', 'variant': 'h9'},
          ]),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('a property the component does not declare', () {
      expect(
        () => validator.validate(
          render([
            {
              'id': 'root',
              'component': 'Text',
              'text': 'hi',
              'notAProperty': 1,
            },
          ]),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('a component type the catalog does not declare', () {
      expect(
        () => validator.validate(
          render([
            {'id': 'root', 'component': 'Frobnicator'},
          ]),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('a call to a function the catalog does not declare', () {
      // `anyFunction` is reached through `common_types.json`, which points
      // back at the catalog document, so resolving it in both directions is
      // what makes this check possible.
      expect(
        () => validator.validate(
          render([
            {
              'id': 'root',
              'component': 'Text',
              'text': {
                'call': 'noSuchFunction',
                'args': <String, Object?>{},
                'returnType': 'string',
              },
            },
          ]),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('a child reference that names no component', () {
      expect(
        () => validator.validate(
          render([
            {'id': 'root', 'component': 'Card', 'child': 'missing'},
          ]),
        ),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('a malformed child list', () {
      expect(
        () => validator.validate(
          render([
            {
              'id': 'root',
              'component': 'Column',
              // A template needs `path` as well as `componentId`.
              'children': {'componentId': 'a'},
            },
            {'id': 'a', 'component': 'Text', 'text': 'x'},
          ]),
        ),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });

  group('validating against the basic catalog accepts', () {
    late A2uiValidator<ComponentApi, FunctionApi> validator;

    setUp(() => validator = basicValidator());

    test('a data binding in place of a literal', () {
      expect(
        () => validator.validate(
          render([
            {
              'id': 'root',
              'component': 'Text',
              'text': {'path': '/greeting'},
            },
          ]),
        ),
        returnsNormally,
      );
    });

    test('a call to a function the catalog declares', () {
      expect(
        () => validator.validate(
          render([
            {
              'id': 'root',
              'component': 'Text',
              'text': {
                'call': 'formatString',
                'args': {'value': 'x'},
                'returnType': 'string',
              },
            },
          ]),
        ),
        returnsNormally,
      );
    });
  });
}
