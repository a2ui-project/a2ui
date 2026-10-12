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
import 'package:json_schema_builder/json_schema_builder.dart';
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
        reason: 'lib/src/validation/common_types.g.dart has drifted from the '
            'specification. Run `dart run tool/generate_common_types.dart`.',
      );
    });

    test('embeds the v1.0 document verbatim', () {
      final String specification = File(
        resolveConformancePath('../specification/v1_0/json/common_types.json'),
      ).readAsStringSync();

      expect(
        commonTypesV1_0Json,
        specification,
        reason: 'lib/src/validation/common_types.g.dart has drifted from the '
            'specification. Run `dart run tool/generate_common_types.dart`.',
      );
    });

    test('picks the document by catalog protocol version', () {
      for (final A2uiProtocolVersion version in [
        A2uiProtocolVersion.v0_9,
        A2uiProtocolVersion.v0_9_1,
      ]) {
        expect(
          PayloadValidator.commonTypesFor(version)[r'$id'],
          'https://a2ui.org/specification/v0_9/common_types.json',
          reason: version.jsonValue,
        );
      }
      expect(
        PayloadValidator.commonTypesFor(A2uiProtocolVersion.v1_0)[r'$id'],
        'https://a2ui.org/specification/v1_0/common_types.json',
      );
    });

    test('a catalog declaring no version resolves against v0.9', () {
      final catalog = Catalog<ComponentApi, FunctionApi>(
        id: 'unversioned',
        components: const [],
      );
      expect(
        catalog.commonTypesSchema[r'$id'],
        'https://a2ui.org/specification/v0_9/common_types.json',
      );
      expect(
        PayloadValidator(catalog: catalog).commonTypesSchema[r'$id'],
        'https://a2ui.org/specification/v0_9/common_types.json',
      );
    });

    test('parses to the v0.9 document', () {
      final Map<String, Object?> document = PayloadValidator.commonTypesFor(
        A2uiProtocolVersion.v0_9,
      );

      expect(
        document[r'$id'],
        'https://a2ui.org/specification/v0_9/common_types.json',
      );
      expect(document[r'$defs'], contains('ChildList'));
      expect(document[r'$defs'], contains('DynamicString'));
    });

    test('parses to the v1.0 document for v1.0', () {
      final Map<String, Object?> document = PayloadValidator.commonTypesFor(
        A2uiProtocolVersion.v1_0,
      );

      expect(
        document[r'$id'],
        'https://a2ui.org/specification/v1_0/common_types.json',
      );
      expect(document[r'$defs'], contains('Child'));
    });

    test('hands out a fresh document each call', () {
      final Map<String, Object?> first = PayloadValidator.commonTypesFor(
        A2uiProtocolVersion.v0_9,
      );
      first.remove(r'$defs');

      expect(
        PayloadValidator.commonTypesFor(A2uiProtocolVersion.v0_9),
        contains(r'$defs'),
      );
    });

    test('is what a validator resolves against by default', () {
      expect(
        PayloadValidator<ComponentApi, FunctionApi>(
          catalog: MinimalCatalog(),
          protocolVersion: A2uiProtocolVersion.v0_9,
        ).commonTypesSchema,
        PayloadValidator.commonTypesFor(A2uiProtocolVersion.v0_9),
      );
    });

    test('is what a processor resolves against by default', () {
      final catalog = MinimalCatalog();
      final MessageProcessor<ComponentApi> processor =
          MessageProcessor(catalogs: [catalog]);
      expect(processor.commonTypesSchema, isNull);
      expect(
        processor
            .validatorFor(catalog, version: A2uiProtocolVersion.v0_9)
            .commonTypesSchema,
        PayloadValidator.commonTypesFor(A2uiProtocolVersion.v0_9),
      );
    });

    test('an empty document leaves the shared types unchecked', () {
      expect(
        PayloadValidator<ComponentApi, FunctionApi>(
          catalog: MinimalCatalog(),
          protocolVersion: A2uiProtocolVersion.v0_9,
          commonTypesSchema: const {},
        ).commonTypesSchema,
        isEmpty,
      );
    });
  });

  group('CommonSchemas', () {
    test('carries the v0.9 definitions', () {
      for (final Schema schema in [
        CommonSchemas.dynamicNumber,
        CommonSchemas.dynamicStringList,
        CommonSchemas.dynamicValue,
        CommonSchemas.accessibilityAttributes,
        CommonSchemas.checkRule,
        CommonSchemas.componentCommon,
      ]) {
        expect(schema.value, isNotEmpty);
      }
      expect(CommonSchemas.dynamicNumber.validateSync(3), isEmpty);
      expect(
        CommonSchemas.dynamicNumber.validateSync({'path': '/n'}),
        isEmpty,
      );
      expect(CommonSchemas.componentCommon.validateSync(<String, Object?>{}),
          isNotEmpty);
    });

    test('carries the v1.0 definitions keyed on @path and @call', () {
      expect(
        CommonSchemasV1.dataBinding.validateSync({'@path': '/a'}),
        isEmpty,
      );
      expect(
        CommonSchemasV1.dataBinding.validateSync({'path': '/a'}),
        isNotEmpty,
      );
      expect(
        CommonSchemasV1.functionCall.validateSync({'@call': 'f'}),
        isEmpty,
      );
      expect(
        CommonSchemasV1.functionCall.validateSync({'call': 'f'}),
        isNotEmpty,
      );
      for (final Schema schema in [
        CommonSchemasV1.dynamicString,
        CommonSchemasV1.dynamicNumber,
        CommonSchemasV1.dynamicBoolean,
        CommonSchemasV1.dynamicStringList,
        CommonSchemasV1.accessibilityAttributes,
        CommonSchemasV1.checkRule,
        CommonSchemasV1.componentCommon,
      ]) {
        expect(schema.value, isNotEmpty);
      }
    });

    test('v1.0 DynamicValue rejects unknown single-@ keys', () {
      final Schema schema = CommonSchemasV1.dynamicValue;

      expect(schema.value.toString(), contains('propertyNames'));
      expect(schema.value.toString(), contains(r'^@([^@]|$)'));
      expect(schema.validateSync({'@if': true}), isNotEmpty);
      expect(schema.validateSync({'@': 'x'}), isNotEmpty);
      expect(schema.validateSync({'@@path': '/x'}), isEmpty);
      expect(schema.validateSync({'path': 'a', 'call': 'b'}), isEmpty);
      expect(schema.validateSync({'@path': '/a'}), isEmpty);
      expect(schema.validateSync({'@call': 'f'}), isEmpty);
      expect(schema.validateSync('text'), isEmpty);
    });

    test('every builder names its common type in commonTypesRef', () {
      final named = <String, Schema>{
        'DynamicNumber': CommonSchemas.dynamicNumber,
        'DynamicStringList': CommonSchemas.dynamicStringList,
        'DynamicValue': CommonSchemas.dynamicValue,
        'AccessibilityAttributes': CommonSchemas.accessibilityAttributes,
        'CheckRule': CommonSchemas.checkRule,
        'ComponentCommon': CommonSchemas.componentCommon,
        'DataBinding': CommonSchemasV1.dataBinding,
        'FunctionCall': CommonSchemasV1.functionCall,
        'DynamicString': CommonSchemasV1.dynamicString,
        'DynamicBoolean': CommonSchemasV1.dynamicBoolean,
      };
      for (final MapEntry<String, Schema> entry in named.entries) {
        expect(
          entry.value.value['commonTypesRef'],
          'common_types.json#/\$defs/${entry.key}',
          reason: entry.key,
        );
        expect(
          entry.value.value['description'],
          isNot(startsWith('REF:')),
          reason: entry.key,
        );
      }
      for (final Schema schema in [
        CommonSchemasV1.dynamicNumber,
        CommonSchemasV1.dynamicStringList,
        CommonSchemasV1.dynamicValue,
        CommonSchemasV1.accessibilityAttributes,
        CommonSchemasV1.checkRule,
        CommonSchemasV1.componentCommon,
      ]) {
        expect(schema.value['commonTypesRef'], startsWith('common_types.json'));
        expect(schema.value['description'], isNot(startsWith('REF:')));
      }
      expect(
        CommonSchemasV1.dataBinding.value['description'],
        'A JSON Pointer path to a value in the data model.',
      );
    });
  });

  group('CommonSchemas.functionCall', () {
    test('returnType enum matches the v0.9 specification document', () {
      final Map<String, Object?> document = PayloadValidator.commonTypesFor(
        A2uiProtocolVersion.v0_9,
      );
      final specEnum = (((document[r'$defs']! as Map)['FunctionCall']
          as Map)['properties'] as Map)['returnType'] as Map;
      final dartEnum = (CommonSchemas.functionCall.value['properties']!
          as Map)['returnType'] as Map;

      expect(
        dartEnum['enum'],
        specEnum['enum'],
        reason: 'CommonSchemas is the v0.9 wire shape; its returnType enum '
            'must stay identical to the v0.9 common_types.json document.',
      );
    });

    test('A2uiReturnType.validationResult round-trips at the API level', () {
      expect(
        A2uiReturnType.fromJson('validationResult'),
        A2uiReturnType.validationResult,
      );
      expect(
        A2uiReturnType.validationResult.jsonValue,
        'validationResult',
      );
    });

    test('the v1.0 wire FunctionCall carries no returnType', () {
      final Map<String, Object?> properties =
          (CommonSchemasV1.functionCall.value['properties']! as Map)
              .cast<String, Object?>();
      expect(properties, isNot(contains('returnType')));
      expect(properties.keys, containsAll(['@call', 'args']));
    });
  });
}
