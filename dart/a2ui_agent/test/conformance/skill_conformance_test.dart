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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

import 'suites.dart';

/// Runs the shared `conformance/agent/skill.yaml` suite.
///
/// The suite's catalogs are v1.0, so it runs as written in v1.0 only. Its
/// paths are relative to the repository root.
const Map<String, Set<String>> _knownKeys = {
  'case:from_format': {...caseMetadataKeys, 'args', 'expected_frontmatter'},
  'case:core_syntax': {...caseMetadataKeys, 'args', 'expected_frontmatter'},
  'case:from_catalog': {...caseMetadataKeys, 'args', 'expected_frontmatter'},
  'case:skill_set': {...caseMetadataKeys, 'args', 'expected_skills'},
  'case:export_to_directory': {
    ...caseMetadataKeys,
    'args',
    'expect_error',
    'expected_files',
    'expected_absent_files',
  },
  'case:monolithic_skill_equals_prompt_snippet': {...caseMetadataKeys, 'args'},
  'args:from_format': {'format', 'catalog', 'name'},
  'args:core_syntax': {'format', 'catalog', 'name'},
  'args:from_catalog': {'format', 'catalog'},
  'args:skill_set': {'format', 'catalog'},
  'args:export_to_directory': {'skills', 'pre_existing_files'},
  'args:monolithic_skill_equals_prompt_snippet': {'format', 'catalogs'},
  'skill': {'name', 'description', 'content', 'filename'},
};

final String _repoRoot = Directory(conformanceRoot).parent.path;

void main() {
  const path = 'agent/skill.yaml';
  group('conformance $path ${SuiteVersion.v1_0.label}', () {
    final List<Map<String, Object?>> cases = loadSuite(path);
    test('suite is not empty', () => expect(cases, isNotEmpty));
    for (final testCase in cases) {
      test(testCase['name']! as String, () => _runCase(testCase));
    }
  });
}

void _runCase(Map<String, Object?> testCase) {
  final action = testCase['action']! as String;
  final Set<String>? allowedCaseKeys = _knownKeys['case:$action'];
  if (allowedCaseKeys == null) {
    throw UnsupportedError('Unknown action $action');
  }
  assertKnownKeys(testCase, allowedCaseKeys, 'case:$action');
  final args = testCase['args']! as Map<String, Object?>;
  assertKnownKeys(args, _knownKeys['args:$action']!, 'args:$action');

  if (action == 'export_to_directory') {
    _exportToDirectory(testCase, args);
    return;
  }

  final List<CatalogApi> catalogs = [
    for (final Object? path in [
      ?args['catalog'],
      ...?(args['catalogs'] as List<Object?>?),
    ])
      CatalogConfig.fromPath('$_repoRoot/$path').transformedCatalog,
  ];
  final InferenceFormat format = switch (args['format']) {
    'express' => ExpressFormat(catalogs),
    'direct_json' => DirectJsonFormat(catalogs),
    final Object? name => throw ArgumentError.value(name, 'format'),
  };
  final generator = SkillGenerator(format);
  final name = args['name'] as String?;

  final PromptGenerator prompt = format.promptGenerator;

  /// Checks [skill]'s frontmatter against the case and its body against
  /// [body], a section of the format's own prompt.
  void expectSkill(Skill skill, String body) => expect(
    skill.toMarkdown(),
    '---\n${testCase['expected_frontmatter']}---\n\n${body.trim()}\n',
  );

  switch (action) {
    case 'from_format':
      expectSkill(
        generator.generateSkill(name: name ?? 'a2ui'),
        prompt.generate(),
      );
    case 'core_syntax':
      expectSkill(
        generator.generateCoreSkill(name: name ?? 'a2ui-core'),
        prompt.generateBaseRules(),
      );
    case 'from_catalog':
      final CatalogApi catalog = catalogs.first;
      final String examples = prompt.generateExamples(catalog: catalog);
      expectSkill(
        generator.generateCatalogSkill(catalog: catalog),
        [
          prompt.generateCatalogInstructions(catalog: catalog),
          if (examples.isNotEmpty) '$examplesHeading$examples',
        ].join('\n\n'),
      );
    case 'skill_set':
      final Map<String, String> files = generator.generateSkillSet().toMap();
      expect(files.keys, testCase['expected_skills']);
      expect(files.values, [
        generator.generateCoreSkill().toMarkdown(),
        for (final CatalogApi catalog in catalogs)
          generator.generateCatalogSkill(catalog: catalog).toMarkdown(),
      ]);
    case 'monolithic_skill_equals_prompt_snippet':
      final Skill skill = generator.generateSkill();
      final String snippet = format.promptGenerator.generate();
      expect(skill.content, '$snippet\n');
      // The body follows the line that closes the frontmatter; schema blocks
      // in it also end with `---`.
      const closing = '\n---\n\n';
      final String markdown = skill.toMarkdown();
      expect(
        markdown.substring(markdown.indexOf(closing) + closing.length),
        '${snippet.trim()}\n',
      );
  }
}

/// Writes the case's `pre_existing_files` under a fresh directory, exports a
/// [SkillSet] of its literal `skills` there, and checks which paths exist.
void _exportToDirectory(
  Map<String, Object?> testCase,
  Map<String, Object?> args,
) {
  // The output directory is nested so that a path escaping it, such as
  // `../outside/SKILL.md`, stays inside the temporary directory.
  final Directory temp = Directory.systemTemp.createTempSync('a2ui_skill_');
  addTearDown(() => temp.deleteSync(recursive: true));
  final out = Directory('${temp.path}/out')..createSync();
  for (final Object? relative
      in args['pre_existing_files'] as List<Object?>? ?? const []) {
    File('${out.path}/$relative')
      ..createSync(recursive: true)
      ..writeAsStringSync('pre-existing');
  }

  void export() {
    final skills = SkillSet();
    for (final entry in args['skills']! as List<Object?>) {
      final skill = entry! as Map<String, Object?>;
      assertKnownKeys(skill, _knownKeys['skill']!, 'skill');
      skills.add(
        Skill(
          name: skill['name']! as String,
          description: skill['description']! as String,
          content: skill['content']! as String,
          filename: skill['filename'] as String?,
        ),
      );
    }
    skills.exportToDirectory(out.path);
  }

  if (testCase['expect_error'] case final Object error) {
    expectThrowsCategory(export, error);
  } else {
    export();
  }
  for (final Object? relative
      in testCase['expected_files'] as List<Object?>? ?? const []) {
    expect(
      FileSystemEntity.typeSync('${out.path}/$relative'),
      isNot(FileSystemEntityType.notFound),
      reason: '$relative should exist',
    );
  }
  for (final Object? relative
      in testCase['expected_absent_files'] as List<Object?>? ?? const []) {
    expect(
      FileSystemEntity.typeSync('${out.path}/$relative'),
      FileSystemEntityType.notFound,
      reason: '$relative should not exist',
    );
  }
}
