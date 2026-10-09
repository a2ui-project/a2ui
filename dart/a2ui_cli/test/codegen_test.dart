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

import 'package:a2ui_cli/a2ui_cli.dart';
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
        final catalog = CodegenCatalog.fromJson(catalogJson);
        final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(
          catalog,
        );
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
        final catalog = CodegenCatalog.fromJson(catalogJson);
        final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(
          catalog,
        );
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
      final catalog = CodegenCatalog.fromJson(catalogJson);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(catalog);
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
      final catalog = CodegenCatalog.fromJson(catalogJson);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(catalog);
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
        final catalog = CodegenCatalog.fromJson(catalogJson);
        final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(
          catalog,
        );
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
        expect(generated, contains('alias="validationRegexp"'));
        expect(generated, contains('class OpenUrl(FunctionCall):'));
        expect(generated, isNot(contains('def to_dict(')));
        expect(generated, isNot(contains('_serialize_prop')));
        expect(generated, isNot(contains('call_id')));
        expect(generated, isNot(contains('Slot')));
        expect(generated, isNot(contains('def open_url(')));

        final String checkedInPath = p.join(
          repoRoot,
          'python/a2ui_agent/src/a2ui/builder/v0_9/catalogs/basic.py',
        );
        expect(
          generated,
          equals(File(checkedInPath).readAsStringSync()),
          reason:
              'Generated basic catalog output must match checked-in Python '
              'agent SDK file byte-for-byte. Regenerate with:\n'
              'dart run dart/a2ui_cli/bin/a2ui.dart codegen '
              '--catalog specification/v0_9_1/catalogs/basic/catalog.json '
              '--out python/a2ui_agent/src/a2ui/builder/v0_9/catalogs/basic.py',
        );
      },
    );

    test('snake_cases function parameters in Python function classes', () {
      final json = <String, Object?>{
        'catalogId': 'param_catalog',
        'protocolVersion': 'v0.9.1',
        'functions': {
          'paginate': {
            'description': 'Paginates items.',
            'properties': {
              'call': {'const': 'paginate'},
              'args': {
                'type': 'object',
                'properties': {
                  'pageSize': {'type': 'integer'},
                  'maxResults': {'type': 'integer'},
                },
                'required': ['pageSize'],
              },
            },
          },
        },
      };
      final catalog = CodegenCatalog.fromJson(json);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(catalog);
      final emitter = PythonEmitter(analysed);
      final String code = emitter.generate();
      expect(code, contains('page_size: float'));
      expect(code, contains('max_results: Optional[float] = None'));
      expect(code, contains('"pageSize": page_size'));
      expect(code, contains('args["maxResults"] = max_results'));
    });

    test('sanitizes hyphenated properties and reserved Pydantic names', () {
      final json = <String, dynamic>{
        'catalogId': 'https://a2ui.org/catalogs/test/sanitize',
        'components': {
          'Widget': {
            'type': 'object',
            'properties': {
              'aria-label': {'type': 'string'},
              'content-type': {'type': 'string'},
              'schema': {'type': 'string'},
              'model_config': {'type': 'string'},
              'dict': {'type': 'string'},
            },
          },
        },
      };
      final catalog = CodegenCatalog.fromJson(json);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(catalog);
      final emitter = PythonEmitter(analysed);
      final String code = emitter.generate();

      expect(code, contains('aria_label: Optional[str]'));
      expect(code, contains('alias="aria-label"'));
      expect(code, contains('content_type: Optional[str]'));
      expect(code, contains('alias="content-type"'));
      expect(code, contains('schema_: Optional[str]'));
      expect(code, contains('alias="schema"'));
      expect(code, contains('model_config_: Optional[str]'));
      expect(code, contains('alias="model_config"'));
      expect(code, contains('dict_: Optional[str]'));
      expect(code, contains('alias="dict"'));
    });

    test('disambiguates snake_case collision overwrites', () {
      final json = <String, dynamic>{
        'catalogId': 'https://a2ui.org/catalogs/test/collision',
        'components': {
          'Widget': {
            'type': 'object',
            'properties': {
              'foo_bar': {'type': 'string'},
              'fooBar': {'type': 'string'},
            },
          },
        },
      };
      final catalog = CodegenCatalog.fromJson(json);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(catalog);
      final emitter = PythonEmitter(analysed);
      final String code = emitter.generate();

      expect(code, contains('foo_bar: Optional[str]'));
      expect(code, contains('foo_bar_2: Optional[str]'));
      expect(code, contains('alias="fooBar"'));
    });

    test('sanitizes self and kwargs in function parameter signatures', () {
      final json = <String, dynamic>{
        'catalogId': 'https://a2ui.org/catalogs/test/fn_reserved',
        'functions': {
          'customFunc': {
            'type': 'object',
            'properties': {
              'call': {'const': 'customFunc'},
              'args': {
                'type': 'object',
                'properties': {
                  'self': {'type': 'string'},
                  'kwargs': {'type': 'string'},
                },
                'required': ['self'],
              },
            },
          },
        },
      };
      final catalog = CodegenCatalog.fromJson(json);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(catalog);
      final emitter = PythonEmitter(analysed);
      final String code = emitter.generate();

      expect(code, contains('self_: str'));
      expect(code, contains('kwargs_: Optional[str] = None'));
      expect(code, contains('"self": self_'));
      expect(code, contains('args["kwargs"] = kwargs_'));
    });

    test('disambiguates function parameter collisions and reserves args', () {
      final json = <String, dynamic>{
        'catalogId': 'https://a2ui.org/catalogs/test/fn_collision',
        'functions': {
          'queryData': {
            'type': 'object',
            'properties': {
              'call': {'const': 'queryData'},
              'args': {
                'type': 'object',
                'properties': {
                  'pageSize': {'type': 'number'},
                  'page_size': {'type': 'number'},
                  'args': {'type': 'string'},
                },
                'required': ['pageSize'],
              },
            },
          },
        },
      };
      final catalog = CodegenCatalog.fromJson(json);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(catalog);
      final emitter = PythonEmitter(analysed);
      final String code = emitter.generate();

      expect(code, contains('page_size: float'));
      expect(code, contains('page_size_2: Optional[float] = None'));
      expect(code, contains('args_: Optional[str] = None'));
      expect(code, contains('"pageSize": page_size'));
      expect(code, contains('args["page_size"] = page_size_2'));
      expect(code, contains('args["args"] = args_'));
    });

    test('supports non-empty list and mapping literals in schema defaults', () {
      final json = <String, dynamic>{
        'catalogId': 'https://a2ui.org/catalogs/test/defaults',
        'components': {
          'Box': {
            'type': 'object',
            'properties': {
              'sizes': {
                'type': 'array',
                'items': {'type': 'string'},
                'default': ['s', 'm', 'l'],
              },
              'config': {
                'type': 'object',
                'default': {'theme': 'dark', 'count': 42},
              },
            },
          },
        },
      };
      final catalog = CodegenCatalog.fromJson(json);
      final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(catalog);
      final emitter = PythonEmitter(analysed);
      final String code = emitter.generate();

      expect(
        code,
        contains('sizes: Optional[Sequence[str]] = ["s", "m", "l"]'),
      );
      expect(
        code,
        contains(
          'config: Optional[Mapping[str, Any]] = {"theme": "dark", "count": 42}',
        ),
      );
    });
  });
}
