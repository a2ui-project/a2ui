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

@TestOn('vm')
library;

import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

/// A prompt whose sections name what they were asked for, so a test can see
/// how they were assembled.
class _FakePromptGenerator extends PromptGenerator {
  const _FakePromptGenerator(this.catalogs, {this.examples = 'EXAMPLES'});

  @override
  final List<CatalogApi> catalogs;

  /// The examples for every catalog, as a format that does not keep them per
  /// catalog returns them.
  final String examples;

  @override
  String generateBaseRules() => 'RULES';

  @override
  String generateCatalogInstructions({CatalogApi? catalog}) => catalog == null
      ? 'ALL ${catalogs.map((c) => c.id).join(' ')}'
      : 'CATALOG ${catalog.id}';

  @override
  String generateExamples({CatalogApi? catalog}) => examples;
}

class _FakeFormat extends InferenceFormat {
  const _FakeFormat(this.promptGenerator);

  @override
  final PromptGenerator promptGenerator;

  @override
  Parser createParser() => throw UnimplementedError();
}

CatalogApi _catalog(String id) =>
    Catalog.fromJson({'catalogId': id, 'components': <String, Object?>{}});

void main() {
  final CatalogApi basic = _catalog(
    'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
  );
  final CatalogApi charts = _catalog('catalogs/charts/v1/catalog.json');

  group('assembleInstructions', () {
    test('renders the own catalogs with one call per section', () {
      expect(
        assembleInstructions(_FakePromptGenerator([basic, charts])),
        'RULES\n\nALL ${basic.id} ${charts.id}\n\n'
        '### Examples:\n\nEXAMPLES',
      );
    });

    test('renders other catalogs one at a time and repeats no examples', () {
      expect(
        assembleInstructions(
          _FakePromptGenerator([basic]),
          catalogs: [charts, basic],
        ),
        'RULES\n\nCATALOG ${charts.id}\n\nCATALOG ${basic.id}\n\n'
        '### Examples:\n\nEXAMPLES',
      );
    });

    test('leaves out a section that renders nothing', () {
      expect(
        assembleInstructions(_FakePromptGenerator([basic], examples: '')),
        'RULES\n\nALL ${basic.id}',
      );
    });

    test('is what generate returns', () {
      final generator = _FakePromptGenerator([basic, charts]);
      expect(generator.generate(), assembleInstructions(generator));
    });
  });

  group('Skill', () {
    test('writes the frontmatter and the trimmed content', () {
      expect(
        Skill(
          name: 'a2ui-core',
          description: 'Core rules.',
          content: '\n# Core\n\n',
        ).toMarkdown(),
        '---\nname: a2ui-core\ndescription: Core rules.\n---\n\n# Core\n',
      );
    });

    test('writes metadata as nested YAML', () {
      final skill = Skill(
        name: 'a2ui',
        description: 'All of it.',
        content: 'Body',
        metadata: {
          'internal': true,
          'tags': ['ui', 'a2ui express'],
          'owner': {'team': 'ui', 'size': 3},
        },
      );
      expect(
        skill.toMarkdown(),
        '---\n'
        'name: a2ui\n'
        'description: All of it.\n'
        'metadata:\n'
        '  internal: true\n'
        '  tags:\n'
        '  - ui\n'
        '  - a2ui express\n'
        '  owner:\n'
        '    team: ui\n'
        '    size: 3\n'
        '---\n\nBody\n',
      );
    });

    test('wraps a long description after column 80, as PyYAML does', () {
      final skill = Skill(
        name: 'a2ui-basic',
        description:
            'UI component catalog signatures for basic. Use when building '
            'basic user interface components.',
        content: 'Body',
      );
      expect(
        skill.toMarkdown(),
        startsWith(
          '---\nname: a2ui-basic\n'
          'description: UI component catalog signatures for basic. Use when '
          'building basic user\n'
          '  interface components.\n---\n',
        ),
      );
    });

    test('quotes a value that YAML would read as something else', () {
      for (final (String description, String written) in [
        ('Use when: building', '"Use when: building"'),
        ('true', '"true"'),
        ('42', '"42"'),
        ('- a list item', '"- a list item"'),
        ('Has # a comment', '"Has # a comment"'),
        ('Two\nlines', r'"Two\nlines"'),
      ]) {
        expect(
          Skill(name: 'a', description: description, content: '').toMarkdown(),
          contains('\ndescription: $written\n'),
          reason: description,
        );
      }
    });

    test('defaults the filename to <name>/SKILL.md', () {
      expect(
        Skill(name: 'a2ui', description: '', content: '').filename,
        'a2ui/SKILL.md',
      );
      expect(
        Skill(
          name: 'a2ui',
          description: '',
          content: '',
          filename: 'src/skills/a2ui/SKILL.md',
        ).filename,
        'src/skills/a2ui/SKILL.md',
      );
    });

    test('rejects a filename that would leave the export directory', () {
      for (final filename in [
        '',
        '/abs/SKILL.md',
        r'\abs\SKILL.md',
        r'C:\skills\SKILL.md',
        'C:skills/SKILL.md',
        '../other/SKILL.md',
        r'a\..\..\SKILL.md',
        'a/./SKILL.md',
        'a//SKILL.md',
        'a/',
      ]) {
        expect(
          () => Skill(
            name: 'a',
            description: '',
            content: '',
            filename: filename,
          ),
          throwsA(isA<A2uiValidationError>()),
          reason: filename,
        );
      }
    });
  });

  group('SkillSet', () {
    final core = Skill(name: 'a2ui-core', description: '', content: 'Core');
    final catalog = Skill(
      name: 'basic',
      description: '',
      content: 'Basic',
      filename: 'a2ui-basic/SKILL.md',
    );
    final skills = SkillSet([core, catalog]);

    test('finds a skill by filename, then name, then part of a filename', () {
      expect(skills.get('a2ui-core/SKILL.md'), same(core));
      expect(skills.get('basic'), same(catalog));
      expect(skills.get('a2ui-bas'), same(catalog));
      expect(skills.get('ui'), isNull);
      expect(skills.get('missing'), isNull);
    });

    test('keeps one skill per filename, in the order added', () {
      final replacement = Skill(
        name: 'a2ui-core',
        description: '',
        content: 'New',
      );
      final set = SkillSet([core, catalog])..add(replacement);
      expect(set.skills.keys, ['a2ui-core/SKILL.md', 'a2ui-basic/SKILL.md']);
      expect(set.skills['a2ui-core/SKILL.md'], same(replacement));
      expect(() => set.skills.remove('a2ui-core/SKILL.md'), throwsA(anything));
    });

    test('maps each filename to its Markdown', () {
      expect(skills.toMap(), {
        'a2ui-core/SKILL.md': core.toMarkdown(),
        'a2ui-basic/SKILL.md': catalog.toMarkdown(),
      });
    });
  });

  group('SkillSet.exportToDirectory', () {
    late Directory temp;
    late String out;
    late String elsewhere;

    setUp(() {
      temp = Directory.systemTemp.createTempSync('a2ui_skill_export_');
      out = '${temp.path}/out';
      elsewhere = '${temp.path}/elsewhere';
      Directory(out).createSync();
      File('$elsewhere/keep.txt')
        ..createSync(recursive: true)
        ..writeAsStringSync('keep');
    });
    tearDown(() => temp.deleteSync(recursive: true));

    test('writes each skill and returns its Markdown', () {
      final skill = Skill(name: 'a2ui-core', description: 'd', content: 'c');
      final Map<String, String> written = SkillSet([
        skill,
      ]).exportToDirectory(out);
      expect(written, {'a2ui-core/SKILL.md': skill.toMarkdown()});
      expect(
        File('$out/a2ui-core/SKILL.md').readAsStringSync(),
        skill.toMarkdown(),
      );
    });

    test('writes nothing when a skill directory resolves outside', () {
      Link('$out/src').createSync(elsewhere);
      File('$out/a2ui-core/stale.txt')
        ..createSync(recursive: true)
        ..writeAsStringSync('stale');
      final skills = SkillSet([
        Skill(name: 'a2ui-core', description: '', content: ''),
        Skill(
          name: 'nested',
          description: '',
          content: '',
          filename: 'src/skills/nested/SKILL.md',
        ),
      ]);
      expect(
        () => skills.exportToDirectory(out),
        throwsA(isA<A2uiValidationError>()),
      );
      expect(File('$out/a2ui-core/stale.txt').existsSync(), isTrue);
      expect(File('$out/a2ui-core/SKILL.md').existsSync(), isFalse);
      expect(Directory('$elsewhere/skills').existsSync(), isFalse);
    });

    test('removes a symlink at a skill directory without following it', () {
      Link('$out/a2ui-core').createSync(elsewhere);
      SkillSet([
        Skill(name: 'a2ui-core', description: '', content: ''),
      ]).exportToDirectory(out);
      expect(File('$elsewhere/keep.txt').existsSync(), isTrue);
      expect(
        FileSystemEntity.typeSync('$out/a2ui-core', followLinks: false),
        FileSystemEntityType.directory,
      );
      expect(File('$out/a2ui-core/SKILL.md').existsSync(), isTrue);
    });

    test('replaces a file at a skill directory', () {
      File('$out/a2ui-core').writeAsStringSync('in the way');
      SkillSet([
        Skill(name: 'a2ui-core', description: '', content: ''),
      ]).exportToDirectory(out);
      expect(File('$out/a2ui-core/SKILL.md').existsSync(), isTrue);
    });
  });

  group('SkillGenerator', () {
    SkillGenerator generator(List<CatalogApi> catalogs, {String? examples}) =>
        SkillGenerator(
          _FakeFormat(
            examples == null
                ? _FakePromptGenerator(catalogs)
                : _FakePromptGenerator(catalogs, examples: examples),
          ),
        );

    test('generateSkill holds the prompt snippet of the format', () {
      final Skill skill = generator([basic, charts]).generateSkill();
      expect(skill.name, 'a2ui');
      expect(skill.filename, 'a2ui/SKILL.md');
      expect(
        skill.description,
        'Generates interactive user interface components for user requests.',
      );
      expect(
        skill.content,
        '${_FakePromptGenerator([basic, charts]).generate()}\n',
      );
    });

    test('generateSkill describes the catalogs it is given', () {
      final Skill skill = generator([basic]).generateSkill(
        name: 'charts',
        description: 'Charts.',
        catalogs: [charts],
      );
      expect(skill.filename, 'charts/SKILL.md');
      expect(skill.description, 'Charts.');
      expect(
        skill.content,
        'RULES\n\nCATALOG ${charts.id}\n\n### Examples:\n\nEXAMPLES\n',
      );
    });

    test('generateCoreSkill holds the base rules', () {
      final Skill skill = generator([basic]).generateCoreSkill();
      expect(skill.name, 'a2ui-core');
      expect(
        skill.description,
        'Core A2UI protocol instructions and syntax rules for UI generation.',
      );
      expect(skill.content, 'RULES\n');
    });

    test('generateCatalogSkill defaults to the first catalog', () {
      final Skill skill = generator([basic, charts]).generateCatalogSkill();
      expect(skill.name, 'a2ui-basic');
      expect(skill.filename, 'a2ui-basic/SKILL.md');
      expect(
        skill.description,
        'UI component catalog signatures for basic. Use when building basic '
        'user interface components.',
      );
      expect(
        skill.content,
        'CATALOG ${basic.id}\n\n### Examples:\n\nEXAMPLES\n',
      );
    });

    test('generateCatalogSkill can leave out the examples', () {
      final Skill skill = generator([basic]).generateCatalogSkill(
        catalog: charts,
        name: 'charts',
        description: 'Charts.',
        includeExamples: false,
      );
      expect(skill.name, 'charts');
      expect(skill.description, 'Charts.');
      expect(skill.content, 'CATALOG ${charts.id}\n');
    });

    test('generateCatalogSkill throws without a catalog', () {
      expect(
        () => generator([]).generateCatalogSkill(),
        throwsA(isA<A2uiCatalogError>()),
      );
    });

    test('generateCatalogSkill names the catalog from its id', () {
      for (final (String id, String name) in [
        ('catalogs/basic/v1/catalog.json', 'a2ui-basic'),
        (r'C:\catalogs\Material\catalog.json', 'a2ui-material'),
        ('https://example.com/forms/v2', 'a2ui-forms'),
        ('Simple', 'a2ui-simple'),
        ('catalog.json', 'a2ui-catalog.json'),
      ]) {
        expect(
          generator([_catalog(id)]).generateCatalogSkill().name,
          name,
          reason: id,
        );
      }
    });

    test('generateSkillSet puts shared examples in one catalog skill', () {
      final SkillSet skills = generator([basic, charts]).generateSkillSet();
      expect(skills.skills.keys, [
        'a2ui-core/SKILL.md',
        'a2ui-basic/SKILL.md',
        'a2ui-charts/SKILL.md',
      ]);
      expect(skills.get('a2ui-basic')!.content, contains('EXAMPLES'));
      expect(skills.get('a2ui-charts')!.content, 'CATALOG ${charts.id}\n');
    });

    test('generateSkillSet compiles only the catalogs it is given', () {
      final SkillSet skills = generator([
        basic,
      ], examples: '').generateSkillSet(catalogs: [charts], coreName: 'core');
      expect(skills.skills.keys, ['core/SKILL.md', 'a2ui-charts/SKILL.md']);
    });
  });
}
