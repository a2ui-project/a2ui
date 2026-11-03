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

import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

class _ForbiddenHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    throw StateError('Unexpected HttpClient creation during schema resolution');
  }
}

T _runWithoutNetworkOrDiskIo<T>(T Function() body) {
  return HttpOverrides.runZoned(
    () => IOOverrides.runZoned(
      body,
      createFile: (String path) =>
          throw StateError('Unexpected File access: $path'),
      createDirectory: (String path) =>
          throw StateError('Unexpected Directory access: $path'),
      createLink: (String path) =>
          throw StateError('Unexpected Link access: $path'),
      socketConnect: (
        Object? host,
        int port, {
        Object? sourceAddress,
        int sourcePort = 0,
        Duration? timeout,
      }) =>
          throw StateError('Unexpected socketConnect to $host:$port'),
      socketStartConnect: (
        Object? host,
        int port, {
        Object? sourceAddress,
        int sourcePort = 0,
      }) =>
          throw StateError('Unexpected socketStartConnect to $host:$port'),
    ),
    createHttpClient: _ForbiddenHttpOverrides().createHttpClient,
  );
}

void main() {
  group('Network-free and disk-free catalog \$ref resolution', () {
    test(
        'loads and validates v1.0 catalog \$refs to common_types.json with zero I/O',
        () {
      _runWithoutNetworkOrDiskIo(() {
        final CatalogApi catalog = Catalog.fromJson({
          'catalogId': 'https://example.com/catalogs/network_free_v1_0.json',
          'protocolVersion': '1.0',
          r'$defs': {
            'BadgeTone': {
              'type': 'string',
              'enum': ['info', 'warning'],
            },
          },
          'components': {
            'FormInput': {
              'type': 'object',
              'allOf': [
                {r'$ref': r'common_types.json#/$defs/Checkable'},
              ],
              'properties': {
                'component': {'const': 'FormInput'},
                'label': {r'$ref': r'common_types.json#/$defs/DynamicString'},
                'count': {
                  r'$ref': 'https://a2ui.org/specification/v1_0/'
                      r'common_types.json#/$defs/DynamicNumber',
                },
                'child': {r'$ref': r'common_types.json#/$defs/Child'},
                'tone': {r'$ref': r'#/$defs/BadgeTone'},
              },
              'required': ['component', 'label'],
            },
          },
        });

        final PayloadValidator<ComponentApi, FunctionApi> validator =
            PayloadValidator(catalog: catalog);

        validator.validateComponent({
          'id': 'input_1',
          'component': 'FormInput',
          'label': {'@path': '/form/title'},
          'count': 3,
          'child': 'child_1',
          'tone': 'info',
          'checks': [
            {
              'condition': {'@path': '/form/isValid'},
              'message': 'Must be valid',
            },
          ],
          'accessibility': {'label': 'Form input field'},
        });

        expect(
          () => validator.validateComponent({
            'id': 'input_bad',
            'component': 'FormInput',
            'label': 12345,
          }),
          throwsA(isA<A2uiValidationError>()),
        );
      });
    });

    test(
        'loads and validates v0.9 catalog \$refs to common_types.json with zero I/O',
        () {
      _runWithoutNetworkOrDiskIo(() {
        final CatalogApi catalog = Catalog.fromJson({
          'catalogId': 'https://example.com/catalogs/network_free_v0_9.json',
          'components': {
            'CustomCard': {
              'type': 'object',
              'allOf': [
                {
                  r'$ref': 'https://a2ui.org/specification/v0_9/'
                      r'common_types.json#/$defs/ComponentCommon',
                },
              ],
              'properties': {
                'component': {'const': 'CustomCard'},
                'title': {
                  r'$ref': 'https://a2ui.org/specification/v0_9/'
                      r'common_types.json#/$defs/DynamicString',
                },
              },
              'required': ['component', 'title'],
            },
          },
        }, protocolVersion: A2uiProtocolVersion.v0_9);

        final PayloadValidator<ComponentApi, FunctionApi> validator =
            PayloadValidator(catalog: catalog);

        validator.validateComponent({
          'id': 'card_1',
          'component': 'CustomCard',
          'title': {'path': '/card/title'},
          'accessibility': {'label': 'Card label'},
        });

        expect(
          () => validator.validateComponent({
            'id': 'card_bad',
            'component': 'CustomCard',
            'title': {'invalid': true},
          }),
          throwsA(isA<A2uiValidationError>()),
        );
      });
    });
  });
}
