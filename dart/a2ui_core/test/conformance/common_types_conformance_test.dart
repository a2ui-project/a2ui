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

import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:json_schema_builder/json_schema_builder.dart';
import 'package:test/test.dart';

import 'conformance_harness.dart';

/// Runs the shared `conformance/core/common_types.yaml` suite against
/// [PayloadValidator.commonTypesFor] and `a2ui_core`'s UAX #31 identifier
/// rules.
void main() {
  final List<ConformanceTestCase> cases = loadConformanceSuite(
    'core/common_types.yaml',
  );

  group('conformance core/common_types.yaml', () {
    test('suite has cases', () => expect(cases, isNotEmpty));

    runConformanceSuite(
      cases,
      _runCase,
      suite: 'core/common_types.yaml',
      expectedFailures: _expectedFailures,
      unsupported: _unsupported,
      skipReason: (testCase) => testCase['action'] == 'common_types_schema'
          ? 'no schema generation from models'
          : null,
    );
  });
}

const Map<String, String> _expectedFailures = {};
const Map<String, String> _unsupported = {};

const Set<String> _validateCommonTypeCaseKeys = {
  ...caseMetadataKeys,
  'definition',
  'protocolVersion',
  'steps',
};

const Set<String> _validateCommonTypeStepKeys = {
  'expectError',
  'value',
};

const Map<String, Object?> _v0_9CatalogStub = {
  r'$defs': {
    'anyFunction': {
      'type': 'object',
      'properties': {
        'call': {'type': 'string'},
        'args': {'type': 'object'},
        'returnType': {'type': 'string'},
      },
      'required': ['call'],
      'additionalProperties': false,
    },
    'anyComponent': {'type': 'object'},
  },
};

const Map<String, Object?> _v1_0CatalogStub = {
  r'$defs': {
    'anyFunction': {
      'type': 'object',
      'not': {
        'properties': {
          '@call': {'const': '@index'},
        },
        'required': ['@call'],
      },
      'properties': {
        '@call': {'type': 'string'},
        'catalogId': {'type': 'string'},
        'args': {
          'type': 'object',
          'additionalProperties': {
            r'$ref': r'common_types.json#/$defs/DynamicValue',
          },
        },
      },
      'required': ['@call'],
    },
    'anyComponent': {'type': 'object'},
  },
};

void _runCase(ConformanceTestCase testCase) {
  final action = testCase['action'] as String?;
  if (action != 'validate_common_type') {
    throw StateError('Unsupported common_types conformance action: $action');
  }
  assertKnownKeys(
    testCase,
    _validateCommonTypeCaseKeys,
    'case:validate_common_type',
  );

  final name = testCase['name']! as String;
  final definition = testCase['definition']! as String;
  final A2uiProtocolVersion version = A2uiProtocolVersion.fromJson(
    testCase['protocolVersion'] ?? 'v0.9',
  );
  final bool isV1 = version.isAtLeast(A2uiProtocolVersion.v1_0);
  final Map<String, Object?> commonTypes = PayloadValidator.commonTypesFor(
    version,
  );
  if (isV1) {
    final Map<String, Object?>? defs =
        (commonTypes[r'$defs'] as Map?)?.cast<String, Object?>();
    if (defs != null && defs.containsKey('Extensions')) {
      defs['Extensions'] = <String, Object?>{'type': 'object'};
    }
  }

  final Map<String, Object?> resolved = resolveSchemaRefs(
    <String, Object?>{r'$ref': 'common_types.json#/\$defs/$definition'},
    isV1 ? _v1_0CatalogStub : _v0_9CatalogStub,
    commonTypes: commonTypes,
  );
  final schema = Schema.fromMap(resolved);
  final steps = testCase['steps']! as List<Object?>;

  for (var i = 0; i < steps.length; i++) {
    final Map<String, Object?> step =
        (steps[i]! as Map).cast<String, Object?>();
    assertKnownKeys(
      step,
      _validateCommonTypeStepKeys,
      'step:validate_common_type[$i]',
    );
    final Object? value = step['value'];
    final Map<String, Object?>? expectError =
        (step['expectError'] as Map?)?.cast<String, Object?>();
    if (expectError != null) {
      assertKnownKeys(
        expectError,
        knownExpectErrorKeys,
        'step:validate_common_type[$i].expectError',
      );
    }

    final bool valid = _isValidCommonType(
      schema: schema,
      definition: definition,
      isV1: isV1,
      value: value,
    );
    if (expectError != null) {
      expect(
        valid,
        isFalse,
        reason: '$name step $i: expected $definition to reject '
            '${jsonEncode(value)}',
      );
    } else {
      expect(
        valid,
        isTrue,
        reason: '$name step $i: expected $definition to accept '
            '${jsonEncode(value)}',
      );
    }
  }
}

bool _isValidCommonType({
  required Schema schema,
  required String definition,
  required bool isV1,
  required Object? value,
}) {
  final List<ValidationError> errors = schema.validateSync(
    value,
    strictFormat: true,
  );
  if (errors.isNotEmpty) return false;
  if (!isV1) return true;

  if (definition == 'Extensions' && value is Map) {
    return value.keys.every(
      (Object? key) => key is String && isValidUax31Identifier(key),
    );
  }
  if (definition == 'ComponentCommon' &&
      value is Map &&
      value['metadata'] is Map) {
    final Object? extensions = (value['metadata']! as Map)['extensions'];
    if (extensions is Map) {
      return extensions.keys.every(
        (Object? key) => key is String && isValidUax31Identifier(key),
      );
    }
  }
  return true;
}
