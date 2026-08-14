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
import 'package:a2ui_core/src/core/contexts.dart';
import 'package:a2ui_core/src/core/minimal_catalog.dart';
import 'package:a2ui_core/src/core/surface_model.dart';
import 'package:a2ui_core/src/rendering/binder.dart';
import 'package:test/test.dart';

void main() {
  group('GenericBinder', () {
    late MinimalCatalog catalog;
    late SurfaceModel surface;

    setUp(() {
      catalog = MinimalCatalog();
      surface = SurfaceModel('s1', catalog: catalog);
    });

    test('resolves dynamic properties', () {
      final comp = ComponentModel('c1', 'Text', {
        'text': {'path': '/val'},
      });
      surface.componentsModel.addComponent(comp);
      surface.dataModel.set('/val', 'initial');

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalTextApi().schema);

      expect(binder.resolvedProps.value['text'], 'initial');

      surface.dataModel.set('/val', 'updated');
      expect(binder.resolvedProps.value['text'], 'updated');
    });

    test('resolves actions into callbacks', () async {
      String? actionName;
      surface.onAction.addListener((action) {
        actionName = action.name;
      });

      final comp = ComponentModel('c1', 'Button', {
        'child': 'c2',
        'action': {
          'event': {'name': 'test_action'},
        },
      });
      surface.componentsModel.addComponent(comp);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalButtonApi().schema);

      final Object? action = binder.resolvedProps.value['action'];
      expect(action, isA<Function>());
      await (action as Function)();

      expect(actionName, 'test_action');
    });

    test('resolves structural children', () {
      final comp = ComponentModel('c1', 'Row', {
        'children': ['child1', 'child2'],
      });
      surface.componentsModel.addComponent(comp);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalRowApi().schema);

      final children =
          binder.resolvedProps.value['children'] as List<ChildNode>;
      expect(children.length, 2);
      expect(children[0].id, 'child1');
      expect(children[1].id, 'child2');
    });

    test('resolves checkable validation', () async {
      final comp = ComponentModel('c1', 'TextField', {
        'label': 'Name',
        'checks': [
          {
            'condition': {'path': '/valid'},
            'message': 'Must be valid',
          },
        ],
      });
      surface.componentsModel.addComponent(comp);
      surface.dataModel.set('/valid', false);

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalTextFieldApi().schema);

      // Wait for Timer.run in GenericBinder
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(binder.resolvedProps.value['isValid'], false);
      expect(binder.resolvedProps.value['validationErrors'], ['Must be valid']);

      surface.dataModel.set('/valid', true);
      expect(binder.resolvedProps.value['isValid'], true);
    });
  });
}
