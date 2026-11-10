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

String getPythonExecutable(String repoRoot) {
  final candidates = <String>[
    p.join(repoRoot, '.venv/bin/python'),
    p.join(repoRoot, 'python/a2ui_agent/.venv/bin/python'),
    p.join(repoRoot, 'python/a2ui_core/.venv/bin/python'),
  ];
  for (final candidate in candidates) {
    if (File(candidate).existsSync()) {
      return candidate;
    }
  }
  final String? virtualEnv = Platform.environment['VIRTUAL_ENV'];
  if (virtualEnv != null) {
    final String venvPython = p.join(virtualEnv, 'bin/python');
    if (File(venvPython).existsSync()) {
      return venvPython;
    }
  }
  return 'python3';
}

bool _hasPydantic(String pythonBin, Map<String, String> env) {
  try {
    final ProcessResult res = Process.runSync(pythonBin, [
      '-c',
      'import pydantic',
    ], environment: env);
    return res.exitCode == 0;
  } on Object {
    return false;
  }
}

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
  final String basicCatalogPath = p.join(
    repoRoot,
    'specification/v0_9_1/catalogs/basic/catalog.json',
  );

  final String pythonBin = getPythonExecutable(repoRoot);
  final String pythonSdkPath = p.join(repoRoot, 'python/a2ui_agent/src');
  final String pythonCorePath = p.join(repoRoot, 'python/a2ui_core/src');
  final bool pydanticAvailable = _hasPydantic(pythonBin, Platform.environment);
  final bool requirePython =
      Platform.environment['REQUIRE_PYTHON_TESTS'] == 'true' ||
      Platform.environment['VIRTUAL_ENV'] != null;
  if (!pydanticAvailable) {
    if (requirePython) {
      test('pydantic must be available in configured Python test environment', () {
        fail(
          'Python pydantic dependency is not installed or discoverable at $pythonBin. '
          'Failing because Python tests are required in this environment ($pythonBin) '
          'and must not fail open.',
        );
      });
      return;
    }
    stdout.writeln(
      'INFO: Skipping Python Builder Runtime Compilation & Execution tests: '
      'pydantic is not installed or discoverable at $pythonBin.',
    );
  }

  group(
    'Python Builder Runtime Compilation & Execution',
    skip: pydanticAvailable
        ? null
        : 'Python pydantic dependency not installed in test environment',
    () {
      late Directory tempDir;
      late Map<String, String> pyEnv;

      setUp(() {
        tempDir = Directory.systemTemp.createTempSync('python-runtime-test-');

        pyEnv = Map<String, String>.from(Platform.environment);
        final String existingPath = pyEnv['PYTHONPATH'] ?? '';
        pyEnv['PYTHONPATH'] = [
          tempDir.path,
          pythonSdkPath,
          pythonCorePath,
          if (existingPath.isNotEmpty) existingPath,
        ].join(Platform.isWindows ? ';' : ':');

        // Generate Python builders for all fixture catalogs into tempDir
        final Iterable<File> catalogFiles = Directory(
          p.join(fixturesDir, 'catalogs'),
        ).listSync().whereType<File>();

        for (final file in [...catalogFiles, File(basicCatalogPath)]) {
          final catalogJson =
              jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
          final catalog = CodegenCatalog.fromJson(catalogJson);
          final AnalysedCatalog analysed = CatalogAnalyzer.analyzeCodegen(
            catalog,
          );
          final emitter = PythonEmitter(analysed);
          emitter.emit(tempDir.path);
        }
      });

      tearDown(() {
        tempDir.deleteSync(recursive: true);
      });

      test('all generated Python files compile cleanly via py_compile', () {
        final Iterable<File> generatedFiles = tempDir
            .listSync()
            .whereType<File>()
            .where((f) => f.path.endsWith('.py'));

        expect(generatedFiles, isNotEmpty);

        for (final file in generatedFiles) {
          final ProcessResult result = Process.runSync(
            pythonBin,
            ['-m', 'py_compile', file.path],
            environment: pyEnv,
            workingDirectory: tempDir.path,
          );

          expect(
            result.exitCode,
            equals(0),
            reason:
                'Failed to compile ${p.basename(file.path)}:\n'
                '${result.stdout}\n${result.stderr}',
          );
        }
      });

      test(
        'fluent builders construct component tree and produce valid A2UI JSON',
        () {
          const pyScript = '''
import json
from basic import (
    Action,
    ActionEvent,
    Button,
    Card,
    Column,
    DataBinding,
    OpenUrl,
    Row,
    Text,
)
from a2ui.core.schema.server_to_client import (
    CreateSurface,
    CreateSurfaceMessage,
    UpdateComponents,
    UpdateComponentsMessage,
)

tree = Card(
    child=Column(
        children=[
            Text(text="Welcome to A2UI", variant="h1"),
            Row(
                children=[
                    Text(text=DataBinding(path="/app/status"), variant="caption"),
                    Button(
                        child=Text(text="Explore Docs"),
                        action=Action(
                            event=ActionEvent(
                                name="open_link",
                                context={"url": "https://a2ui.org"},
                            )
                        ),
                    ),
                ]
            ),
        ]
    )
)

fn_call = OpenUrl(url="https://a2ui.org/specification")
surface_msgs = [
    CreateSurfaceMessage(
        create_surface=CreateSurface(
            surface_id="surface_main",
            catalog_id="org.a2ui.basic",
        )
    ),
    UpdateComponentsMessage(
        update_components=UpdateComponents(
            surface_id="surface_main",
            components=tree.flatten(),
        )
    ),
]


def dump(messages):
    return [m.model_dump(by_alias=True, exclude_none=True) for m in messages]


output = {
    "surface_messages": dump(surface_msgs),
    "components": tree.flatten(),
    "function_call": fn_call.model_dump(by_alias=True, exclude_none=True),
}
print(json.dumps(output))
''';

          final scriptFile = File(p.join(tempDir.path, 'test_builder.py'))
            ..writeAsStringSync(pyScript);

          final ProcessResult pyResult = Process.runSync(
            pythonBin,
            [scriptFile.path],
            workingDirectory: tempDir.path,
            environment: pyEnv,
          );

          expect(
            pyResult.exitCode,
            equals(0),
            reason:
                'Python script failed:\n${pyResult.stdout}\n${pyResult.stderr}',
          );

          final result =
              jsonDecode(pyResult.stdout.toString().trim())
                  as Map<String, dynamic>;

          // Verify surface messages envelope
          final surfaceMsgs = result['surface_messages'] as List;
          expect(surfaceMsgs.length, equals(2));
          final firstSurfaceMsg = surfaceMsgs[0] as Map<String, dynamic>;
          final createMsg =
              firstSurfaceMsg['createSurface'] as Map<String, dynamic>;
          expect(createMsg['surfaceId'], equals('surface_main'));
          expect(createMsg['catalogId'], equals('org.a2ui.basic'));

          // Verify flattened components and hierarchical ID links
          final List<Map<String, dynamic>> comps =
              (result['components'] as List).cast<Map<String, dynamic>>();
          expect(comps.length, equals(7));

          final Map<String, dynamic> card = comps.firstWhere(
            (c) => c['component'] == 'Card',
          );
          final Map<String, dynamic> column = comps.firstWhere(
            (c) => c['component'] == 'Column',
          );
          final Map<String, dynamic> row = comps.firstWhere(
            (c) => c['component'] == 'Row',
          );
          final Map<String, dynamic> button = comps.firstWhere(
            (c) => c['component'] == 'Button',
          );
          final List<Map<String, dynamic>> texts = comps
              .where((c) => c['component'] == 'Text')
              .toList();

          expect(texts.length, equals(3));
          expect(card['child'], equals(column['id']));
          expect(column['children'], equals([texts[0]['id'], row['id']]));
          expect(row['children'], equals([texts[1]['id'], button['id']]));
          expect(button['child'], equals(texts[2]['id']));

          // Verify function call output
          expect(
            result['function_call'],
            equals({
              'call': 'openUrl',
              'args': {'url': 'https://a2ui.org/specification'},
            }),
          );
        },
      );

      test('strict validation rejects unrecognized properties at runtime', () {
        const pyScript = '''
from pydantic import ValidationError
from basic import Text

try:
    Text(text="Hello", unrecognized_typo_property="Bad")
    print("FAILED_NO_ERROR")
except ValidationError as e:
    assert "extra_forbidden" in str(e)
    print("VALIDATION_ERROR_SUCCESS")
''';

        final scriptFile = File(p.join(tempDir.path, 'test_strict.py'))
          ..writeAsStringSync(pyScript);

        final ProcessResult pyResult = Process.runSync(
          pythonBin,
          [scriptFile.path],
          workingDirectory: tempDir.path,
          environment: pyEnv,
        );

        expect(pyResult.exitCode, equals(0));
        expect(
          pyResult.stdout.toString().trim(),
          equals('VALIDATION_ERROR_SUCCESS'),
        );
      });

      test('open enums are strict when authoring and open when parsing', () {
        const pyScript = '''
import json
from pydantic import ValidationError
from a2ui.builder.v0_9 import OPEN_ENUM_CONTEXT
from basic import Text

try:
    Text(text="Custom Variant", variant="custom-hero-heading")
    authoring = "ACCEPTED"
except ValidationError:
    authoring = "REJECTED"

parsed = Text.model_validate(
    {"component": "Text", "text": "Custom Variant", "variant": "custom-hero-heading"},
    context=OPEN_ENUM_CONTEXT,
)

print(json.dumps({"authoring": authoring, "parsed_variant": parsed.variant}))
''';

        final scriptFile = File(p.join(tempDir.path, 'test_enum.py'))
          ..writeAsStringSync(pyScript);

        final ProcessResult pyResult = Process.runSync(
          pythonBin,
          [scriptFile.path],
          workingDirectory: tempDir.path,
          environment: pyEnv,
        );

        expect(
          pyResult.exitCode,
          equals(0),
          reason:
              'Python script failed:\n${pyResult.stdout}\n${pyResult.stderr}',
        );

        final output =
            jsonDecode(pyResult.stdout.toString().trim())
                as Map<String, dynamic>;
        expect(output['authoring'], equals('REJECTED'));
        expect(output['parsed_variant'], equals('custom-hero-heading'));
      });
    },
  );
}
