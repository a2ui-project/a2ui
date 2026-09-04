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
  final repoVenv = p.join(repoRoot, '.venv/bin/python');
  if (File(repoVenv).existsSync()) {
    return repoVenv;
  }
  final virtualEnv = Platform.environment['VIRTUAL_ENV'];
  if (virtualEnv != null) {
    final venvPython = p.join(virtualEnv, 'bin/python');
    if (File(venvPython).existsSync()) {
      return venvPython;
    }
  }
  return 'python3';
}

String _findRepoRoot() {
  var dir = Directory.current;
  while (!File(p.join(dir.path, 'pubspec.yaml')).existsSync() ||
      !Directory(p.join(dir.path, 'conformance')).existsSync()) {
    final parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  return dir.path;
}

void main() {
  group('Dart CLI End-to-End Python SDK Integration', () {
    final repoRoot = _findRepoRoot();
    final packageRoot = Directory(p.join(repoRoot, 'dart/a2ui_cli')).existsSync()
        ? p.join(repoRoot, 'dart/a2ui_cli')
        : Directory.current.path;
    final catalogPath = p.join(
      repoRoot,
      'specification/v0_9_1/catalogs/basic/catalog.json',
    );
    final pythonBin = getPythonExecutable(repoRoot);
    final pythonSdkPath = p.join(repoRoot, 'agent_sdks/python/a2ui_agent/src');
    final pythonCorePath = p.join(repoRoot, 'agent_sdks/python/a2ui_core/src');

    test(
      'generates basic.py and executes Python fluent builders to produce valid A2UI JSON',
      () {
        final tmpDir = Directory.systemTemp.createTempSync('dart-cli-py-e2e-');
        try {
          // 1. Run Dart CLI codegen command
          final codegenResult = Process.runSync(Platform.resolvedExecutable, [
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
                'Codegen failed:\n${codegenResult.stdout}\n${codegenResult.stderr}',
          );

          final generatedFile = File(p.join(tmpDir.path, 'basic.py'));
          expect(generatedFile.existsSync(), isTrue);

          // 2. Write Python test script that imports generated library & builds component tree
          const pyScript = '''
import json
import sys
from basic import (
    Action,
    Button,
    Card,
    Column,
    Row,
    Text,
    bind,
    create_surface,
    open_url,
    update_components,
)

tree = Card(
    child=Column(
        children=[
            Text(text="Welcome to A2UI", variant="h1"),
            Row(
                children=[
                    Text(text=bind("/app/status"), variant="caption"),
                    Button(
                        child=Text(text="Explore Docs"),
                        action=Action(event="open_link", context={"url": "https://a2ui.org"}),
                    ),
                ]
            ),
        ]
    )
)

fn_call = open_url(url="https://a2ui.org/specification")
surface_msgs = create_surface("surface_main", root=tree, catalog_id="org.a2ui.basic")
update_msgs = update_components("surface_main", root=tree)

output = {
    "surface_messages": surface_msgs,
    "update_messages": update_msgs,
    "components": tree.to_components(),
    "function_call": fn_call.to_dict(),
}
print(json.dumps(output))
''';

          final scriptFile = File(p.join(tmpDir.path, 'test_builder.py'));
          scriptFile.writeAsStringSync(pyScript);

          // 3. Execute Python subprocess
          final pyEnv = Map<String, String>.from(Platform.environment);
          final existingPythonPath = pyEnv['PYTHONPATH'] ?? '';
          pyEnv['PYTHONPATH'] = [
            tmpDir.path,
            pythonSdkPath,
            pythonCorePath,
            if (existingPythonPath.isNotEmpty) existingPythonPath,
          ].join(Platform.isWindows ? ';' : ':');

          final pyResult = Process.runSync(
            pythonBin,
            [scriptFile.path],
            workingDirectory: tmpDir.path,
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

          // 4. Verify createSurface envelope
          final surfaceMsgs = result['surface_messages'] as List;
          expect(surfaceMsgs.length, equals(2));
          final createMsg =
              surfaceMsgs[0]['createSurface'] as Map<String, dynamic>;
          expect(createMsg['surfaceId'], equals('surface_main'));
          expect(createMsg['catalogId'], equals('org.a2ui.basic'));

          // 5. Verify updateComponents envelope
          final updateMsg =
              surfaceMsgs[1]['updateComponents'] as Map<String, dynamic>;
          expect(updateMsg['surfaceId'], equals('surface_main'));

          // 6. Verify flattened components & hierarchical ID references
          final comps = (result['components'] as List)
              .cast<Map<String, dynamic>>();
          expect(comps.length, equals(7));

          final card = comps.firstWhere((c) => c['component'] == 'Card');
          final column = comps.firstWhere((c) => c['component'] == 'Column');
          final row = comps.firstWhere((c) => c['component'] == 'Row');
          final button = comps.firstWhere((c) => c['component'] == 'Button');
          final texts = comps.where((c) => c['component'] == 'Text').toList();

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
      },
    );

    test(
      'verifies generated Pydantic models reject misspelled properties at runtime in Python',
      () {
        final tmpDir = Directory.systemTemp.createTempSync(
          'dart-cli-py-strict-',
        );
        try {
          Process.runSync(Platform.resolvedExecutable, [
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
          final existingPythonPath = pyEnv['PYTHONPATH'] ?? '';
          pyEnv['PYTHONPATH'] = [
            tmpDir.path,
            pythonSdkPath,
            pythonCorePath,
            if (existingPythonPath.isNotEmpty) existingPythonPath,
          ].join(Platform.isWindows ? ';' : ':');

          final pyResult = Process.runSync(
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
      },
    );

    test(
      'verifies generated open enums accept custom string variants in Python',
      () {
        final tmpDir = Directory.systemTemp.createTempSync('dart-cli-py-enum-');
        try {
          Process.runSync(Platform.resolvedExecutable, [
            'run',
            p.join(packageRoot, 'bin/a2ui.dart'),
            'codegen',
            '-c',
            catalogPath,
            '-o',
            tmpDir.path,
          ], workingDirectory: packageRoot);

          const pyScript = '''
import json
from basic import Action, Button, Text

btn = Button(
    child=Text(text="Custom Variant", variant="custom-hero-heading"),
    action=Action(event="click"),
    variant="custom-pill-gradient",
)
comps = btn.to_components()
button_comp = next(c for c in comps if c["component"] == "Button")
text_comp = next(c for c in comps if c["component"] == "Text")

output = {
    "button_variant": button_comp.get("variant"),
    "text_variant": text_comp.get("variant"),
}
print(json.dumps(output))
''';

          final scriptFile = File(p.join(tmpDir.path, 'test_enum.py'));
          scriptFile.writeAsStringSync(pyScript);

          final pyEnv = Map<String, String>.from(Platform.environment);
          final existingPythonPath = pyEnv['PYTHONPATH'] ?? '';
          pyEnv['PYTHONPATH'] = [
            tmpDir.path,
            pythonSdkPath,
            pythonCorePath,
            if (existingPythonPath.isNotEmpty) existingPythonPath,
          ].join(Platform.isWindows ? ';' : ':');

          final pyResult = Process.runSync(
            pythonBin,
            [scriptFile.path],
            workingDirectory: tmpDir.path,
            environment: pyEnv,
          );

          expect(pyResult.exitCode, equals(0));
          final output =
              jsonDecode(pyResult.stdout.toString().trim())
                  as Map<String, dynamic>;
          expect(output['button_variant'], equals('custom-pill-gradient'));
          expect(output['text_variant'], equals('custom-hero-heading'));
        } finally {
          tmpDir.deleteSync(recursive: true);
        }
      },
    );
  });
}
