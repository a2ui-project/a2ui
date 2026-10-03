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
import 'package:test/test.dart';

typedef _RendererCatalog = Catalog<ComponentApi, FunctionImplementation>;

/// Builds a data context that evaluates nested calls against [catalog].
DataContext _contextFor(
  _RendererCatalog catalog, {
  String? protocolVersion,
  DataModel? dataModel,
}) {
  return DataContext(
    dataModel ?? DataModel(),
    (name, args, context) => catalog.invoke(name, args, context),
    '/',
    protocolVersion: protocolVersion,
  );
}

/// Executes [name] from [catalog] and unwraps a reactive result.
Object? _call(
  _RendererCatalog catalog,
  String name,
  Map<String, dynamic> args, {
  DataContext? context,
}) {
  final Object? result = catalog.functions[name]!.execute(
    args,
    context ?? _contextFor(catalog),
  );
  return result is ReadonlySignal<Object?> ? result.value : result;
}

const _functionNames = {
  'required',
  'regex',
  'length',
  'numeric',
  'email',
  'formatString',
  'formatNumber',
  'formatCurrency',
  'formatDate',
  'pluralize',
  'openUrl',
  'and',
  'or',
  'not',
};

void main() {
  final _RendererCatalog v09 = BasicCatalog.v0_9();
  final _RendererCatalog v10 = BasicCatalog.v1_0();

  group('BasicCatalog identity', () {
    test('v0.9 matches the published catalog document', () {
      expect(
        v09.id,
        'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      );
      expect(v09.functions.keys.toSet(), _functionNames);
      expect(v09.components, isEmpty);
    });

    test('v1.0 matches the published catalog document', () {
      expect(
        v10.id,
        'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      );
      expect(v10.functions.keys.toSet(), _functionNames);
      expect(v10.components, isEmpty);
    });

    test('validators return booleans in v0.9 and results in v1.0', () {
      for (final name in ['required', 'regex', 'length', 'numeric', 'email']) {
        expect(v09.functions[name]!.returnType, A2uiReturnType.boolean);
        expect(
          v10.functions[name]!.returnType,
          A2uiReturnType.validationResult,
        );
      }
      expect(v10.functions['openUrl']!.returnType, A2uiReturnType.void_);
      expect(v10.functions['formatDate']!.returnType, A2uiReturnType.string);
      expect(v10.functions['and']!.returnType, A2uiReturnType.boolean);
    });

    test('argument schemas use the catalog argument names', () {
      Map<String, Object?> props(_RendererCatalog c, String name) =>
          (c.functions[name]!.argumentSchema.value['properties']!
                  as Map<String, Object?>)
              .cast<String, Object?>();
      expect(
          props(v10, 'formatNumber').keys, ['value', 'decimals', 'grouping']);
      expect(
        props(v10, 'formatCurrency').keys,
        ['value', 'currency', 'decimals', 'grouping'],
      );
      expect(props(v10, 'formatDate').keys, ['value', 'format']);
      expect(
        props(v10, 'pluralize').keys,
        ['value', 'zero', 'one', 'two', 'few', 'many', 'other'],
      );
      expect(props(v09, 'length').keys, ['value', 'min', 'max']);
      expect(props(v09, 'regex').keys, ['value', 'pattern']);
      expect(props(v09, 'openUrl').keys, ['url']);
      expect(props(v09, 'and').keys, ['values']);
    });
  });

  group('truthiness', () {
    for (final falsy in <Object?>[0, 0.0, '', null, false]) {
      test('not($falsy) is true', () {
        expect(_call(v10, 'not', {'value': falsy}), isTrue);
      });
    }
    for (final truthy in <Object?>[1, -1, 'a', true, <Object?>[], {}]) {
      test('not($truthy) is false', () {
        expect(_call(v10, 'not', {'value': truthy}), isFalse);
      });
    }

    test('and and or coerce values', () {
      expect(
        _call(v09, 'and', {
          'values': [1, 'yes'],
        }),
        isTrue,
      );
      expect(
        _call(v09, 'and', {
          'values': [1, ''],
        }),
        isFalse,
      );
      expect(
        _call(v09, 'or', {
          'values': [0, null],
        }),
        isFalse,
      );
      expect(
        _call(v09, 'or', {
          'values': [0, 'x'],
        }),
        isTrue,
      );
    });

    test('and and or require at least two values', () {
      expect(
        () => _call(v10, 'and', {
          'values': [true],
        }),
        throwsA(isA<A2uiExpressionError>()),
      );
      expect(
        () => _call(v10, 'or', {'values': null}),
        throwsA(isA<A2uiExpressionError>()),
      );
    });
  });

  group('formatString coercion', () {
    final cases = <String, (Object?, String)>{
      'integral double': (3.0, '3'),
      'fractional double': (2.5, '2.5'),
      'int': (7, '7'),
      'bool': (true, 'true'),
      'null': (null, ''),
      'map': (
        {
          'a': 1,
          'b': [true],
        },
        '{"a":1,"b":[true]}',
      ),
      'list': ([1, 'x'], '[1,"x"]'),
    };
    for (final MapEntry<String, (Object?, String)> entry in cases.entries) {
      test('interpolates a ${entry.key}', () {
        final dataModel = DataModel();
        dataModel.set('/v', entry.value.$1);
        final DataContext context = _contextFor(v09, dataModel: dataModel);
        expect(
          _call(v09, 'formatString', {'value': 'v=\${/v}'}, context: context),
          'v=${entry.value.$2}',
        );
      });
    }

    test('coerces a non-string template', () {
      expect(_call(v09, 'formatString', {'value': 42}), '42');
      expect(_call(v09, 'formatString', {'value': null}), '');
    });

    test('resolves paths and calls on a v1.0 context', () {
      final dataModel = DataModel();
      dataModel.set('/name', 'Ada');
      dataModel.set('/count', 2);
      final DataContext context = _contextFor(
        v10,
        protocolVersion: 'v1.0',
        dataModel: dataModel,
      );
      expect(
        _call(
          v10,
          'formatString',
          {
            'value': r"${/name}: ${pluralize(value: /count, one: 'one', "
                r"other: 'many')} ${not(value: false)}",
          },
          context: context,
        ),
        'Ada: many true',
      );
    });

    test('the processing FormatStringFunction delegates to the catalog', () {
      final dataModel = DataModel();
      dataModel.set('/name', 'Ada');
      final DataContext context = _contextFor(
        v10,
        protocolVersion: 'v1.0',
        dataModel: dataModel,
      );
      final Object? result = FormatStringFunction().execute({
        'value': r'Hi ${/name}',
      }, context);
      expect(
        result is ReadonlySignal<Object?> ? result.value : result,
        'Hi Ada',
      );
    });
  });

  group('validators', () {
    test('v1.0 length returns a ValidationResult', () {
      expect(
        _call(v10, 'length', {'value': 'hi', 'min': 3}),
        const ValidationResult(valid: false, message: 'Minimum length is 3.'),
      );
      expect(
        _call(v10, 'length', {'value': 'hello world', 'max': 5}),
        const ValidationResult(valid: false, message: 'Maximum length is 5.'),
      );
      expect(
        _call(v10, 'length', {
          'value': ['a', 'b'],
          'min': 2,
        }),
        const ValidationResult(valid: true),
      );
      expect(_call(v09, 'length', {'value': 'hi', 'min': 3}), isFalse);
    });

    test('required', () {
      expect(
        _call(v10, 'required', {'value': ''}),
        const ValidationResult(
            valid: false, message: 'This field is required.'),
      );
      expect(
        _call(v10, 'required', {'value': <String, Object?>{}}),
        const ValidationResult(valid: true),
      );
      expect(_call(v09, 'required', {'value': <Object?>[]}), isFalse);
      expect(_call(v09, 'required', {'value': 0}), isTrue);
    });

    test('numeric', () {
      expect(
        _call(v10, 'numeric', {'value': 'abc'}),
        const ValidationResult(
          valid: false,
          message: 'Value must be a valid number.',
        ),
      );
      expect(
        _call(v10, 'numeric', {'value': 150, 'max': 100}),
        const ValidationResult(valid: false, message: 'Maximum value is 100.'),
      );
      expect(
        _call(v10, 'numeric', {'value': -5, 'min': 0}),
        const ValidationResult(valid: false, message: 'Minimum value is 0.'),
      );
      expect(_call(v09, 'numeric', {'value': '42.5', 'max': 100}), isTrue);
    });

    test('email matches the TypeScript pattern', () {
      expect(_call(v09, 'email', {'value': 'user@example.com'}), isTrue);
      expect(_call(v09, 'email', {'value': 'test@test.c'}), isFalse);
      expect(_call(v09, 'email', {'value': 'invalid-email'}), isFalse);
      expect(_call(v09, 'email', {'value': 42}), isFalse);
      expect(
        _call(v10, 'email', {'value': 'nope'}),
        const ValidationResult(
          valid: false,
          message: 'Must be a valid email address.',
        ),
      );
      expect(
        _call(v10, 'email', {'value': 'a.b+c@d.io'}),
        const ValidationResult(valid: true),
      );
    });

    test('regex', () {
      expect(
        _call(v09, 'regex', {'value': '123', 'pattern': r'^\d+$'}),
        isTrue,
      );
      expect(
        _call(v10, 'regex', {'value': 'abc', 'pattern': r'^\d+$'}),
        const ValidationResult(
          valid: false,
          message: 'Value does not match required pattern.',
        ),
      );
      expect(
        () => _call(v09, 'regex', {'value': 'abc', 'pattern': '[invalid('}),
        throwsA(isA<A2uiExpressionError>()),
      );
    });
  });

  group('formatNumber', () {
    test('applies decimals and grouping', () {
      expect(
        _call(v10, 'formatNumber', {'value': 1234.567, 'decimals': 2}),
        '1,234.57',
      );
      expect(
        _call(v10, 'formatNumber', {
          'value': 1234.567,
          'decimals': 0,
          'grouping': false,
        }),
        '1235',
      );
      expect(_call(v10, 'formatNumber', {'value': 1234.5678}), '1,234.568');
    });

    test('returns an empty string for a non-number', () {
      expect(_call(v10, 'formatNumber', {'value': 'nope'}), '');
    });

    test('uses the catalog locale', () {
      final _RendererCatalog german = BasicCatalog.v1_0(locale: 'de-DE');
      expect(
        _call(german, 'formatNumber', {'value': 1234.5, 'decimals': 2}),
        '1.234,50',
      );
    });

    test('falls back to en-US for an unknown locale', () {
      final _RendererCatalog unknown = BasicCatalog.v0_9(locale: 'xx-YY');
      expect(
        _call(unknown, 'formatNumber', {'value': 1234.5, 'decimals': 1}),
        '1,234.5',
      );
    });
  });

  group('formatCurrency', () {
    test('uses the currency symbol and the catalog locale', () {
      expect(
        _call(v10, 'formatCurrency', {'value': 1234.5, 'currency': 'EUR'}),
        '€1,234.50',
      );
      expect(
        _call(v10, 'formatCurrency', {
          'value': 1234.5,
          'currency': 'JPY',
          'decimals': 0,
        }),
        '¥1,235',
      );
      final _RendererCatalog german = BasicCatalog.v1_0(locale: 'de-DE');
      expect(
        _call(german, 'formatCurrency', {'value': 1234.5, 'currency': 'EUR'}),
        '1.234,50\u00a0€',
      );
    });

    test('formats with symbol, decimals and grouping', () {
      expect(
        _call(v10, 'formatCurrency', {
          'value': 1234.5,
          'currency': 'USD',
          'decimals': 2,
        }),
        r'$1,234.50',
      );
      expect(
        _call(v09, 'formatCurrency', {'value': 5, 'currency': 'usd'}),
        r'$5.00',
      );
      expect(
        _call(v10, 'formatCurrency', {
          'value': 1234.5,
          'currency': 'USD',
          'grouping': false,
        }),
        r'$1234.50',
      );
    });
  });

  group('formatDate', () {
    String format(Object? value, String pattern) =>
        _call(v10, 'formatDate', {'value': value, 'format': pattern})!
            as String;

    test('expands TR35 tokens in UTC', () {
      expect(format('2026-09-04T12:00:00Z', 'yyyy-MM-dd'), '2026-09-04');
      expect(
        format('2026-09-04T14:05:09Z', 'EEEE, MMMM d, yyyy h:mm a'),
        'Friday, September 4, 2026 2:05 PM',
      );
      expect(format('2026-09-04T14:05:09Z', 'E MMM yy ss'), 'Fri Sep 26 09');
      expect(
          format('2026-01-02T00:07:00Z', 'M/d hh:mm HH H'), '1/2 12:07 00 0');
    });

    test('keeps the wall-clock time of an offset timestamp', () {
      expect(format('2026-09-04T23:30:00-05:00', 'yyyy-MM-dd'), '2026-09-04');
      expect(format('2026-09-04T23:30:00-05:00', 'HH:mm'), '23:30');
    });

    test('treats a timestamp without an offset as UTC', () {
      expect(format('2026-09-04T23:30:00', 'yyyy-MM-dd HH:mm'),
          '2026-09-04 23:30');
      expect(format('2026-09-04', 'MMM d'), 'Sep 4');
    });

    test('ISO emits the UTC instant', () {
      expect(
        format('2026-09-04T23:30:00-05:00', 'ISO'),
        '2026-09-05T04:30:00.000Z',
      );
      expect(
        format('2026-08-26T12:00:00.123456Z', 'ISO'),
        '2026-08-26T12:00:00.123Z',
      );
    });

    test('returns an empty string for missing or invalid input', () {
      expect(format(null, 'yyyy'), '');
      expect(format('', 'yyyy'), '');
      expect(format('not a date', 'yyyy'), '');
    });
  });

  group('pluralize', () {
    test('selects explicit and CLDR categories', () {
      final forms = {'zero': 'none', 'one': 'one', 'other': 'many'};
      expect(_call(v10, 'pluralize', {...forms, 'value': 0}), 'none');
      expect(_call(v10, 'pluralize', {...forms, 'value': 1}), 'one');
      expect(_call(v10, 'pluralize', {...forms, 'value': 5}), 'many');
      expect(_call(v10, 'pluralize', {...forms, 'value': 1.5}), 'many');
      expect(
        _call(v10, 'pluralize', {'value': 0, 'one': 'one', 'other': 'many'}),
        'many',
      );
      expect(
        _call(v10, 'pluralize', {'value': 1, 'other': 'fallback'}),
        'fallback',
      );
    });

    test('preserves an explicit empty string', () {
      expect(
        _call(v10, 'pluralize', {'value': 0, 'zero': '', 'other': 'x'}),
        '',
      );
    });

    test('uses locale plural rules', () {
      final _RendererCatalog polish = BasicCatalog.v1_0(locale: 'pl');
      expect(
        _call(polish, 'pluralize', {
          'value': 3,
          'one': 'plik',
          'few': 'pliki',
          'many': 'plików',
          'other': 'pliku',
        }),
        'pliki',
      );
    });
  });

  group('openUrl', () {
    test('passes a validated Uri to the callback', () async {
      final opened = <Uri>[];
      final _RendererCatalog catalog = BasicCatalog.v1_0(openUrl: opened.add);
      expect(
          _call(catalog, 'openUrl', {'url': 'https://example.com/a'}), isNull);
      expect(opened, [Uri.parse('https://example.com/a')]);
    });

    test('rejects disallowed and relative URLs', () {
      final opened = <Uri>[];
      final _RendererCatalog catalog = BasicCatalog.v0_9(openUrl: opened.add);
      for (final url in ['javascript:alert(1)', 'file:///etc/passwd', 'a/b']) {
        expect(
          () => _call(catalog, 'openUrl', {'url': url}),
          throwsA(isA<A2uiExpressionError>()),
          reason: url,
        );
      }
      expect(opened, isEmpty);
    });

    test('ignores an empty URL', () {
      final opened = <Uri>[];
      final _RendererCatalog catalog = BasicCatalog.v1_0(openUrl: opened.add);
      expect(_call(catalog, 'openUrl', {'url': ''}), isNull);
      expect(opened, isEmpty);
    });

    test('fails without a callback', () {
      expect(
        () => _call(v10, 'openUrl', {'url': 'mailto:a@b.co'}),
        throwsA(isA<A2uiExpressionError>()),
      );
    });

    test('returns the callback future so callers can await it', () async {
      var done = false;
      final _RendererCatalog catalog = BasicCatalog.v1_0(
        openUrl: (_) async {
          await Future<void>.delayed(Duration.zero);
          done = true;
        },
      );
      final Object? result = _call(catalog, 'openUrl', {'url': 'tel:+1555'});
      expect(result, isA<Future<void>>());
      await (result! as Future<void>);
      expect(done, isTrue);
    });
  });
}
