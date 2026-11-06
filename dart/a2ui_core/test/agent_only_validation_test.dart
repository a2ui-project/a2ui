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

import 'conformance/conformance_harness.dart';

/// A call held in a component (a property binding, a check or an action) is
/// one the renderer makes, so validation rejects one to a function whose
/// `allowedCallers` is `agentOnly`, as does a call nested in the arguments
/// of a `callRendererFunction`.
void main() {
  final Map<String, Object?> basicDocument = readConformanceJson(
    'catalogs/basic/v1/catalog.json',
  );
  final Map<String, Object?> commonTypes = readConformanceJson(
    'specification/v1_0/json/common_types.json',
  );
  final functions = basicDocument['functions']! as Map<String, Object?>;

  /// The basic catalog, with [callers] as the `allowedCallers` of each
  /// function it names, and with [id] as its id when given.
  CatalogApi declaring(Map<String, String> callers, {String? id}) =>
      Catalog.fromJson({
        ...basicDocument,
        if (id != null) 'catalogId': id,
        if (id != null) r'$id': id,
        'functions': {
          ...functions,
          for (final MapEntry<String, String> entry in callers.entries)
            entry.key: {
              ...functions[entry.key]! as Map<String, Object?>,
              'allowedCallers': entry.value,
            },
        },
      });

  final CatalogApi agentOnly = declaring({
    'formatString': 'agentOnly',
    'required': 'agentOnly',
  });
  final CatalogApi shared = declaring({
    'formatString': 'rendererOrAgent',
    'required': 'rendererOrAgent',
  });

  const message =
      "Function 'formatString' cannot be called by renderer (allowedCallers "
      'is agentOnly).';

  Matcher refused(String path, [String text = message]) => throwsA(
        isA<A2uiValidationError>()
            .having((e) => e.message, 'message', contains(text))
            .having((e) => e.path, 'path', path),
      );

  final Map<String, Object?> formatHello = {
    '@call': 'formatString',
    'args': {'value': 'Hello'},
  };

  group('PayloadValidator', () {
    PayloadValidator<ComponentApi, FunctionApi> validator(CatalogApi c) =>
        PayloadValidator<ComponentApi, FunctionApi>(
          catalog: c,
          protocolVersion: A2uiProtocolVersion.v1_0,
          commonTypesSchema: commonTypes,
        );

    final Map<String, Object?> boundText = {
      'id': 't',
      'component': 'Text',
      'text': formatHello,
    };

    test('rejects an agentOnly function bound to a property', () {
      expect(
        () => validator(agentOnly).validateComponent(boundText),
        refused('/text'),
      );
    });

    test('reports the error at the call, with a detail', () {
      try {
        validator(agentOnly).validateComponent(boundText);
        fail('accepted');
      } on A2uiValidationError catch (e) {
        expect(e.errors.single.path, '/text');
        expect(e.errors.single.code, 'invalid_function_call');
        expect(e.message, "In component 't': $message");
      }
    });

    test('rejects an agentOnly function in an action', () {
      expect(
        () => validator(agentOnly).validateComponent({
          'id': 'b',
          'component': 'Button',
          'child': 't',
          'action': {'functionCall': formatHello},
        }),
        refused('/action/functionCall'),
      );
    });

    test('rejects an agentOnly function in a check', () {
      expect(
        () => validator(agentOnly).validateComponent({
          'id': 'f',
          'component': 'TextField',
          'label': 'Name',
          'value': 'Ada',
          'checks': [
            {
              'condition': {
                '@call': 'required',
                'args': {'value': 'Ada'},
              },
              'message': 'Required',
            },
          ],
        }),
        refused(
          '/checks/0/condition',
          "Function 'required' cannot be called by renderer",
        ),
      );
    });

    test('rejects an agentOnly function nested in arguments', () {
      expect(
        () => validator(agentOnly).validateComponent({
          'id': 't',
          'component': 'Text',
          'text': {
            '@call': 'formatNumber',
            'args': {'value': 1, 'decimals': formatHello},
          },
        }),
        refused('/text/args/decimals'),
      );
    });

    test('accepts a rendererOrAgent or rendererOnly function', () {
      for (final CatalogApi c in [shared, declaring({})]) {
        expect(
          () => validator(c).validateComponent(boundText),
          returnsNormally,
        );
      }
    });

    test(
        'leaves a nested call that names no catalog to the caller when the '
        'catalog is not the default', () {
      final Map<String, Object?> args = {
        'value': {'@call': 'greet'},
      };
      expect(
        () => validator(shared).validateFunction('formatString', args),
        throwsA(isA<A2uiValidationError>()),
      );
      validator(shared).validateFunction(
        'formatString',
        args,
        catalogIsDefault: false,
      );
    });

    test('lets validateFunction check the arguments of an agentOnly call', () {
      expect(
        () => validator(agentOnly).validateFunction(
          'formatString',
          {'value': 'Hello'},
        ),
        returnsNormally,
      );
    });

    test(
        'rejects an agentOnly call in validateFunctionArgs only for a '
        'component', () {
      expect(
        () => validator(agentOnly).validateFunctionArgs(
          'formatString',
          {'value': 'Hello'},
          componentId: 't',
          path: '/text',
        ),
        refused('/text'),
      );
      expect(
        () => validator(agentOnly).validateFunctionArgs(
          'formatString',
          {'value': 'Hello'},
        ),
        returnsNormally,
      );
    });

    test('accepts an agentOnly function bound in a v0.9 catalog', () {
      // `allowedCallers` is a v1.0 feature, so v0.9 ignores it.
      final CatalogApi v09 = Catalog.fromJson({
        'catalogId': 'arcana',
        'components': {
          'Label': {
            'type': 'object',
            'properties': {
              'id': {'type': 'string'},
              'component': {'const': 'Label'},
              'text': <String, Object?>{},
            },
            'required': ['component', 'text'],
          },
        },
        'functions': {
          'getMoonPhase': {
            'type': 'object',
            'allowedCallers': 'agentOnly',
            'returnType': 'string',
            'properties': {
              'call': {'const': 'getMoonPhase'},
              'args': {'type': 'object'},
            },
            'required': ['call'],
          },
        },
      });
      final Map<String, Object?> label = {
        'id': 'root',
        'component': 'Label',
        'text': {
          'call': 'getMoonPhase',
          'args': {'date': 'today'},
        },
      };
      PayloadValidator<ComponentApi, FunctionApi>(
        catalog: v09,
        protocolVersion: A2uiProtocolVersion.v0_9,
        commonTypesSchema: readConformanceJson(
          'specification/v0_9/json/common_types.json',
        ),
      )
        ..validateComponent(label)
        ..validateFunctionArgs(
          'getMoonPhase',
          {'date': 'today'},
          componentId: 'root',
          path: '/text',
        );
    });
  });

  group('MessageProcessor', () {
    MessageProcessor<ComponentApi> processor(List<CatalogApi> catalogs) {
      final MessageProcessor<ComponentApi> p = MessageProcessor.forAgent(
        catalogs: catalogs,
        validationConfig: ValidationConfig.strict,
      );
      addTearDown(p.model.dispose);
      return p;
    }

    Map<String, Object?> surfaceWith(
      CatalogApi catalog,
      Map<String, Object?> component,
    ) =>
        {
          'version': '1.0',
          'createSurface': {
            'surfaceId': 's',
            'catalogId': catalog.id,
            'components': [component],
          },
        };

    test('rejects an agentOnly function bound into a component', () {
      expect(
        () => processor([agentOnly]).processMessages([
          surfaceWith(agentOnly, {
            'id': 'root',
            'component': 'Text',
            'text': formatHello,
          }),
        ]),
        throwsA(
          isA<A2uiValidationError>()
              .having((e) => e.message, 'message', contains(message)),
        ),
      );
    });

    test('accepts a rendererOrAgent function bound into a component', () {
      processor([shared]).processMessages([
        surfaceWith(shared, {
          'id': 'root',
          'component': 'Text',
          'text': formatHello,
        }),
      ]);
    });

    group('with a call into another catalog', () {
      final CatalogApi other = declaring(
        {'formatString': 'agentOnly'},
        id: 'https://example.com/other.json',
      );
      final CatalogApi otherShared = declaring(
        {'formatString': 'rendererOrAgent'},
        id: 'https://example.com/other.json',
      );
      final CatalogApi plain = declaring({});

      Map<String, Object?> callingOther(Map<String, Object?> extra) =>
          surfaceWith(plain, {
            'id': 'root',
            'component': 'Button',
            'child': 'root',
            'action': {
              'functionCall': {
                ...formatHello,
                'catalogId': other.id,
                ...extra,
              },
            },
          });

      test('rejects one to an agentOnly function', () {
        expect(
          () => processor([plain, other]).processMessages([
            callingOther({}),
          ]),
          throwsA(
            isA<A2uiValidationError>()
                .having(
                  (e) => e.message,
                  'message',
                  "Function call 'formatString' in component 'root' is a call "
                      "the renderer can't make: $message",
                )
                .having(
                  (e) => e.path,
                  'path',
                  endsWith('/action/functionCall'),
                ),
          ),
        );
      });

      test('accepts one to a rendererOrAgent function', () {
        expect(
          () => processor([plain, otherShared]).processMessages([
            surfaceWith(plain, {
              'id': 'root',
              'component': 'Text',
              'text': {...formatHello, 'catalogId': otherShared.id},
            }),
          ]),
          returnsNormally,
        );
      });
    });

    group('callRendererFunction', () {
      Map<String, Object?> call(
        CatalogApi catalog,
        Map<String, Object?> args,
      ) =>
          {
            'version': '1.0',
            'callRendererFunction': {
              'functionCallId': 'f1',
              'callFunction': {
                'catalogId': catalog.id,
                '@call': 'formatString',
                'args': args,
              },
            },
          };

      test('accepts a call to an agentOnly function', () {
        processor([agentOnly]).processMessages([
          call(agentOnly, {'value': 'Hello'}),
        ]);
      });

      test('rejects an agentOnly function nested in its arguments', () {
        expect(
          () => processor([agentOnly]).processMessages([
            call(agentOnly, {'value': formatHello}),
          ]),
          throwsA(
            isA<A2uiValidationError>().having(
              (e) => e.message,
              'message',
              allOf(
                contains("Function call 'formatString' in function call "
                    "'f1'"),
                contains(message),
              ),
            ),
          ),
        );
      });

      test(
          'rejects an agentOnly function of another catalog nested in its '
          'arguments', () {
        final CatalogApi other = declaring(
          {'formatString': 'agentOnly'},
          id: 'https://example.com/other.json',
        );
        expect(
          () => processor([shared, other]).processMessages([
            call(shared, {
              'value': {...formatHello, 'catalogId': other.id},
            }),
          ]),
          throwsA(
            isA<A2uiValidationError>()
                .having((e) => e.message, 'message', contains(message)),
          ),
        );
      });

      test('accepts a rendererOrAgent function nested in its arguments', () {
        processor([shared]).processMessages([
          call(shared, {'value': formatHello}),
        ]);
      });

      final Map<String, Object?> openUrl = {
        '@call': 'openUrl',
        'args': {'url': 'https://example.com'},
      };

      test(
          'rejects a function that requires a user activation nested in '
          'its arguments', () {
        expect(
          () => processor([shared]).processMessages([
            call(shared, {'value': openUrl}),
          ]),
          throwsA(
            isA<A2uiValidationError>().having(
              (e) => e.message,
              'message',
              "Function call 'openUrl' in function call 'f1' is a call the "
                  "renderer can't make: Function 'openUrl' requires a user "
                  'activation, and a call from the agent has none.',
            ),
          ),
        );
      });

      test(
          'accepts one that requires a user activation when the call has '
          'one', () {
        processor([shared]).processMessages(
          [
            call(shared, {'value': openUrl}),
          ],
          isUserActivated: true,
        );
      });

      // `echo` takes any arguments, so only the checks of nested values
      // judge them.
      final CatalogApi loose = Catalog.fromJson({
        'catalogId': 'https://example.com/loose.json',
        'protocolVersion': '1.0',
        'components': <String, Object?>{},
        'functions': {
          'echo': {
            'type': 'object',
            'returnType': 'any',
            'allowedCallers': 'rendererOrAgent',
            'properties': {
              '@call': {'const': 'echo'},
              'args': {'type': 'object'},
            },
            'required': ['@call'],
          },
        },
      });
      Map<String, Object?> echo(Map<String, Object?> args) => {
            'version': '1.0',
            'callRendererFunction': {
              'functionCallId': 'f1',
              'callFunction': {
                'catalogId': loose.id,
                '@call': 'echo',
                'args': args,
              },
            },
          };

      Matcher refusedWith(String text, String path) => throwsA(
            isA<A2uiValidationError>()
                .having((e) => e.message, 'message', contains(text))
                .having((e) => e.path, 'path', path),
          );

      test(
          'rejects an @index call nested in its arguments, which are '
          'resolved outside any list template', () {
        for (final Map<String, Object?> args in [
          {
            'value': {'@call': '@index'},
          },
          {
            'value': {
              '@call': 'echo',
              'args': {
                'value': {'@call': '@index'},
              },
            },
          },
        ]) {
          expect(
            () => processor([loose]).processMessages([echo(args)]),
            throwsA(
              isA<A2uiValidationError>().having(
                (e) => e.message,
                'message',
                contains("calls '@index', which has no list item here"),
              ),
            ),
            reason: '$args',
          );
        }
      });

      test('rejects null args on a nested @index call before @index', () {
        expect(
          () => processor([loose]).processMessages([
            echo({
              'value': {'@call': '@index', 'args': null},
            }),
          ]),
          refusedWith("'args' must be an object", '/value/args'),
        );
      });

      test('rejects a data binding whose @path is not a string', () {
        expect(
          () => processor([loose]).processMessages([
            echo({
              'value': {'@path': 5},
            }),
          ]),
          refusedWith("non-string '@path'", '/value/@path'),
        );
      });

      test('rejects a data binding with a field other than @path', () {
        expect(
          () => processor([loose]).processMessages([
            echo({
              'value': {
                '@call': 'echo',
                'args': {
                  'value': {'@path': '/user/name', 'bogus': 1},
                },
              },
            }),
          ]),
          refusedWith("field 'bogus'", '/value/args/value/bogus'),
        );
      });

      test('accepts an absolute or relative data binding', () {
        for (final path in ['/user/name', 'name']) {
          processor([loose]).processMessages([
            echo({
              'value': {'@path': path},
            }),
          ]);
        }
      });

      group('on a surface', () {
        // `extra` declares `greet`, which the basic catalog does not.
        final CatalogApi extra = Catalog.fromJson({
          'catalogId': 'https://example.com/extra.json',
          'protocolVersion': '1.0',
          'components': <String, Object?>{},
          'functions': {
            'greet': {
              'type': 'object',
              'returnType': 'string',
              'allowedCallers': 'rendererOrAgent',
              'properties': {
                '@call': {'const': 'greet'},
                'args': {'type': 'object', 'additionalProperties': false},
              },
              'required': ['@call'],
            },
            'echo': {
              'type': 'object',
              'returnType': 'any',
              'allowedCallers': 'rendererOrAgent',
              'properties': {
                '@call': {'const': 'echo'},
                'args': {'type': 'object'},
              },
              'required': ['@call'],
            },
          },
        });
        const greet = {'@call': 'greet'};

        test('rejects a null catalogId or null args on a nested call', () {
          for (final MapEntry<String, String> entry in {
            'catalogId': "'catalogId' must be a string",
            'args': "'args' must be an object",
          }.entries) {
            expect(
              () => processor([shared, extra]).processMessages([
                {
                  'version': '1.0',
                  'callRendererFunction': {
                    'functionCallId': 'f1',
                    'callFunction': {
                      'catalogId': extra.id,
                      '@call': 'echo',
                      'args': {
                        'value': {'@call': 'greet', entry.key: null},
                      },
                    },
                  },
                },
              ]),
              throwsA(
                isA<A2uiValidationError>()
                    .having((e) => e.message, 'message', contains(entry.value))
                    .having((e) => e.path, 'path', '/value/${entry.key}'),
              ),
              reason: entry.key,
            );
          }
        });

        Map<String, Object?> createSurface([String? catalogId]) => {
              'version': '1.0',
              'createSurface': {
                'surfaceId': 's',
                if (catalogId != null) 'catalogId': catalogId,
              },
            };

        CallRendererFunctionMessage onSurface(String surfaceId) =>
            CallRendererFunctionMessage(
              version: '1.0',
              surfaceId: surfaceId,
              functionCallId: 'f1',
              callFunction: {
                'catalogId': shared.id,
                '@call': 'formatString',
                'args': {'value': greet},
              },
            );

        test(
            "runs a nested call that names no catalog in the surface's "
            'default catalog', () {
          processor([shared, extra]).processMessages([
            createSurface(extra.id),
            onSurface('s').toJson(),
          ]);
        });

        test('rejects one when the surface has no default catalog', () {
          final MessageProcessor<ComponentApi> p = processor([shared, extra])
            ..processMessages([createSurface()]);
          expect(
            () => p.checkRendererFunctionCall(onSurface('s')),
            throwsA(
              isA<A2uiValidationError>().having(
                (e) => e.message,
                'message',
                "Function call 'greet' in function call 'f1' names no "
                    "catalogId, and surface 's' has no default catalog.",
              ),
            ),
          );
        });

        test('accepts one on an assumed surface if a catalog declares it', () {
          final MessageProcessor<ComponentApi> p = processor([shared, extra])
            ..processMessages([createSurface(shared.id)]);
          p.checkRendererFunctionCall(onSurface('elsewhere'));
          p.checkRendererFunctionCall(onSurface('s'), assumesSurface: true);
          expect(
            () => p.checkRendererFunctionCall(onSurface('s')),
            throwsA(
              isA<A2uiValidationError>().having(
                (e) => e.message,
                'message',
                contains("Unrecognized function 'greet'"),
              ),
            ),
          );
        });
      });
    });
  });
}
