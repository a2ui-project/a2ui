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
import 'package:a2ui_core/src/validation/component_graph.dart';
import 'package:test/test.dart';

void main() {
  group('checkPathsAndRecursion', () {
    test(
      'skips binding path and call-depth checks inside updateDataModel.value',
      () {
        Map<String, Object?> deepCallValue = {'leaf': true};
        for (var i = 0; i < maxFunctionCallDepth + 3; i++) {
          deepCallValue = {
            'call': 'fn_$i',
            '@call': 'fn_$i',
            'path': 'invalid~tilde~path',
            '@path': 'invalid~tilde~path',
            'args': deepCallValue,
          };
        }

        final messageJson = <String, Object?>{
          'version': 'v0.9',
          'updateDataModel': {
            'surfaceId': 's1',
            'path': '/valid/path',
            'value': deepCallValue,
          },
        };

        expect(() => checkPathsAndRecursion(messageJson), returnsNormally);
        expect(
          () => checkPathsAndRecursion(messageJson, v1: true),
          returnsNormally,
        );

        final typedMessage = UpdateDataModelMessage(
          version: 'v0.9',
          surfaceId: 's1',
          path: '/valid/path',
          value: deepCallValue,
        );
        expect(() => checkPathsAndRecursion(typedMessage), returnsNormally);
      },
    );

    test('validates updateDataModel.path syntax', () {
      final invalidJson = <String, Object?>{
        'version': 'v0.9',
        'updateDataModel': {
          'surfaceId': 's1',
          'path': '/invalid~path',
          'value': {'ok': true},
        },
      };

      expect(
        () => checkPathsAndRecursion(invalidJson),
        throwsA(isA<A2uiValidationError>()),
      );

      final typedInvalid = UpdateDataModelMessage(
        version: 'v0.9',
        surfaceId: 's1',
        path: '/invalid~path',
        value: const {'ok': true},
      );
      expect(
        () => checkPathsAndRecursion(typedInvalid),
        throwsA(isA<A2uiValidationError>()),
      );
    });

    test('still enforces global recursion limit on updateDataModel.value', () {
      Map<String, Object?> deepData = {'leaf': 1};
      for (var i = 0; i < maxComponentDepth + 5; i++) {
        deepData = {'nested': deepData};
      }

      final messageJson = <String, Object?>{
        'version': 'v0.9',
        'updateDataModel': {
          'surfaceId': 's1',
          'path': '/',
          'value': deepData,
        },
      };

      expect(
        () => checkPathsAndRecursion(messageJson),
        throwsA(isA<A2uiRecursionError>()),
      );
    });

    test('handles non-String map keys in updateDataModel.value', () {
      final messageJson = <String, Object?>{
        'version': 'v0.9',
        'updateDataModel': {
          'surfaceId': 's1',
          'path': '/items',
          'value': <Object?, Object?>{
            1: 'one',
            2: <Object?, Object?>{true: 'nested'},
          },
        },
      };

      expect(() => checkPathsAndRecursion(messageJson), returnsNormally);
    });

    test('v0.9 mode validates path bindings, templates, and call depth', () {
      expect(
        () => checkPathsAndRecursion(
          {
            'version': 'v0.9',
            'updateComponents': {
              'surfaceId': 's1',
              'components': [
                {
                  'id': 'root',
                  'component': 'Text',
                  'text': {'path': '/bad~path'},
                },
              ],
            },
          },
          v1: false,
        ),
        throwsA(isA<A2uiValidationError>()),
      );

      expect(
        () => checkPathsAndRecursion(
          {
            'version': 'v0.9',
            'updateComponents': {
              'surfaceId': 's1',
              'components': [
                {
                  'id': 'root',
                  'component': 'Column',
                  'children': {'path': '/bad~path', 'componentId': 'item'},
                },
              ],
            },
          },
          v1: false,
        ),
        throwsA(isA<A2uiValidationError>()),
      );

      // @path is literal in v0.9 and should not be validated as a data binding.
      expect(
        () => checkPathsAndRecursion(
          {
            'version': 'v0.9',
            'updateComponents': {
              'surfaceId': 's1',
              'components': [
                {
                  'id': 'root',
                  'component': 'Text',
                  'meta': {'@path': 'not~a~pointer'},
                },
              ],
            },
          },
          v1: false,
        ),
        returnsNormally,
      );

      Map<String, Object?> nestedCall = {
        'call': 'leaf',
        'args': <String, Object?>{}
      };
      for (var i = 0; i < maxFunctionCallDepth; i++) {
        nestedCall = {
          'call': 'fn_$i',
          'args': {'inner': nestedCall},
        };
      }
      expect(
        () => checkPathsAndRecursion(nestedCall, v1: false),
        throwsA(isA<A2uiRecursionError>()),
      );
      // In v1.0 mode, plain 'call' is not a function call object.
      expect(
        () => checkPathsAndRecursion(nestedCall, v1: true),
        returnsNormally,
      );
    });

    test(
        'v1.0 mode validates @path, templates, and @call while ignoring path/call',
        () {
      expect(
        () => checkPathsAndRecursion(
          {
            'version': 'v1.0',
            'updateComponents': {
              'surfaceId': 's1',
              'components': [
                {
                  'id': 'root',
                  'component': 'Text',
                  'text': {'@path': '/bad~path'},
                },
              ],
            },
          },
        ),
        throwsA(isA<A2uiValidationError>()),
      );

      // ChildListTemplate still uses {path, componentId} in v1.0.
      expect(
        () => checkPathsAndRecursion(
          {
            'version': 'v1.0',
            'updateComponents': {
              'surfaceId': 's1',
              'components': [
                {
                  'id': 'root',
                  'component': 'Column',
                  'children': {'path': '/bad~path', 'componentId': 'item'},
                },
              ],
            },
          },
        ),
        throwsA(isA<A2uiValidationError>()),
      );

      // Plain {'path': 'not~a~pointer'} without componentId is literal in v1.0.
      expect(
        () => checkPathsAndRecursion(
          {
            'version': 'v1.0',
            'updateComponents': {
              'surfaceId': 's1',
              'components': [
                {
                  'id': 'root',
                  'component': 'Button',
                  'action': {
                    'event': {
                      'name': 'open',
                      'context': {'path': 'not~a~pointer'},
                    },
                  },
                },
              ],
            },
          },
        ),
        returnsNormally,
      );

      Map<String, Object?> nestedAtCall = {
        '@call': 'leaf',
        'args': <String, Object?>{},
      };
      for (var i = 0; i < maxFunctionCallDepth; i++) {
        nestedAtCall = {
          '@call': 'fn_$i',
          'args': {'inner': nestedAtCall},
        };
      }
      expect(
        () => checkPathsAndRecursion(nestedAtCall, v1: true),
        throwsA(isA<A2uiRecursionError>()),
      );
      expect(
        () => checkPathsAndRecursion(nestedAtCall, v1: false),
        returnsNormally,
      );
    });
  });
}
