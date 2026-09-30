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

import 'package:a2ui_cli/src/analyzer/catalog_analyzer.dart';
import 'package:a2ui_cli/src/analyzer/types.dart';
import 'package:a2ui_cli/src/emitters/python/python_emitter.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart';

String _findRepoRoot() {
  Directory dir = Directory.current;
  while (!File(p.join(dir.path, 'pubspec.yaml')).existsSync() ||
      !Directory(p.join(dir.path, 'specification')).existsSync()) {
    final Directory parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  return dir.path;
}

void main() {
  final String repoRoot = _findRepoRoot();
  final String fixturesDir = p.join(repoRoot, 'dart/a2ui_cli/test/fixtures');

  group('CatalogAnalyzer & PythonEmitter Codegen Tests', () {
    test('data-driven golden file tests match exact byte-for-byte output', () {
      final goldenCases = <String, String>{
        'minimal.json': 'minimal.py',
        'empty_comp.json': 'empty_comp.py',
        'enums.json': 'enums.py',
        'keywords.json': 'keywords.py',
      };

      for (final MapEntry<String, String> entry in goldenCases.entries) {
        final String catalogPath = p.join(fixturesDir, 'catalogs', entry.key);
        final String goldenPath = p.join(
          fixturesDir,
          'goldens/python',
          entry.value,
        );

        final catalogJson =
            jsonDecode(File(catalogPath).readAsStringSync())
                as Map<String, dynamic>;
        final SchemaCatalog catalog = Catalog.fromJson(catalogJson);
        final AnalysedCatalog analysed = CatalogAnalyzer.analyze(catalog);
        final emitter = PythonEmitter(analysed);
        final String generated = emitter.generate().trim();

        final String expected = File(
          goldenPath,
        ).readAsStringSync().replaceAll('\r\n', '\n').trim();

        expect(
          generated,
          equals(expected),
          reason:
              'Generated Python for ${entry.key} did not match golden '
              '${entry.value}',
        );
      }
    });

    test(
      'generates catalog function wrappers with FunctionCall return values',
      () {
        final String catalogPath = p.join(
          fixturesDir,
          'catalogs/functions.json',
        );
        final catalogJson =
            jsonDecode(File(catalogPath).readAsStringSync())
                as Map<String, dynamic>;
        final SchemaCatalog catalog = Catalog.fromJson(catalogJson);
        final AnalysedCatalog analysed = CatalogAnalyzer.analyze(catalog);
        final emitter = PythonEmitter(analysed);
        final String generated = emitter.generate();

        expect(generated, contains('class LinkButton(ComponentBuilderNode):'));
        expect(generated, contains('class OpenUrl(FunctionCall):'));
        expect(
          generated,
          contains(
            'def __init__(self, *, url: str, target: Optional[str] = None, '
            '**kwargs: Any):',
          ),
        );
        expect(
          generated,
          contains('super().__init__(call="openUrl", args=args, **kwargs)'),
        );
        expect(generated, contains('r"""Opens a URL in the browser."""'));
        expect(generated, isNot(contains('call_id')));
        expect(generated, isNot(contains('def open_url(')));
      },
    );

    test('generates complex types with sequence and map properties', () {
      final String catalogPath = p.join(
        fixturesDir,
        'catalogs/nested_types.json',
      );
      final catalogJson =
          jsonDecode(File(catalogPath).readAsStringSync())
              as Map<String, dynamic>;
      final SchemaCatalog catalog = Catalog.fromJson(catalogJson);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyze(catalog);
      final emitter = PythonEmitter(analysed);
      final String generated = emitter.generate();

      expect(generated, contains('class ComplexCard(ComponentBuilderNode):'));
      expect(generated, contains('tags: Sequence[str]'));
      expect(
        generated,
        contains('metadata: Optional[Mapping[str, Any]] = None'),
      );
      expect(
        generated,
        contains('payload: Optional[Mapping[str, Any]] = None'),
      );
      expect(generated, isNot(contains('_serialize_prop')));
      expect(generated, isNot(contains('def to_dict(')));
    });

    test('supports custom base import and catalog name overrides', () {
      final String catalogPath = p.join(fixturesDir, 'catalogs/enums.json');
      final catalogJson =
          jsonDecode(File(catalogPath).readAsStringSync())
              as Map<String, dynamic>;
      final SchemaCatalog catalog = Catalog.fromJson(catalogJson);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyze(catalog);
      final emitter = PythonEmitter(
        analysed,
        baseImport: 'my_org.a2ui_custom_base',
        catalogName: 'custom_badge_catalog',
      );
      final String generated = emitter.generate();

      expect(generated, contains('from my_org.a2ui_custom_base import ('));
      expect(
        generated,
        contains('"""Type-safe A2UI builders for custom_badge_catalog'),
      );
    });

    test(
      'generates code from the authoritative official basic catalog schema',
      () {
        final String catalogPath = p.join(
          repoRoot,
          'specification/v0_9_1/catalogs/basic/catalog.json',
        );
        final catalogJson =
            jsonDecode(File(catalogPath).readAsStringSync())
                as Map<String, dynamic>;
        final SchemaCatalog catalog = Catalog.fromJson(catalogJson);
        final AnalysedCatalog analysed = CatalogAnalyzer.analyze(catalog);
        final emitter = PythonEmitter(analysed);
        final String generated = emitter.generate();

        expect(
          generated,
          contains('"""Type-safe A2UI builders for basic (version v0.9.1).'),
        );
        expect(generated, contains('class Button(ComponentBuilderNode):'));
        expect(generated, contains('class Card(ComponentBuilderNode):'));
        expect(generated, contains('class Column(ComponentBuilderNode):'));
        expect(generated, contains('class Row(ComponentBuilderNode):'));
        expect(generated, contains('class Text(ComponentBuilderNode):'));
        expect(generated, contains('class Modal(ComponentBuilderNode):'));
        expect(
          generated,
          contains('class ChoicePicker(ComponentBuilderNode):'),
        );
        expect(generated, contains('TextVariant = Annotated['));
        expect(
          generated,
          contains(
            'Literal["h1", "h2", "h3", "h4", "h5", "caption", "body"], '
            'OPEN_ENUM',
          ),
        );
        expect(generated, contains('child: Child'));
        expect(generated, contains('children: ChildList'));
        expect(
          generated,
          contains('checks: Optional[Sequence[CheckRule]] = None'),
        );
        expect(
          generated,
          contains('accessibility: Optional[AccessibilityAttributes] = None'),
        );
        expect(generated, contains('class TabItem(BuilderBaseModel):'));
        expect(
          generated,
          contains('class ChoicePickerOption(BuilderBaseModel):'),
        );
        expect(generated, contains('tabs: Sequence[TabItem]'));
        expect(generated, contains('options: Sequence[ChoicePickerOption]'));
        expect(
          generated,
          contains(
            'name: IconName | IconNameSvgPath | DataBinding | FunctionCall',
          ),
        );
        expect(generated, contains('serialization_alias="validationRegexp"'));
        expect(generated, contains('class OpenUrl(FunctionCall):'));
        expect(generated, isNot(contains('def to_dict(')));
        expect(generated, isNot(contains('_serialize_prop')));
        expect(generated, isNot(contains('call_id')));
        expect(generated, isNot(contains('Slot')));
        expect(generated, isNot(contains('def open_url(')));
      },
    );
  });
}
