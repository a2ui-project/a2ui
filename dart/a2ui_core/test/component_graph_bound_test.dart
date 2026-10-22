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

import 'dart:collection';
import 'dart:math';

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_core/src/validation/component_refs.dart';
import 'package:test/test.dart';

import 'support/test_catalog.dart';

/// How `SurfaceComponentsModel.checkComponentsUpdate` checks a batch after
/// the one before it was applied, walking only the part of the graph the
/// batch reaches, against the walk of the whole graph it otherwise takes.
void main() {
  const relaxed = ValidationConfig(
    allowOrphanComponents: true,
    allowDanglingReferences: true,
    allowMissingRoot: true,
    maxDepth: 4,
  );

  /// Applies [batch] to [model] as `MessageProcessor` does, and reports it
  /// applied when [report] is true.
  void apply(
    SurfaceComponentsModel model,
    List<Map<String, Object?>> batch, {
    bool report = true,
  }) {
    for (final entry in batch) {
      final id = entry['id']! as String;
      final type = entry['component']! as String;
      final Map<String, Object?> properties = {
        for (final MapEntry<String, Object?> e in entry.entries)
          if (e.key != 'id' && e.key != 'component') e.key: e.value,
      };
      final ComponentModel? existing = model.get(id);
      if (existing != null && existing.type == type) {
        existing.properties = properties;
        continue;
      }
      if (existing != null) model.removeComponent(id);
      model.addComponent(ComponentModel(id, type, properties));
    }
    if (report) model.componentsUpdateApplied(batch);
  }

  /// The error [check] throws, as its type and message, or null.
  String? outcome(void Function() check) {
    try {
      check();
      return null;
    } on A2uiError catch (e) {
      return '${e.runtimeType}: ${e.message}';
    }
  }

  Map<String, Object?> column(String id, List<String> children) => {
        'id': id,
        'component': 'Column',
        'children': children,
      };

  for (final config in [
    relaxed,
    const ValidationConfig(
      allowOrphanComponents: true,
      allowDanglingReferences: true,
      maxDepth: 4,
    ),
  ]) {
    test(
        'reaches the verdict the whole graph does, '
        'allowMissingRoot: ${config.allowMissingRoot}', () {
      final List<String> ids = ['root', for (var i = 0; i < 9; i++) 'c$i'];
      for (var seed = 0; seed < 300; seed++) {
        final random = Random(seed);
        // Only the first model is told each batch was applied, so only it
        // starts from what the check before found.
        final bounded = SurfaceComponentsModel(catalog: TestCatalog());
        final whole = SurfaceComponentsModel(catalog: TestCatalog());
        for (var step = 0; step < 30; step++) {
          final List<Map<String, Object?>> batch = [
            for (final String id
                in (ids.toList()..shuffle(random)).take(1 + random.nextInt(3)))
              random.nextInt(3) == 0
                  ? {'id': id, 'component': 'Text', 'text': 'x'}
                  : column(id, [
                      for (var k = random.nextInt(3); k > 0; k--)
                        ids[random.nextInt(ids.length)],
                    ]),
          ];
          final String? expected = outcome(
            () => whole.checkComponentsUpdate(batch, config, whole.refFields),
          );
          expect(
            outcome(
              () => bounded.checkComponentsUpdate(
                batch,
                config,
                bounded.refFields,
              ),
            ),
            expected,
            reason: 'seed $seed, step $step, batch $batch',
          );
          if (expected == null) {
            apply(whole, batch, report: false);
            apply(bounded, batch);
          }
        }
        bounded.dispose();
        whole.dispose();
      }
    });
  }

  test(
      'reads only the references of the batch once the one before it is '
      'applied', () {
    final model = SurfaceComponentsModel(catalog: TestCatalog());
    final reads = _CountingMap(model.refFields);
    final List<Map<String, Object?>> first = [
      column('root', [for (var i = 0; i < 200; i++) 'c$i']),
      for (var i = 0; i < 199; i++) {'id': 'c$i', 'component': 'Text'},
    ];
    model.checkComponentsUpdate(first, relaxed, reads);
    apply(model, first);
    reads.count = 0;
    model.checkComponentsUpdate(
      [
        {'id': 'c199', 'component': 'Text'},
      ],
      relaxed,
      reads,
    );
    expect(reads.count, lessThan(10));
  });

  test(
      'walks the whole graph again after a component changes outside a '
      'check', () {
    final model = SurfaceComponentsModel(catalog: TestCatalog());
    final List<Map<String, Object?>> first = [
      column('root', ['a']),
      column('a', []),
    ];
    model.checkComponentsUpdate(first, relaxed, model.refFields);
    apply(model, first);
    model.get('a')!.properties = {
      'children': ['root'],
    };
    expect(
      () => model.checkComponentsUpdate(
        [
          {'id': 'b', 'component': 'Text'},
        ],
        relaxed,
        model.refFields,
      ),
      throwsA(isA<A2uiIntegrityError>()),
    );
  });

  test(
      'walks the whole graph again after a check whose batch was not '
      'applied', () {
    final model = SurfaceComponentsModel(catalog: TestCatalog());
    final List<Map<String, Object?>> first = [
      column('root', ['a']),
    ];
    model.checkComponentsUpdate(first, relaxed, model.refFields);
    apply(model, first);
    // Checked, then applied without being reported, as an update another
    // check approved might be.
    final List<Map<String, Object?>> unreported = [
      column('a', ['root']),
    ];
    expect(
      () => model.checkComponentsUpdate(unreported, relaxed, model.refFields),
      throwsA(isA<A2uiIntegrityError>()),
    );
    apply(model, unreported, report: false);
    expect(
      () => model.checkComponentsUpdate(
        [
          {'id': 'b', 'component': 'Text'},
        ],
        relaxed,
        model.refFields,
      ),
      throwsA(isA<A2uiIntegrityError>()),
    );
  });
}

/// A map that counts its lookups.
class _CountingMap extends MapView<String, ComponentRefFields> {
  _CountingMap(super.map);

  int count = 0;

  @override
  ComponentRefFields? operator [](Object? key) {
    count++;
    return super[key];
  }
}
