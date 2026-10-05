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

import 'package:a2ui_core/src/core/component_model.dart';
import 'package:a2ui_core/src/core/minimal_catalog.dart';
import 'package:a2ui_core/src/primitives/errors.dart';
import 'package:a2ui_core/src/validation/validation_config.dart';
import 'package:test/test.dart';

void main() {
  group('ComponentModel', () {
    test('onUpdated fires on every property update, not just the first', () {
      final comp = ComponentModel('c1', 'Text', {'text': 'hello'});
      var updateCount = 0;
      comp.onUpdated.addListener((_) => updateCount++);

      comp.properties = {'text': 'world'};
      expect(updateCount, 1, reason: 'first update should notify');

      comp.properties = {'text': 'again'};
      expect(updateCount, 2, reason: 'second update should also notify');

      comp.properties = {'text': 'and again'};
      expect(updateCount, 3, reason: 'third update should also notify');
    });

    test('toJson keeps its id and type over same-named properties', () {
      final comp = ComponentModel('c1', 'Text', {
        'text': 'hi',
        'id': 'other',
        'component': 'Bogus',
      });

      expect(comp.toJson(), {'text': 'hi', 'id': 'c1', 'component': 'Text'});
    });

    test('toJson emits catalogId and metadata only when set', () {
      expect(ComponentModel('c1', 'Text', {'text': 'a'}).toJson(), {
        'id': 'c1',
        'component': 'Text',
        'text': 'a',
      });

      final comp = ComponentModel(
        'c1',
        'Text',
        {'text': 'a'},
        catalog: 'cat',
        metadata: {'k': 'v'},
      );
      expect(comp.catalog, 'cat');
      expect(comp.metadata, {'k': 'v'});
      expect(comp.properties, {'text': 'a'});
      expect(comp.toJson(), {
        'id': 'c1',
        'component': 'Text',
        'catalogId': 'cat',
        'metadata': {'k': 'v'},
        'text': 'a',
      });
    });
  });

  group('SurfaceComponentsModel', () {
    late SurfaceComponentsModel model;

    setUp(() {
      model = SurfaceComponentsModel(catalog: MinimalCatalog());
      model.addComponent(
        ComponentModel('root', 'Column', {
          'children': ['a', 'b'],
        }),
      );
      model.addComponent(ComponentModel('a', 'Text', {'text': 'x'}));
    });

    tearDown(() => model.dispose());

    test('exposes its components as a collection', () {
      expect(model.size, 2);
      expect(model.has('a'), isTrue);
      expect(model.has('b'), isFalse);
      expect(model.keys, ['root', 'a']);
      expect(model.values.map((c) => c.id), ['root', 'a']);
      expect(model.entries.map((e) => e.key), ['root', 'a']);
      expect(model.getAll().map((c) => c.id), ['root', 'a']);
    });

    test('getChildIds lists referenced ids, including unresolved ones', () {
      expect(model.getChildIds('root'), ['a', 'b']);
      expect(model.getChildIds('a'), isEmpty);
      expect(model.getChildIds('missing'), isEmpty);
    });

    test('validateTopology applies the config flags', () {
      expect(
        () => model.validateTopology(),
        throwsA(isA<A2uiIntegrityError>()),
      );
      expect(
        () => model.validateTopology(
          const ValidationConfig(allowDanglingReferences: true),
        ),
        returnsNormally,
      );
      expect(
        () => model.validateTopology(
          const ValidationConfig(allowDanglingReferences: true, rootId: 'x'),
        ),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('validateReferences reports instead of throwing', () {
      final List<A2uiValidationError> errors = model.validateReferences();
      expect(errors, hasLength(1));
      expect(errors.single, isA<A2uiIntegrityError>());
      expect(
        model.validateReferences(ValidationConfig.relaxed),
        isEmpty,
      );
    });

    test('detectCycles returns what the root reaches', () {
      expect(model.detectCycles(), {'root', 'a'});
    });

    test('validateComponentsUpdate checks a candidate without mutating', () {
      expect(
        () => model.validateComponentsUpdate([
          {'id': 'b', 'component': 'Text', 'text': 'y'},
        ]),
        returnsNormally,
      );
      expect(model.has('b'), isFalse);

      expect(
        () => model.validateComponentsUpdate([
          {
            'id': 'a',
            'children': ['root'],
          },
          {
            'id': 'a2',
            'component': 'Column',
            'children': ['a2'],
          },
        ], ValidationConfig.relaxed),
        throwsA(isA<A2uiRecursionError>()),
      );
      expect(model.get('a')!.type, 'Text');
    });
  });
}
