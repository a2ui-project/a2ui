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
import 'package:json_schema_builder/json_schema_builder.dart'
    hide ValidationResult;
import 'package:test/test.dart';

/// Echoes its arguments, so a test can see what the invoker handed it.
class _EchoFn extends FunctionImplementation {
  _EchoFn(Schema argumentSchema)
      : super(name: 'echo', argumentSchema: argumentSchema);

  @override
  Object? execute(
    Map<String, dynamic> args,
    DataContext context, [
    CancellationSignal? cancellationSignal,
  ]) =>
      args;
}

const Map<String, Object?> _dynamicBoolean = {
  r'$ref': r'common_types.json#/$defs/DynamicBoolean',
};

final Schema _flagSchema = Schema.fromMap(const {
  'type': 'object',
  'properties': {
    'on': _dynamicBoolean,
    'all': {'type': 'array', 'items': _dynamicBoolean},
    'payload': {r'$ref': r'common_types.json#/$defs/DynamicValue'},
  },
  'required': ['on'],
});

Catalog<ComponentApi, FunctionImplementation> _catalog(
  A2uiProtocolVersion version,
) =>
    Catalog<ComponentApi, FunctionImplementation>(
      id: 'cat',
      protocolVersion: version,
      components: const [],
      functions: [_EchoFn(_flagSchema)],
    );

DataContext _context(
  Catalog<ComponentApi, FunctionImplementation> catalog, [
  Map<String, Object?> data = const {},
]) =>
    DataContext(
      DataModel()..set('/', data),
      catalog.invoke,
      '/',
      protocolVersion: catalog.protocolVersion,
    );

void main() {
  const invalid = ValidationResult(valid: false, message: 'Required');
  const Map<String, Object?> invalidMap = {'valid': false, 'code': 'required'};

  group('coerceDynamicBoolean', () {
    test('coerces every row of the DynamicBoolean coercion table', () {
      expect(coerceDynamicBoolean(true), isTrue);
      expect(coerceDynamicBoolean(false), isFalse);
      expect(coerceDynamicBoolean(const ValidationResult(valid: true)), isTrue);
      expect(coerceDynamicBoolean(invalid), isFalse);
      expect(coerceDynamicBoolean(const {'valid': true}), isTrue);
      expect(coerceDynamicBoolean(invalidMap), isFalse);
      expect(coerceDynamicBoolean('true'), isTrue);
      expect(coerceDynamicBoolean('True'), isTrue);
      expect(coerceDynamicBoolean('TRUE'), isTrue);
      expect(coerceDynamicBoolean('false'), isFalse);
      expect(coerceDynamicBoolean('FALSE'), isFalse);
      expect(coerceDynamicBoolean('hello'), isFalse);
      expect(coerceDynamicBoolean(''), isFalse);
      expect(coerceDynamicBoolean('1'), isFalse);
      expect(coerceDynamicBoolean(1), isTrue);
      expect(coerceDynamicBoolean(-2), isTrue);
      expect(coerceDynamicBoolean(0.5), isTrue);
      expect(coerceDynamicBoolean(0), isFalse);
      expect(coerceDynamicBoolean(0.0), isFalse);
      expect(coerceDynamicBoolean(double.nan), isFalse);
      expect(coerceDynamicBoolean(null), isFalse);
      expect(coerceDynamicBoolean(const <String, Object?>{}), isFalse);
      expect(coerceDynamicBoolean(const {'other': 1}), isFalse);
      expect(coerceDynamicBoolean(const {'valid': 'yes'}), isFalse);
      expect(coerceDynamicBoolean(const <Object?>[]), isFalse);
      expect(coerceDynamicBoolean(const [true]), isFalse);
    });
  });

  group('Catalog.invoke DynamicBoolean coercion', () {
    test('coerces DynamicBoolean arguments across all value types in v1.0', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _catalog(A2uiProtocolVersion.v1_0);
      final Object? result = catalog.invoke(
        'echo',
        {
          'on': invalid,
          'all': [
            invalidMap,
            true,
            const ValidationResult(valid: true),
            'True',
            'false',
            'hello',
            3,
            0,
            null,
            const {'other': 1},
            const [true],
          ],
        },
        _context(catalog),
      );
      expect(result, {
        'on': false,
        'all': [
          false,
          true,
          true,
          true,
          false,
          false,
          true,
          false,
          false,
          false,
          false,
        ],
      });
    });

    test('leaves a ValidationResult alone outside DynamicBoolean positions',
        () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _catalog(A2uiProtocolVersion.v1_0);
      final Object? result = catalog.invoke(
        'echo',
        {'on': true, 'payload': invalidMap},
        _context(catalog),
      );
      expect(result, {'on': true, 'payload': invalidMap});
    });

    test('coerces non-ValidationResult maps and other values to false', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _catalog(A2uiProtocolVersion.v1_0);
      expect(
        catalog.invoke(
          'echo',
          {
            'on': {'other': 1},
          },
          _context(catalog),
        ),
        {'on': false},
      );
    });

    test('coerces DynamicBoolean arguments in v0.9 as well', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          _catalog(A2uiProtocolVersion.v0_9);
      expect(
        catalog.invoke('echo', {'on': invalidMap}, _context(catalog)),
        {'on': false},
      );
      expect(
        catalog.invoke('echo', {'on': 'TRUE'}, _context(catalog)),
        {'on': true},
      );
    });

    test('applies to a basic catalog function other than the logic ones', () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          BasicCatalog.v1_0();
      final DataContext context = _context(catalog);
      Map<String, dynamic> call(Object? grouping) => {
            '@call': 'formatNumber',
            'args': {
              'value': 1234,
              'decimals': 0,
              'grouping': grouping,
            },
          };
      Map<String, Object?> required(String value) => {
            '@call': 'required',
            'args': {'value': value},
          };
      expect(context.resolveDynamicValue(call(required(''))), '1234');
      expect(context.resolveDynamicValue(call(required('x'))), '1,234');
    });
  });

  group('GenericBinder DynamicBoolean property coercion', () {
    test('coerces bound DynamicBoolean component properties across all rows',
        () {
      final Catalog<ComponentApi, FunctionImplementation> catalog =
          BasicCatalog.v1_0();
      final surface = SurfaceModel<ComponentApi>(
        's1',
        defaultCatalog: catalog,
        protocolVersion: '1.0',
      );
      surface.componentsModel.addComponent(
        ComponentModel(
          'root',
          'CheckBox',
          {
            'label': 'Flag',
            'value': {'@path': '/flag'},
          },
        ),
      );
      final resolver = NodeResolver<ComponentApi>(
        surface,
      );

      final cases = <(Object?, bool)>[
        (true, true),
        (false, false),
        (const ValidationResult(valid: true), true),
        (invalid, false),
        (const {'valid': true}, true),
        (invalidMap, false),
        ('true', true),
        ('True', true),
        ('TRUE', true),
        ('false', false),
        ('FALSE', false),
        ('hello', false),
        ('', false),
        (1, true),
        (-2, true),
        (0, false),
        (null, false),
        (const {'other': 1}, false),
        (const [true], false),
      ];

      for (final (Object? raw, bool expected) in cases) {
        surface.dataModel.set('/flag', raw);
        final bound = resolver.rootNode.value!.props.peek()['value']!
            as ResolvedBinding<Object?>;
        expect(bound.value, expected, reason: 'Failed for $raw');
      }
      resolver.dispose();
      surface.dispose();
    });
  });
}
