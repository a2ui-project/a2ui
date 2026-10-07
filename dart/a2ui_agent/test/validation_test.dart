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
import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

/// How `A2uiRequestProcessor` checks the examples it is given: each example
/// is one render, so a surface may arrive across several of its messages,
/// but must be complete once the whole example is applied.
void main() {
  final CatalogApi basic = Catalog.fromJson(
    jsonDecode(
          File(
            '../../specification/v0_9/catalogs/basic/catalog.json',
          ).readAsStringSync(),
        )
        as Map<String, Object?>,
  );

  CreateSurfaceMessage create() => CreateSurfaceMessage(
    version: 'v0.9',
    surfaceId: 's',
    catalogId: basic.id,
  );

  UpdateComponentsMessage update(List<Map<String, Object?>> components) =>
      UpdateComponentsMessage(
        version: 'v0.9',
        surfaceId: 's',
        components: components,
      );

  Map<String, Object?> column(String id, List<String> children) => {
    'id': id,
    'component': 'Column',
    'children': children,
  };

  Map<String, Object?> text(String id) => {
    'id': id,
    'component': 'Text',
    'text': id,
  };

  void check(List<AgentToRendererMessage> example) =>
      A2uiRequestProcessor(activeCatalogs: [basic], examples: [example]);

  group('A2uiRequestProcessor example validation', () {
    test('accepts a parent whose child arrives in a later message', () {
      expect(
        () => check([
          create(),
          update([
            column('root', ['card']),
          ]),
          update([
            column('card', ['title']),
            text('title'),
          ]),
        ]),
        returnsNormally,
      );
    });

    test('rejects an example that leaves a reference unresolved', () {
      expect(
        () => check([
          create(),
          update([
            column('root', ['missing']),
          ]),
        ]),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('rejects an example that leaves a component unreachable', () {
      expect(
        () => check([
          create(),
          update([text('root'), text('orphan')]),
        ]),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('rejects an example whose surface has no root', () {
      expect(
        () => check([
          create(),
          update([text('title')]),
        ]),
        throwsA(isA<A2uiIntegrityError>()),
      );
    });

    test('rejects a component the catalog does not declare', () {
      expect(
        () => check([
          create(),
          update([
            {'id': 'root', 'component': 'NoSuchType'},
          ]),
        ]),
        throwsA(isA<A2uiValidationError>()),
      );
    });
  });
}
