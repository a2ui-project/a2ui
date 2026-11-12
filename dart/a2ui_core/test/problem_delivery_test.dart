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

import 'dart:async';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

class _MaybeFail extends FunctionImplementation {
  _MaybeFail()
      : super(
          name: 'maybeFail',
          returnType: A2uiReturnType.string,
          argumentSchema: Schema.object(
            properties: {'flag': CommonSchemas.dynamicBoolean},
          ),
        );

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    if (args['flag'] == true) throw StateError('evaluation failed');
    return 'ready';
  }
}

Catalog<ComponentApi, FunctionImplementation> _catalog() => Catalog(
      id: 'problem-delivery-test',
      protocolVersion: A2uiProtocolVersion.v0_9,
      functions: [_MaybeFail()],
      components: [
        ComponentApi(
          name: 'Text',
          schema: Schema.object(
            properties: {
              'text': CommonSchemas.dynamicString,
              'value': CommonSchemas.dynamicString,
            },
          ),
        ),
        ComponentApi(
          name: 'Button',
          schema: Schema.object(properties: {'action': CommonSchemas.action}),
        ),
        ComponentApi(
          name: 'Column',
          schema:
              Schema.object(properties: {'children': CommonSchemas.childList}),
        ),
      ],
    );

SurfaceModel<ComponentApi> _surface([String id = 'surf']) =>
    SurfaceModel<ComponentApi>(id, defaultCatalog: _catalog());

void _add(
  SurfaceModel<ComponentApi> surface,
  String id,
  String type, [
  Map<String, Object?> properties = const {},
]) =>
    surface.componentsModel.addComponent(ComponentModel(id, type, properties));

Map<String, Object?> _maybeFail() => {
      'call': 'maybeFail',
      'args': {
        'flag': {'path': '/flag'},
      },
      'returnType': 'string',
    };

Future<void> _microtask() => Future<void>.microtask(() {});

List<String> _codes(List<A2uiRendererError> errors) =>
    [for (final error in errors) error.code];

void main() {
  group('Problem delivery timing', () {
    late SurfaceModel<ComponentApi> surface;
    late List<A2uiRendererError> errors;

    setUp(() {
      surface = _surface();
      errors = [];
      surface.onError.subscribe(errors.add);
      addTearDown(surface.dispose);
    });

    NodeResolver<ComponentApi> resolve() {
      final resolver = NodeResolver<ComponentApi>(surface);
      addTearDown(resolver.dispose);
      return resolver;
    }

    test('no listener runs before NodeResolver() returns', () async {
      _add(surface, 'root', 'Bogus');

      resolve();
      expect(errors, isEmpty);

      await _microtask();
      expect(_codes(errors), ['UNKNOWN_COMPONENT_TYPE']);
    });

    test('a resolver built and disposed at once still delivers', () async {
      _add(surface, 'root', 'Bogus');

      NodeResolver<ComponentApi>(surface).dispose();
      expect(errors, isEmpty);

      await _microtask();
      expect(_codes(errors), ['UNKNOWN_COMPONENT_TYPE']);
    });

    test('no listener runs before a data write returns', () async {
      surface.dataModel.set('/flag', false);
      _add(surface, 'root', 'Text', {'text': _maybeFail()});
      resolve();
      await _microtask();
      expect(errors, isEmpty);

      surface.dataModel.set('/flag', true);
      expect(errors, isEmpty);

      await _microtask();
      expect(_codes(errors), ['EXPRESSION_ERROR']);
    });

    test('no listener runs before a binding write returns', () async {
      surface.dataModel.set('/flag', false);
      _add(surface, 'root', 'Text', {
        'text': _maybeFail(),
        'value': {'path': '/flag'},
      });
      final NodeResolver<ComponentApi> resolver = resolve();
      await _microtask();
      final binding = resolver.rootNode.peek()!.props.peek()['value']!
          as WritableBinding<Object?>;

      binding.set(true);
      expect(errors, isEmpty);

      await _microtask();
      expect(_codes(errors), ['EXPRESSION_ERROR']);
    });

    test('no listener runs before an action returns', () async {
      _add(surface, 'root', 'Button', {
        'action': {
          'event': {'name': ''},
        },
      });
      final NodeResolver<ComponentApi> resolver = resolve();
      final action = resolver.rootNode.peek()!.props.peek()['action']!
          as Future<void> Function();

      unawaited(action());
      expect(errors, isEmpty);

      await _microtask();
      expect(_codes(errors), ['INVALID_ACTION']);
    });
  });

  group('Problem delivery lifetime', () {
    late SurfaceGroupModel<ComponentApi> group;

    setUp(() {
      group = SurfaceGroupModel<ComponentApi>();
      addTearDown(group.dispose);
    });

    A2uiRendererError error(String surfaceId, String code) =>
        A2uiRendererError(code: code, surfaceId: surfaceId, message: code);

    test('deleteSurface delivers what was reported before it', () async {
      final SurfaceModel<ComponentApi> a = _surface('a');
      final SurfaceModel<ComponentApi> b = _surface('b');
      group
        ..addSurface(a)
        ..addSurface(b);
      final aErrors = <A2uiRendererError>[];
      final bErrors = <A2uiRendererError>[];
      a.onError.subscribe(aErrors.add);
      b.onError.subscribe(bErrors.add);

      unawaited(a.dispatchError(error('a', 'FIRST')));
      unawaited(b.dispatchError(error('b', 'SECOND')));
      group.deleteSurface('a');
      unawaited(a.dispatchError(error('a', 'AFTER_DELETE')));

      await _microtask();
      expect(_codes(aErrors), ['FIRST']);
      expect(_codes(bErrors), ['SECOND']);
    });

    test('a standalone surface added to a group delivers its reports once',
        () async {
      final SurfaceModel<ComponentApi> surface = _surface();
      final surfaceErrors = <A2uiRendererError>[];
      surface.onError.subscribe(surfaceErrors.add);

      unawaited(surface.dispatchError(error('surf', 'STANDALONE')));
      group.addSurface(surface);
      unawaited(surface.dispatchError(error('surf', 'GROUPED')));

      await _microtask();
      expect(_codes(surfaceErrors), ['STANDALONE', 'GROUPED']);
    });
  });

  group('Problem listeners', () {
    late SurfaceModel<ComponentApi> surface;

    setUp(() {
      surface = _surface();
      addTearDown(surface.dispose);
    });

    A2uiRendererError error(String code) =>
        A2uiRendererError(code: code, surfaceId: 'surf', message: code);

    test('a throwing listener does not stop later listeners or reports',
        () async {
      final received = <String>[];
      surface.onError.subscribe((error) {
        received.add('first ${error.code}');
        if (error.code == 'A') throw StateError('listener failed');
      });
      surface.onError
          .subscribe((error) => received.add('second ${error.code}'));

      unawaited(surface.dispatchError(error('A')));
      unawaited(surface.dispatchError(error('B')));
      await _microtask();

      expect(received, ['first A', 'second A', 'first B', 'second B']);
    });

    test('a missing data binding reaches a warning listener', () async {
      _add(surface, 'root', 'Text', {
        'text': {'path': '/missing'},
      });
      final warnings = <A2uiWarning>[];
      surface.onWarning.subscribe(warnings.add);

      NodeResolver<ComponentApi>(surface).dispose();
      await _microtask();

      expect(
        [for (final warning in warnings) (warning.code, warning.path)],
        [('MISSING_DATA_BINDING', '/missing')],
      );
    });

    test('errors and warnings reach their listeners in dispatch order',
        () async {
      final events = <String>[];
      surface.onError.subscribe((error) => events.add(error.code));
      surface.onWarning.subscribe((warning) => events.add(warning.code));

      unawaited(surface.dispatchError(error('E1')));
      unawaited(
        surface.dispatchWarning(const A2uiWarning(code: 'W', message: 'w')),
      );
      unawaited(surface.dispatchError(error('E2')));
      expect(events, isEmpty);

      await _microtask();
      expect(events, ['E1', 'W', 'E2']);
    });
  });

  group('Problem delivery through MessageProcessor', () {
    late MessageProcessor<ComponentApi> processor;
    late List<String> events;

    Map<String, Object?> update(
      String surfaceId,
      List<Map<String, Object?>> components,
    ) =>
        {
          'version': 'v0.9',
          'updateComponents': {
            'surfaceId': surfaceId,
            'components': components,
          },
        };

    Map<String, Object?> create(String surfaceId) => {
          'version': 'v0.9',
          'createSurface': {
            'surfaceId': surfaceId,
            'catalogId': 'problem-delivery-test',
          },
        };

    /// Creates surface `s` with a Text root and mounts a resolver on it.
    void mount() {
      processor.processMessages([
        create('s'),
        update('s', [
          {'id': 'root', 'component': 'Text', 'text': 'ready'},
        ]),
      ]);
      final resolver = NodeResolver<ComponentApi>(
        processor.model.getSurface('s')!,
      );
      addTearDown(resolver.dispose);
    }

    setUp(() {
      events = [];
      processor = MessageProcessor<ComponentApi>(
        catalogs: [_catalog()],
        defaultVersion: A2uiProtocolVersion.v0_9,
      );
      addTearDown(processor.dispose);
      processor.model.onSurfaceCreated.subscribe((surface) {
        surface.onError.subscribe((error) => events.add('error ${error.code}'));
        surface.onWarning
            .subscribe((warning) => events.add('warning ${warning.code}'));
      });
    });

    test('no listener runs before processMessages returns', () async {
      mount();

      processor.processMessages([
        update('s', [
          {'id': 'root', 'component': 'Bogus'},
        ]),
      ]);
      expect(events, isEmpty);

      await _microtask();
      expect(events, ['error UNKNOWN_COMPONENT_TYPE']);
    });

    test(
        'an error found before a deleteSurface in the same payload is '
        'still delivered', () async {
      mount();

      processor.processMessages([
        update('s', [
          {'id': 'root', 'component': 'Bogus'},
        ]),
        {
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': 's'},
        },
      ]);
      expect(events, isEmpty);

      await _microtask();
      expect(events, ['error UNKNOWN_COMPONENT_TYPE']);
    });

    test('an error found before a message that throws is still delivered',
        () async {
      mount();

      expect(
        () => processor.processMessages([
          update('s', [
            {'id': 'root', 'component': 'Bogus'},
          ]),
          update('missing', [
            {'id': 'root', 'component': 'Text', 'text': 'never'},
          ]),
        ]),
        throwsA(isA<A2uiError>()),
      );
      expect(events, isEmpty);

      await _microtask();
      expect(events, ['error UNKNOWN_COMPONENT_TYPE']);
    });
  });
}
