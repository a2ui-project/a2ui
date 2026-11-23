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

import 'suites.dart';

/// Runs the shared `conformance/agent/skill.yaml` suite.
///
/// The suite's catalogs are v1.0, so it runs as written in v1.0 only. Its
/// paths are relative to the repository root.
const Set<String> _skillCaseKeys = {
  ...caseMetadataKeys,
  'args',
  'expected_frontmatter',
  'expected_filename',
  'expect_contains',
  'expect_absent',
};
const Set<String> _formatArgs = {'format', 'catalog', 'catalogs', 'examples'};
const Map<String, Set<String>> _knownKeys = {
  'case:from_format': _skillCaseKeys,
  'case:core_syntax': _skillCaseKeys,
  'case:from_catalog': _skillCaseKeys,
  'case:skill_set': {
    ...caseMetadataKeys,
    'args',
    'expected_skills',
    'expected_lookups',
  },
  'case:export_to_directory': {
    ...caseMetadataKeys,
    'args',
    'expect_error',
    'expected_files',
    'expected_absent_files',
  },
  'case:monolithic_skill_equals_prompt_snippet': {...caseMetadataKeys, 'args'},
  'args:from_format': {..._formatArgs, 'name', 'description', 'skill_catalogs'},
  'args:core_syntax': {..._formatArgs, 'name', 'description'},
  'args:from_catalog': {
    ..._formatArgs,
    'skill_catalog',
    'name',
    'description',
    'include_examples',
  },
  'args:skill_set': {..._formatArgs, 'skill_catalogs', 'core_name'},
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

  final Map<Object?, CatalogApi> catalogsByPath = {
    for (final Object? path in [
      ?args['catalog'],
      ...?(args['catalogs'] as List<Object?>?),
    ])
      path: CatalogConfig.fromPath('$_repoRoot/$path').transformedCatalog,
  };
  final List<CatalogApi> catalogs = catalogsByPath.values.toList();

  /// The format's catalog loaded from [path].
  CatalogApi catalogAt(Object? path) =>
      catalogsByPath[path] ??
      (throw ArgumentError.value(path, 'path', "is not the format's catalog"));

  final List<List<AgentToRendererMessage>> examples = [
    for (final Object? path in args['examples'] as List<Object?>? ?? const [])
      _loadExample(path! as String),
  ];
  final InferenceFormat format = switch (args['format']) {
    'express' => ExpressFormat(catalogs, examples: examples),
    'direct_json' => DirectJsonFormat(catalogs, examples: examples),
    final Object? name => throw ArgumentError.value(name, 'format'),
  };
  final generator = SkillGenerator(format);
  final PromptGenerator prompt = format.promptGenerator;

  // The generator's arguments, passed only when the case gives them, so that
  // a case without them checks the defaults.
  final name = args['name'] as String?;
  final description = args['description'] as String?;
  final List<CatalogApi>? skillCatalogs = (args['skill_catalogs'] as List?)
      ?.map(catalogAt)
      .toList();

  /// Checks [skill] against the case, and its body against [body], built
  /// from the sections of the format's own prompt.
  void expectSkill(Skill skill, String body) {
    expect(
      skill.toMarkdown(),
      '---\n${testCase['expected_frontmatter']}---\n\n${body.trim()}\n',
    );
    if (testCase['expected_filename'] case final String filename) {
      expect(skill.filename, filename);
    }
    for (final Object? text
        in testCase['expect_contains'] as List<Object?>? ?? const []) {
      expect(skill.content, contains(text));
    }
    for (final Object? text
        in testCase['expect_absent'] as List<Object?>? ?? const []) {
      expect(skill.content, isNot(contains(text)));
    }
  }

  switch (action) {
    case 'from_format':
      final String snippet = prompt.generate();
      final Skill skill = name == null
          ? generator.generateSkill(
              description: description,
              catalogs: skillCatalogs,
            )
          : generator.generateSkill(
              name: name,
              description: description,
              catalogs: skillCatalogs,
            );
      expectSkill(
        skill,
        skillCatalogs == null ? snippet : _catalogsBody(prompt, skillCatalogs),
      );
      expect(prompt.generate(), snippet);
    case 'core_syntax':
      final Skill skill = name == null
          ? generator.generateCoreSkill(description: description)
          : generator.generateCoreSkill(name: name, description: description);
      expectSkill(skill, prompt.generateBaseRules());
    case 'from_catalog':
      final CatalogApi? given = args.containsKey('skill_catalog')
          ? catalogAt(args['skill_catalog'])
          : null;
      final includeExamples = args['include_examples'] as bool?;
      final Skill skill = includeExamples == null
          ? generator.generateCatalogSkill(
              catalog: given,
              name: name,
              description: description,
            )
          : generator.generateCatalogSkill(
              catalog: given,
              name: name,
              description: description,
              includeExamples: includeExamples,
            );
      final CatalogApi catalog = given ?? catalogs.first;
      final String examples = includeExamples ?? true
          ? prompt.generateExamples(catalog: catalog)
          : '';
      expectSkill(
        skill,
        [
          prompt.generateCatalogInstructions(catalog: catalog),
          if (examples.isNotEmpty) '$examplesHeading$examples',
        ].join('\n\n'),
      );
    case 'skill_set':
      final coreName = args['core_name'] as String?;
      final SkillSet skills = coreName == null
          ? generator.generateSkillSet(catalogs: skillCatalogs)
          : generator.generateSkillSet(
              catalogs: skillCatalogs,
              coreName: coreName,
            );
      final Map<String, String> files = skills.toMap();
      expect(files.keys, testCase['expected_skills']);
      final Skill core = coreName == null
          ? generator.generateCoreSkill()
          : generator.generateCoreSkill(name: coreName);
      expect(files.values, [
        core.toMarkdown(),
        for (final CatalogApi catalog in skillCatalogs ?? catalogs)
          generator.generateCatalogSkill(catalog: catalog).toMarkdown(),
      ]);
      final Map<String, Object?> lookups =
          testCase['expected_lookups'] as Map<String, Object?>? ?? const {};
      for (final MapEntry(:String key, :Object? value) in lookups.entries) {
        expect(skills.get(key)?.filename, value, reason: 'get("$key")');
      }
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

/// The body of a monolithic skill for [catalogs] that are not the format's
/// own: the base rules, each catalog's instructions, and each distinct
/// examples text under [examplesHeading].
String _catalogsBody(PromptGenerator prompt, List<CatalogApi> catalogs) {
  final examples = <String>[];
  for (final catalog in catalogs) {
    final String text = prompt.generateExamples(catalog: catalog);
    if (text.isNotEmpty && !examples.contains(text)) examples.add(text);
  }
  return [
    prompt.generateBaseRules(),
    for (final catalog in catalogs)
      prompt.generateCatalogInstructions(catalog: catalog),
    if (examples.isNotEmpty) '$examplesHeading${examples.join('\n\n')}',
  ].where((section) => section.isNotEmpty).join('\n\n');
}

/// The prompt example at [path], relative to the repository root.
List<AgentToRendererMessage> _loadExample(String path) =>
    AgentToRendererMessage.parseAll([
      for (final Object? message in jsonDecode(
        File('$_repoRoot/$path').readAsStringSync(),
      ) as List<Object?>)
        Map<String, Object?>.from(message! as Map),
    ], protocolVersion: A2uiProtocolVersion.v1_0).messages;

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
    final Map<String, String> written = skills.exportToDirectory(out.path);
    expect(written, skills.toMap());
    for (final MapEntry(:String key, :String value) in written.entries) {
      expect(File('${out.path}/$key').readAsStringSync(), value);
    }
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
