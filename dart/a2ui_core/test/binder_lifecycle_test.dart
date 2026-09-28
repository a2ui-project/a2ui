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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

void main() {
  group('GenericBinder lifecycle', () {
    late MinimalCatalog catalog;
    late SurfaceModel<ComponentApi> surface;

    setUp(() {
      catalog = MinimalCatalog();
      surface = SurfaceModel('s1', catalog: catalog);
    });

    test('dispose stops reacting to data model changes', () {
      final comp = ComponentModel('c1', 'Text', {
        'text': {'path': '/val'},
      });
      surface.componentsModel.addComponent(comp);
      surface.dataModel.set('/val', 'initial');

      final context = ComponentContext(surface, comp);
      final binder = GenericBinder(context, MinimalTextApi().schema);

      expect(binder.resolvedProps.value['text'], 'initial');

      binder.dispose();

      surface.dataModel.set('/val', 'updated');
      expect(
        binder.resolvedProps.value['text'],
        'initial',
        reason: 'binder should not react after dispose',
      );
    });

    test('rebuilding bindings disposes old ComputedNotifiers '
        'from function calls', () {
      var callCount = 0;
      final trackingCatalog = _TrackingCatalog(onExecute: () => callCount++);
      final trackingSurface = SurfaceModel<ComponentApi>(
        's1',
        catalog: trackingCatalog,
      );

      final comp = ComponentModel('c1', 'Text', {
        'text': {
          'call': 'trackingFn',
          'args': {
            'value': {'path': '/val'},
          },
          'returnType': 'any',
        },
      });
      trackingSurface.componentsModel.addComponent(comp);
      trackingSurface.dataModel.set('/val', 'a');

      final context = ComponentContext(trackingSurface, comp);
      final binder = GenericBinder(context, MinimalTextApi().schema);

      // Trigger a rebuild by updating component properties.
      comp.properties = {
        'text': {
          'call': 'trackingFn',
          'args': {
            'value': {'path': '/val'},
          },
          'returnType': 'any',
        },
      };

      // Now update the data model. If old ComputedNotifiers leaked,
      // the function will be called more than once.
      callCount = 0;
      trackingSurface.dataModel.set('/val', 'b');

      expect(
        callCount,
        1,
        reason:
            'Old ComputedNotifiers should be disposed '
            'after rebuild, but function was called '
            '$callCount times',
      );

      binder.dispose();
    });
    test('construction resolves function-call properties exactly once', () {
      var callCount = 0;
      final trackingCatalog = _TrackingCatalog(onExecute: () => callCount++);
      final trackingSurface = SurfaceModel<ComponentApi>(
        's1',
        catalog: trackingCatalog,
      );

      final comp = ComponentModel('c1', 'Text', {
        'text': {
          'call': 'trackingFn',
          'args': {
            'value': {'path': '/val'},
          },
          'returnType': 'any',
        },
      });
      trackingSurface.componentsModel.addComponent(comp);
      trackingSurface.dataModel.set('/val', 'hello');

      callCount = 0;
      final context = ComponentContext(trackingSurface, comp);
      GenericBinder(context, MinimalTextApi().schema);

      expect(
        callCount,
        1,
        reason:
            'Function should be evaluated once during '
            'construction, not $callCount times',
      );
    });
  });
}

class _TrackingCatalog extends MinimalCatalog {
  _TrackingCatalog({required this.onExecute}) {
    functions['trackingFn'] = _TrackingFunction(onExecute);
  }

  final void Function() onExecute;
}

class _TrackingFunction extends FunctionImplementation {
  final void Function() _onExecute;

  _TrackingFunction(this._onExecute)
    : super(
        name: 'trackingFn',
        argumentSchema: Schema.object(
          properties: {'value': CommonSchemas.dynamicString},
          required: ['value'],
        ),
      );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    _onExecute();
    return args['value']?.toString() ?? '';
  }
}
