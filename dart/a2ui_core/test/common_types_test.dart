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
import 'package:a2ui_core/src/validation/common_types.g.dart';
import 'package:test/test.dart';

import 'conformance/conformance_harness.dart';

void main() {
  group('published common_types.json', () {
    test('is identical to the specification', () {
      final String specification = File(
        resolveConformancePath('../specification/v0_9/json/common_types.json'),
      ).readAsStringSync();

      expect(
        commonTypesV0_9Json,
        specification,
        reason:
            'lib/src/validation/common_types.g.dart has drifted from the '
            'specification. Run `dart run tool/generate_common_types.dart`.',
      );
    });

    test('parses to the v0.9 document', () {
      final Map<String, Object?> document = A2uiValidator.commonTypesFor(
        A2uiProtocolVersion.v0_9,
      );

      expect(
        document[r'$id'],
        'https://a2ui.org/specification/v0_9/common_types.json',
      );
      expect(document[r'$defs'], contains('ChildList'));
      expect(document[r'$defs'], contains('DynamicString'));
    });

    test('hands out a fresh document each call', () {
      final Map<String, Object?> first = A2uiValidator.commonTypesFor(
        A2uiProtocolVersion.v0_9,
      );
      first.remove(r'$defs');

      expect(
        A2uiValidator.commonTypesFor(A2uiProtocolVersion.v0_9),
        contains(r'$defs'),
      );
    });

    test('is what a validator resolves against by default', () {
      expect(
        A2uiValidator<ComponentApi, FunctionApi>().commonTypesSchema,
        A2uiValidator.commonTypesFor(A2uiProtocolVersion.v0_9),
      );
    });

    test('is what a processor resolves against by default', () {
      expect(
        MessageProcessor(
          catalogs: [MinimalCatalog()],
        ).validator.commonTypesSchema,
        A2uiValidator.commonTypesFor(A2uiProtocolVersion.v0_9),
      );
    });

    test('an empty document leaves the shared types unchecked', () {
      expect(
        A2uiValidator<ComponentApi, FunctionApi>(
          commonTypesSchema: const {},
        ).commonTypesSchema,
        isEmpty,
      );
    });
  });
}
