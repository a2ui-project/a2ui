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

void main() {
  group('MessageErrorMapper', () {
    test('maps catalog errors to CATALOG_NOT_FOUND', () {
      final catalogErr = A2uiCatalogError(
        'Catalog not registered',
        catalogId: 'https://example.com/cat.json',
        surfaceId: 'surf-cat',
      );
      final ErrorMessage mapped =
          MessageErrorMapper.map(catalogErr, defaultVersion: '1.0');

      expect(mapped.version, '1.0');
      expect(mapped.error.code, 'CATALOG_NOT_FOUND');
      expect(mapped.error.surfaceId, 'surf-cat');
      expect(mapped.error.functionCallId, isNull);
      expect(mapped.error.path, isNull);
      expect(mapped.error.message, 'Catalog not registered');

      final resolutionErr = A2uiCatalogResolutionError(
        'Function catalog missing',
        catalogId: 'https://example.com/missing.json',
        functionName: 'formatCurrency',
        surfaceId: 'surf-res',
      );
      final ErrorMessage mappedResolution = MessageErrorMapper.map(
        resolutionErr,
        defaultVersion: '1.0',
      );
      expect(mappedResolution.error.code, 'CATALOG_NOT_FOUND');
      expect(mappedResolution.error.surfaceId, 'surf-res');
      expect(mappedResolution.error.functionCallId, isNull);
      expect(mappedResolution.error.path, isNull);
    });

    test('maps recursion and cycle errors to RECURSION_LIMIT_EXCEEDED', () {
      final recursionErr = A2uiRecursionError(
        'Depth exceeded',
        cycle: const ['a', 'b', 'a'],
        path: '/components/0',
        surfaceId: 'surf-rec',
      );
      final ErrorMessage mappedRecursion = MessageErrorMapper.map(
        recursionErr,
        defaultVersion: '1.0',
      );
      expect(mappedRecursion.error.code, 'RECURSION_LIMIT_EXCEEDED');
      expect(mappedRecursion.error.surfaceId, 'surf-rec');
      expect(mappedRecursion.error.functionCallId, isNull);
      expect(mappedRecursion.error.path, isNull);

      final circularIntegrity = A2uiIntegrityError(
        'Circular reference detected in component graph',
        surfaceId: 'surf-circ',
      );
      final ErrorMessage mappedCircular = MessageErrorMapper.map(
        circularIntegrity,
        defaultVersion: '1.0',
      );
      expect(mappedCircular.error.code, 'RECURSION_LIMIT_EXCEEDED');
      expect(mappedCircular.error.surfaceId, 'surf-circ');
      expect(mappedCircular.error.functionCallId, isNull);
      expect(mappedCircular.error.path, isNull);

      final selfRefIntegrity = A2uiIntegrityError(
        'Self-reference on component c1',
        surfaceId: 'surf-self',
      );
      final ErrorMessage mappedSelfRef = MessageErrorMapper.map(
        selfRefIntegrity,
        defaultVersion: '1.0',
      );
      expect(mappedSelfRef.error.code, 'RECURSION_LIMIT_EXCEEDED');
    });

    test('maps non-circular A2uiIntegrityError to INTEGRITY_ERROR', () {
      final integrityErr = A2uiIntegrityError(
        'Orphan component c2',
        componentIds: const ['c2'],
        surfaceId: 'surf-int',
      );
      final ErrorMessage mapped = MessageErrorMapper.map(
        integrityErr,
        defaultVersion: '1.0',
      );

      expect(mapped.error.code, 'INTEGRITY_ERROR');
      expect(mapped.error.surfaceId, 'surf-int');
      expect(mapped.error.functionCallId, isNull);
      expect(mapped.error.path, isNull);
      expect(mapped.error.message, 'Orphan component c2');
    });

    test('maps state and expression errors to their wire codes', () {
      final stateErr = A2uiStateError(
        'Surface does not exist',
        surfaceId: 'surf-state',
      );
      final ErrorMessage mappedState = MessageErrorMapper.map(
        stateErr,
        defaultVersion: '1.0',
      );
      // Pins current Dart MessageErrorMapper behavior (STATE_ERROR) rather
      // than a cross-SDK wire error code.
      expect(mappedState.error.code, 'STATE_ERROR');
      expect(mappedState.error.surfaceId, 'surf-state');
      expect(mappedState.error.functionCallId, isNull);
      expect(mappedState.error.path, isNull);

      final exprErr = A2uiExpressionError(
        'Evaluation failed',
        expression: '@index',
        surfaceId: 'surf-expr',
      );
      final ErrorMessage mappedExpr =
          MessageErrorMapper.map(exprErr, defaultVersion: '1.0');
      // Pins current Dart MessageErrorMapper behavior (EXECUTION_ERROR) rather
      // than a cross-SDK wire error code.
      expect(mappedExpr.error.code, 'EXECUTION_ERROR');
      expect(mappedExpr.error.surfaceId, 'surf-expr');
      expect(mappedExpr.error.functionCallId, isNull);
      expect(mappedExpr.error.path, isNull);
    });

    test('maps A2uiDataError and A2uiParseError to their wire codes', () {
      final dataErr = A2uiDataError(
        'Invalid pointer segment',
        path: '/items/bad',
        surfaceId: 'surf-data',
      );
      final ErrorMessage mappedData =
          MessageErrorMapper.map(dataErr, defaultVersion: '1.0');
      expect(mappedData.error.code, 'DATA_ERROR');
      expect(mappedData.error.surfaceId, 'surf-data');
      expect(mappedData.error.functionCallId, isNull);
      // Pins current Dart MessageErrorMapper behavior (omitting path on
      // A2uiDataError) rather than a cross-SDK wire error contract.
      expect(mappedData.error.path, isNull);

      final parseErr = A2uiParseError(
        'Malformed token stream',
        rawContent: '{bad',
        surfaceId: 'surf-parse',
      );
      final ErrorMessage mappedParse = MessageErrorMapper.map(
        parseErr,
        defaultVersion: '1.0',
      );
      expect(mappedParse.error.code, 'PARSE_ERROR');
      expect(mappedParse.error.surfaceId, 'surf-parse');
      expect(mappedParse.error.functionCallId, isNull);
      expect(mappedParse.error.path, isNull);
    });

    test('maps validation errors with and without path across versions', () {
      final withPath = A2uiValidationError(
        'Missing required text field',
        path: '/components/0/text',
        surfaceId: 'surf-val',
      );
      final ErrorMessage mappedWithPath = MessageErrorMapper.map(
        withPath,
        defaultVersion: '1.0',
      );
      expect(mappedWithPath.error.code, 'VALIDATION_FAILED');
      expect(mappedWithPath.error.path, '/components/0/text');
      expect(mappedWithPath.error.surfaceId, 'surf-val');
      expect(mappedWithPath.error.functionCallId, isNull);

      final withoutPath = A2uiValidationError(
        'Envelope missing action key',
        surfaceId: 'surf-schema',
      );
      final ErrorMessage mappedWithoutPath = MessageErrorMapper.map(
        withoutPath,
        defaultVersion: '1.0',
      );
      // Pins current Dart MessageErrorMapper behavior
      // (SCHEMA_VALIDATION_FAILED) rather than a cross-SDK wire error code.
      expect(mappedWithoutPath.error.code, 'SCHEMA_VALIDATION_FAILED');
      expect(mappedWithoutPath.error.path, isNull);
      expect(mappedWithoutPath.error.surfaceId, 'surf-schema');

      final unallowedParent = A2uiValidationError(
        'Card not allowed under Row',
        code: A2uiRendererError.unallowedParentCode,
        path: '/components/1',
        surfaceId: 'surf-comp',
      );
      final ErrorMessage mappedV10 = MessageErrorMapper.map(
        unallowedParent,
        defaultVersion: '1.0',
      );
      expect(mappedV10.version, '1.0');
      expect(mappedV10.error.code, 'UNALLOWED_PARENT');
      expect(mappedV10.error.path, '/components/1');

      final ErrorMessage mappedV09 = MessageErrorMapper.map(
        unallowedParent,
        defaultVersion: 'v0.9',
      );
      expect(mappedV09.version, 'v0.9');
      expect(mappedV09.error.code, 'VALIDATION_FAILED');
      expect(mappedV09.error.path, '/components/1');
    });

    test('sets either surfaceId or functionCallId, never both', () {
      final rpcErr = A2uiRpcError(
        'Function threw an error',
        RpcErrorCode.executionError,
        functionCallId: 'fn-call-42',
        surfaceId: 'surf-ignored-when-fn-id-present',
      );
      final ErrorMessage mappedRpc = MessageErrorMapper.map(
        rpcErr,
        rawMessage: {
          'version': '1.0',
          'callRendererFunction': {
            'functionCallId': 'fn-call-42',
            'surfaceId': 'surf-ignored-when-fn-id-present',
          },
        },
      );
      expect(mappedRpc.version, '1.0');
      expect(mappedRpc.error.code, 'EXECUTION_ERROR');
      expect(mappedRpc.error.functionCallId, 'fn-call-42');
      expect(mappedRpc.error.surfaceId, isNull);

      // A non-RPC error during callRendererFunction maps to
      // INVALID_FUNCTION_CALL with functionCallId.
      final valDuringCall = A2uiValidationError('Bad call arguments');
      final ErrorMessage mappedCallVal = MessageErrorMapper.map(
        valDuringCall,
        rawMessage: {
          'version': 'v1.0',
          'callRendererFunction': {
            'functionCallId': 'fn-call-99',
            'surfaceId': 'surf-1',
          },
        },
      );
      expect(mappedCallVal.version, '1.0');
      expect(mappedCallVal.error.code, 'INVALID_FUNCTION_CALL');
      expect(mappedCallVal.error.functionCallId, 'fn-call-99');
      expect(mappedCallVal.error.surfaceId, isNull);

      // A surface message takes surfaceId from the raw envelope body and
      // leaves functionCallId null.
      final surfaceErr = A2uiStateError('Missing surface');
      final ErrorMessage mappedSurface = MessageErrorMapper.map(
        surfaceErr,
        rawMessage: {
          'version': 'v0.9.1',
          'updateComponents': {'surfaceId': 'extracted-surf'},
        },
      );
      expect(mappedSurface.version, 'v0.9.1');
      // Pins current Dart MessageErrorMapper behavior (STATE_ERROR) rather
      // than a cross-SDK wire error code.
      expect(mappedSurface.error.code, 'STATE_ERROR');
      expect(mappedSurface.error.surfaceId, 'extracted-surf');
      expect(mappedSurface.error.functionCallId, isNull);
    });
  });
}
