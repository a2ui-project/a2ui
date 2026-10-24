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
import 'package:logging/logging.dart';
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

/// Calls [onCall] each time it is evaluated, and returns `'ok'`.
class _Reenter extends FunctionImplementation {
  _Reenter(this.onCall)
      : super(
          name: 'reenter',
          returnType: A2uiReturnType.string,
          argumentSchema: Schema.object(
            properties: {'tick': CommonSchemas.dynamicNumber},
          ),
        );

  final void Function() onCall;

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) {
    onCall();
    return 'ok';
  }
}

Catalog<ComponentApi, FunctionImplementation> _catalog({
  void Function()? onReenter,
}) =>
    Catalog(
      id: 'problem-delivery-test',
      protocolVersion: A2uiProtocolVersion.v0_9,
      functions: [_MaybeFail(), _Reenter(onReenter ?? () {})],
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
    late List<A2uiRendererError> groupErrors;

    setUp(() {
      group = SurfaceGroupModel<ComponentApi>();
      groupErrors = [];
      group.onError.subscribe(groupErrors.add);
      addTearDown(group.dispose);
    });

    A2uiRendererError error(String surfaceId, String code) =>
        A2uiRendererError(code: code, surfaceId: surfaceId, message: code);

    test('deleteSurface drops only that surface undelivered reports', () async {
      final SurfaceModel<ComponentApi> a = _surface('a');
      final SurfaceModel<ComponentApi> b = _surface('b');
      group
        ..addSurface(a)
        ..addSurface(b);
      final surfaceErrors = <A2uiRendererError>[];
      a.onError.subscribe(surfaceErrors.add);

      unawaited(a.dispatchError(error('a', 'FIRST')));
      unawaited(b.dispatchError(error('b', 'SECOND')));
      group.deleteSurface('a');
      unawaited(a.dispatchError(error('a', 'AFTER_DELETE')));

      await _microtask();
      expect(_codes(groupErrors), ['SECOND']);
      expect(surfaceErrors, isEmpty);
    });

    test(
        'a surface built and deleted in the same turn delivers nothing, '
        'unlike main', () async {
      final SurfaceModel<ComponentApi> surface = _surface();
      group.addSurface(surface);
      _add(surface, 'root', 'Bogus');

      NodeResolver<ComponentApi>(surface).dispose();
      group.deleteSurface('surf');

      await _microtask();
      expect(groupErrors, isEmpty);
    });

    test('a detached surface holds its reports until it is added again',
        () async {
      final SurfaceModel<ComponentApi> surface = _surface();
      addTearDown(surface.dispose);
      group.addSurface(surface);
      final surfaceErrors = <A2uiRendererError>[];
      surface.onError.subscribe(surfaceErrors.add);

      unawaited(surface.dispatchError(error('surf', 'BEFORE_DETACH')));
      expect(group.detachSurface('surf'), same(surface));
      unawaited(surface.dispatchError(error('surf', 'WHILE_DETACHED')));
      await _microtask();
      expect(groupErrors, isEmpty);
      expect(surfaceErrors, isEmpty);

      group.addSurface(surface);
      await _microtask();
      expect(_codes(groupErrors), ['BEFORE_DETACH', 'WHILE_DETACHED']);
      expect(_codes(surfaceErrors), ['BEFORE_DETACH', 'WHILE_DETACHED']);

      await _microtask();
      expect(groupErrors, hasLength(2));
    });

    test('disposing a detached surface drops its held reports', () async {
      final SurfaceModel<ComponentApi> surface = _surface();
      group.addSurface(surface);
      unawaited(surface.dispatchError(error('surf', 'HELD')));
      group.detachSurface('surf')!.dispose();

      await _microtask();
      expect(groupErrors, isEmpty);
    });

    test('addSurface moves a standalone surface pending reports to the group',
        () async {
      final SurfaceModel<ComponentApi> surface = _surface();
      final surfaceErrors = <A2uiRendererError>[];
      surface.onError.subscribe(surfaceErrors.add);

      unawaited(surface.dispatchError(error('surf', 'STANDALONE')));
      group.addSurface(surface);

      await _microtask();
      expect(_codes(surfaceErrors), ['STANDALONE']);
      expect(_codes(groupErrors), ['STANDALONE']);
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

    test(
        'a throwing listener does not stop later listeners or reports, and '
        'its error reaches the zone', () async {
      final received = <String>[];
      final uncaught = <Object>[];
      surface.onError.subscribe((error) {
        received.add('first ${error.code}');
        if (error.code == 'A') throw StateError('listener failed');
      });
      surface.onError
          .subscribe((error) => received.add('second ${error.code}'));

      await runZonedGuarded(() async {
        unawaited(surface.dispatchError(error('A')));
        unawaited(surface.dispatchError(error('B')));
        await _microtask();
      }, (error, _) => uncaught.add(error));

      expect(received, ['first A', 'second A', 'first B', 'second B']);
      expect(uncaught, [isA<StateError>()]);
    });

    test('an error with no listener is printed', () async {
      final printed = <String>[];
      await runZoned(
        () async {
          unawaited(surface.dispatchError(error('UNHEARD')));
          await _microtask();
        },
        zoneSpecification: ZoneSpecification(
          print: (_, __, ___, line) => printed.add(line),
        ),
      );

      expect(printed, [contains('UNHEARD')]);
    });

    test(
        'a missing data binding is silent without a warning listener and '
        'reaches one when set', () async {
      final printed = <String>[];
      final fine = <LogRecord>[];
      final Level level = Logger.root.level;
      Logger.root.level = Level.ALL;
      addTearDown(() => Logger.root.level = level);
      final StreamSubscription<LogRecord> subscription =
          Logger.root.onRecord.listen((record) {
        if (record.level == Level.FINE) fine.add(record);
      });
      addTearDown(subscription.cancel);
      _add(surface, 'root', 'Text', {
        'text': {'path': '/missing'},
      });

      await runZoned(
        () async {
          NodeResolver<ComponentApi>(surface).dispose();
          await _microtask();
        },
        zoneSpecification: ZoneSpecification(
          print: (_, __, ___, line) => printed.add(line),
        ),
      );
      expect(printed, isEmpty);
      expect(
        [for (final record in fine) record.message],
        contains(contains('MISSING_DATA_BINDING')),
      );

      final warnings = <A2uiWarning>[];
      surface.onWarning.subscribe(warnings.add);
      NodeResolver<ComponentApi>(surface).dispose();
      await _microtask();
      expect(
        [for (final warning in warnings) (warning.code, warning.path)],
        [('MISSING_DATA_BINDING', '/missing')],
      );
    });

    test('onReportsDelivered fires after the listeners', () async {
      final events = <String>[];
      surface.onError.subscribe((error) => events.add(error.code));
      surface.onWarning.subscribe((warning) => events.add(warning.code));
      surface.onReportsDelivered.subscribe((_) => events.add('delivered'));

      unawaited(surface.dispatchError(error('E1')));
      unawaited(
        surface.dispatchWarning(const A2uiWarning(code: 'W', message: 'w')),
      );
      unawaited(surface.dispatchError(error('E2')));
      expect(events, isEmpty);

      await _microtask();
      expect(events, ['E1', 'W', 'E2', 'delivered']);
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

    Map<String, Object?> delete(String surfaceId) => {
          'version': 'v0.9',
          'deleteSurface': {'surfaceId': surfaceId},
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
        onError: (error) => events.add('error ${error.code}'),
        onWarning: (warning) => events.add('warning ${warning.code}'),
      );
      addTearDown(processor.dispose);
    });

    test('a mounted surface error is delivered before processMessages returns',
        () {
      mount();

      processor.processMessages([
        update('s', [
          {'id': 'root', 'component': 'Bogus'},
        ]),
      ]);

      expect(events, ['error UNKNOWN_COMPONENT_TYPE']);
    });

    test('an error found before a deleteSurface in one payload is delivered',
        () {
      mount();

      processor.processMessages([
        update('s', [
          {'id': 'root', 'component': 'Bogus'},
        ]),
        delete('s'),
      ]);

      expect(processor.model.getSurface('s'), isNull);
      expect(events, ['error UNKNOWN_COMPONENT_TYPE']);
    });

    test(
        'an error found before a message that throws is delivered before the '
        'exception propagates', () {
      mount();
      List<String>? seen;

      try {
        processor.processMessages([
          update('s', [
            {'id': 'root', 'component': 'Bogus'},
          ]),
          update('missing', [
            {'id': 'root', 'component': 'Text', 'text': 'never'},
          ]),
        ]);
      } on A2uiError {
        seen = List.of(events);
      }

      expect(seen, ['error UNKNOWN_COMPONENT_TYPE']);
    });

    test('a listener nested processMessages is delivered after it returns', () {
      mount();
      processor.model.onError.subscribe((error) {
        if (error.code != 'UNKNOWN_COMPONENT_TYPE') return;
        events.add('nested start');
        processor.processMessages([
          {
            'version': 'v0.9',
            'updateDataModel': {
              'surfaceId': 's',
              'path': '/flag',
              'value': true,
            },
          },
          update('s', [
            {'id': 'root', 'component': 'Text', 'text': _maybeFail()},
          ]),
        ]);
        events.add('nested end');
      });

      processor.processMessages([
        update('s', [
          {'id': 'root', 'component': 'Bogus'},
        ]),
      ]);

      expect(events, [
        'error UNKNOWN_COMPONENT_TYPE',
        'nested start',
        'nested end',
        'error EXPRESSION_ERROR',
      ]);
    });

    test(
        'the processor and surface listeners see the same reports in the '
        'same order, warnings included', () {
      processor.model.onSurfaceCreated.subscribe((surface) {
        surface.onError.subscribe((error) => events.add('surface error'));
        surface.onWarning.subscribe((warning) => events.add('surface warning'));
        final resolver = NodeResolver<ComponentApi>(surface);
        addTearDown(resolver.dispose);
      });

      processor.processMessages([
        create('s'),
        update('s', [
          {
            'id': 'root',
            'component': 'Column',
            'children': ['a', 'b', 'c'],
          },
          {'id': 'a', 'component': 'Bogus'},
          {
            'id': 'b',
            'component': 'Text',
            'text': {'path': '/missing'},
          },
          {'id': 'c', 'component': 'OtherBogus'},
        ]),
      ]);

      expect(events, [
        'surface error',
        'error UNKNOWN_COMPONENT_TYPE',
        'surface warning',
        'warning MISSING_DATA_BINDING',
        'surface error',
        'error UNKNOWN_COMPONENT_TYPE',
      ]);
    });
  });

  group('Problem delivery and the resolution guard', () {
    late MessageProcessor<ComponentApi> processor;
    late List<String> events;
    void Function() onCall = () {};

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

    /// Makes surface `t` report an unknown type through its mounted resolver.
    void breakOther() => processor.processMessages([
          update('t', [
            {'id': 'root', 'component': 'Bogus'},
          ]),
        ]);

    setUp(() {
      events = [];
      onCall = () {};
      processor = MessageProcessor<ComponentApi>(
        catalogs: [_catalog(onReenter: () => onCall())],
        defaultVersion: A2uiProtocolVersion.v0_9,
        onError: (error) => events.add('${error.surfaceId} ${error.code}'),
      );
      addTearDown(processor.dispose);
      processor.processMessages([
        for (final id in ['s', 't'])
          {
            'version': 'v0.9',
            'createSurface': {
              'surfaceId': id,
              'catalogId': 'problem-delivery-test',
            },
          },
        update('t', [
          {'id': 'root', 'component': 'Text', 'text': 'ready'},
        ]),
      ]);
      final other =
          NodeResolver<ComponentApi>(processor.model.getSurface('t')!);
      addTearDown(other.dispose);
    });

    NodeResolver<ComponentApi> resolve() {
      final resolver = NodeResolver<ComponentApi>(
        processor.model.getSurface('s')!,
      );
      addTearDown(resolver.dispose);
      return resolver;
    }

    test(
        'a catalog function that calls processMessages during resolver '
        'construction delivers after the constructor returns', () async {
      processor.processMessages([
        update('s', [
          {
            'id': 'root',
            'component': 'Column',
            'children': ['a', 'b'],
          },
          {'id': 'a', 'component': 'Bogus'},
          {
            'id': 'b',
            'component': 'Text',
            'text': {'call': 'reenter', 'returnType': 'string'},
          },
        ]),
      ]);
      onCall = () {
        onCall = () {};
        breakOther();
      };

      resolve();
      expect(events, isEmpty);

      await _microtask();
      expect(events, ['s UNKNOWN_COMPONENT_TYPE', 't UNKNOWN_COMPONENT_TYPE']);
    });

    test(
        'a catalog function that calls processMessages during a data write '
        'delivers after the write returns', () async {
      processor.processMessages([
        update('s', [
          {
            'id': 'root',
            'component': 'Text',
            'text': {
              'call': 'reenter',
              'args': {
                'tick': {'path': '/tick'},
              },
              'returnType': 'string',
            },
          },
        ]),
      ]);
      final SurfaceModel<ComponentApi> surface =
          processor.model.getSurface('s')!;
      surface.dataModel.set('/tick', 0);
      resolve();
      await _microtask();
      expect(events, isEmpty);
      onCall = () {
        onCall = () {};
        breakOther();
      };

      surface.dataModel.set('/tick', 1);
      expect(events, isEmpty);

      await _microtask();
      expect(events, ['t UNKNOWN_COMPONENT_TYPE']);
    });

    test(
        'processMessages called while a resolver publishes its root delivers '
        'after the update returns', () async {
      final NodeResolver<ComponentApi> resolver = resolve();
      var published = false;
      final void Function() unsubscribe = resolver.rootNode.subscribe((root) {
        if (root == null || published) return;
        published = true;
        breakOther();
      });
      addTearDown(unsubscribe);

      _add(processor.model.getSurface('s')!, 'root', 'Text', {'text': 'ok'});
      expect(published, isTrue);
      expect(events, isEmpty);

      await _microtask();
      expect(events, ['t UNKNOWN_COMPONENT_TYPE']);
    });
  });
}
