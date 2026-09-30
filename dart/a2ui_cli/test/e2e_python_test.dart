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
      !Directory(p.join(dir.path, 'conformance')).existsSync()) {
    final Directory parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  return dir.path;
}

String _findDartExecutable() {
  final String resolved = Platform.resolvedExecutable;
  if (!resolved.contains('flutter_tester')) {
    return resolved;
  }
  final String flutterBinDir = p.dirname(resolved);
  final candidates = <String>[
    'dart',
    p.normalize(
      p.join(flutterBinDir, '../../../../bin/cache/dart-sdk/bin/dart'),
    ),
    p.normalize(p.join(flutterBinDir, '../../../../bin/dart')),
    p.normalize(p.join(flutterBinDir, '../../../dart-sdk/bin/dart')),
  ];
  for (final candidate in candidates) {
    if (File(candidate).existsSync()) {
      return candidate;
    }
  }
  return 'dart';
}

void main() {
  final String dartBin = _findDartExecutable();
  final String repoRoot = _findRepoRoot();
  final String packageRoot =
      Directory(p.join(repoRoot, 'dart/a2ui_cli')).existsSync()
      ? p.join(repoRoot, 'dart/a2ui_cli')
      : Directory.current.path;
  final String catalogPath = p.join(
    repoRoot,
    'specification/v0_9_1/catalogs/basic/catalog.json',
  );
  final String pythonBin = getPythonExecutable(repoRoot);
  final String pythonSdkPath = p.join(repoRoot, 'python/a2ui_agent/src');
  final String pythonCorePath = p.join(repoRoot, 'python/a2ui_core/src');
  final bool pydanticAvailable = _hasPydantic(pythonBin, Platform.environment);

  group(
    'Dart CLI End-to-End Python SDK Integration',
    skip: pydanticAvailable
        ? null
        : 'Python pydantic dependency not installed in test environment',
    () {
      test('generates basic.py and executes Python fluent builders to produce '
          'valid A2UI JSON', () {
        final Directory tmpDir = Directory.systemTemp.createTempSync(
          'dart-cli-py-e2e-',
        );
        try {
          // 1. Run Dart CLI codegen command
          final ProcessResult codegenResult = Process.runSync(dartBin, [
            'run',
            p.join(packageRoot, 'bin/a2ui.dart'),
            'codegen',
            '-c',
            catalogPath,
            '-o',
            tmpDir.path,
          ], workingDirectory: packageRoot);

          expect(
            codegenResult.exitCode,
            equals(0),
            reason:
                'Codegen failed:\n'
                '${codegenResult.stdout}\n${codegenResult.stderr}',
          );

          final generatedFile = File(p.join(tmpDir.path, 'basic.py'));
          expect(generatedFile.existsSync(), isTrue);

          // 2. Write Python test script that imports generated library
          const pyScript = '''
import json
import sys
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
update_msgs = [
    UpdateComponentsMessage(
        update_components=UpdateComponents(
            surface_id="surface_main",
            components=tree.flatten(),
        )
    )
]


def dump(messages):
    return [m.model_dump(by_alias=True, exclude_none=True) for m in messages]


output = {
    "surface_messages": dump(surface_msgs),
    "update_messages": dump(update_msgs),
    "components": tree.flatten(),
    "function_call": fn_call.model_dump(by_alias=True, exclude_none=True),
}
print(json.dumps(output))
''';

          final scriptFile = File(p.join(tmpDir.path, 'test_builder.py'));
          scriptFile.writeAsStringSync(pyScript);

          // 3. Execute Python subprocess
          final pyEnv = Map<String, String>.from(Platform.environment);
          final String existingPythonPath = pyEnv['PYTHONPATH'] ?? '';
          pyEnv['PYTHONPATH'] = [
            tmpDir.path,
            pythonSdkPath,
            pythonCorePath,
            if (existingPythonPath.isNotEmpty) existingPythonPath,
          ].join(Platform.isWindows ? ';' : ':');

          final ProcessResult pyResult = Process.runSync(
            pythonBin,
            [scriptFile.path],
            workingDirectory: tmpDir.path,
            environment: pyEnv,
          );

          expect(
            pyResult.exitCode,
            equals(0),
            reason:
                'Python script failed:\n'
                '${pyResult.stdout}\n${pyResult.stderr}',
          );

          final result =
              jsonDecode(pyResult.stdout.toString().trim())
                  as Map<String, dynamic>;

          // 4. Verify createSurface envelope
          final surfaceMsgs = result['surface_messages'] as List;
          expect(surfaceMsgs.length, equals(2));
          final firstSurfaceMsg = surfaceMsgs[0] as Map<String, dynamic>;
          final createMsg =
              firstSurfaceMsg['createSurface'] as Map<String, dynamic>;
          expect(createMsg['surfaceId'], equals('surface_main'));
          expect(createMsg['catalogId'], equals('org.a2ui.basic'));

          // 5. Verify updateComponents envelope
          final secondSurfaceMsg = surfaceMsgs[1] as Map<String, dynamic>;
          final updateMsg =
              secondSurfaceMsg['updateComponents'] as Map<String, dynamic>;
          expect(updateMsg['surfaceId'], equals('surface_main'));

          // 6. Verify flattened components & hierarchical ID references
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

          // 7. Verify bindings and actions
          expect(texts[0]['text'], equals('Welcome to A2UI'));
          expect(texts[0]['variant'], equals('h1'));
          expect(texts[1]['text'], equals({'path': '/app/status'}));
          expect(
            button['action'],
            equals({
              'event': {
                'name': 'open_link',
                'context': {'url': 'https://a2ui.org'},
              },
            }),
          );

          // 8. Verify function call output
          expect(
            result['function_call'],
            equals({
              'call': 'openUrl',
              'args': {'url': 'https://a2ui.org/specification'},
            }),
          );
        } finally {
          tmpDir.deleteSync(recursive: true);
        }
      });

      test('verifies generated Pydantic models reject misspelled properties at '
          'runtime in Python', () {
        final Directory tmpDir = Directory.systemTemp.createTempSync(
          'dart-cli-py-strict-',
        );
        try {
          Process.runSync(dartBin, [
            'run',
            p.join(packageRoot, 'bin/a2ui.dart'),
            'codegen',
            '-c',
            catalogPath,
            '-o',
            tmpDir.path,
          ], workingDirectory: packageRoot);

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

          final scriptFile = File(p.join(tmpDir.path, 'test_strict.py'));
          scriptFile.writeAsStringSync(pyScript);

          final pyEnv = Map<String, String>.from(Platform.environment);
          final String existingPythonPath = pyEnv['PYTHONPATH'] ?? '';
          pyEnv['PYTHONPATH'] = [
            tmpDir.path,
            pythonSdkPath,
            pythonCorePath,
            if (existingPythonPath.isNotEmpty) existingPythonPath,
          ].join(Platform.isWindows ? ';' : ':');

          final ProcessResult pyResult = Process.runSync(
            pythonBin,
            [scriptFile.path],
            workingDirectory: tmpDir.path,
            environment: pyEnv,
          );

          expect(pyResult.exitCode, equals(0));
          expect(
            pyResult.stdout.toString().trim(),
            equals('VALIDATION_ERROR_SUCCESS'),
          );
        } finally {
          tmpDir.deleteSync(recursive: true);
        }
      });

      test('verifies generated enums are strict when authoring and open when '
          'parsing', () {
        final Directory tmpDir = Directory.systemTemp.createTempSync(
          'dart-cli-py-enum-',
        );
        try {
          Process.runSync(dartBin, [
            'run',
            p.join(packageRoot, 'bin/a2ui.dart'),
            'codegen',
            '-c',
            catalogPath,
            '-o',
            tmpDir.path,
          ], workingDirectory: packageRoot);

          // The generated enums carry OPEN_ENUM metadata: the annotation
          // stays the strict Literal so authoring and static analysis reject
          // a typo, and an unknown value from a newer catalog revision is
          // only accepted when the caller explicitly asks for lenient
          // parsing.
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

          final scriptFile = File(p.join(tmpDir.path, 'test_enum.py'));
          scriptFile.writeAsStringSync(pyScript);

          final pyEnv = Map<String, String>.from(Platform.environment);
          final String existingPythonPath = pyEnv['PYTHONPATH'] ?? '';
          pyEnv['PYTHONPATH'] = [
            tmpDir.path,
            pythonSdkPath,
            pythonCorePath,
            if (existingPythonPath.isNotEmpty) existingPythonPath,
          ].join(Platform.isWindows ? ';' : ':');

          final ProcessResult pyResult = Process.runSync(
            pythonBin,
            [scriptFile.path],
            workingDirectory: tmpDir.path,
            environment: pyEnv,
          );

          expect(
            pyResult.exitCode,
            equals(0),
            reason:
                'Python script failed:\n'
                '${pyResult.stdout}\n${pyResult.stderr}',
          );
          final output =
              jsonDecode(pyResult.stdout.toString().trim())
                  as Map<String, dynamic>;
          expect(output['authoring'], equals('REJECTED'));
          expect(output['parsed_variant'], equals('custom-hero-heading'));
        } finally {
          tmpDir.deleteSync(recursive: true);
        }
      });
    },
  );
}
