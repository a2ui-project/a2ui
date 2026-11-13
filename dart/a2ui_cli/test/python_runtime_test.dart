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

      test('raw JSON integral enums retain exact decimal values', () async {
        final input = File(p.join(tempDir.path, 'precision.json'))
          ..writeAsStringSync(r'''
{
  "catalogId": "precision",
  "components": {
    "Input": {
      "properties": {
        "value": {"$ref": "#/$defs/Value"},
        "ratio": {"type": "number", "default": 0.1, "minimum": 1e-300, "maximum": 1.5},
        "label": {
          "type": "string",
          "enum": ["-9223372036854775809", "1.0000000000000000001", "quote\"9007199254740993.0\\end"]
        }
      },
      "required": ["value", "label"]
    }
  },
  "$defs": {
    "Value": {
      "type": "integer",
      "enum": [9007199254740993.0, 9223372036854775807.0, -9223372036854775808.0, 12300e-2, 1.2300e2]
    }
  }
}
''');
        final stderr = StringBuffer();
        final int result = await runCli(
          [
            'codegen',
            '-c',
            input.path,
            '-o',
            p.join(tempDir.path, 'precision.py'),
          ],
          stdout: StringBuffer(),
          stderr: stderr,
        );
        expect(result, 0, reason: stderr.toString());
        final ProcessResult validation = Process.runSync(
          pythonBin,
          [
            '-c',
            r'''
from typing import get_args

from pydantic import ValidationError
from precision import Input, InputLabel

assert get_args(get_args(InputLabel)[0]) == (
    "-9223372036854775809", "1.0000000000000000001",
    'quote"9007199254740993.0\\end',
)

for value in [9007199254740993, 9223372036854775807, -9223372036854775808, 123]:
    node = Input(value=value, label="-9223372036854775809")
    assert node.value == value and type(node.value) is int
    assert node.ratio == 0.1
for label in ["1.0000000000000000001", 'quote"9007199254740993.0\\end']:
    assert Input(value=123, label=label).label == label
for value in [9007199254740992, 9223372036854775806, -9223372036854775809,
              "9007199254740993", True]:
    try:
        Input(value=value, label="-9223372036854775809")
    except ValidationError:
        pass
    else:
        raise AssertionError(f"Incorrect accepted value: {value!r}")
''',
          ],
          environment: pyEnv,
          workingDirectory: tempDir.path,
        );
        expect(validation.exitCode, 0, reason: validation.stderr.toString());
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

      test(
        'scalar enums reject wrong JSON types and nullable fields stay required',
        () {
          const pyScript = '''
from pydantic import ValidationError
from scalar_types import DataBinding, ScalarInput, flatten_component_tree

values = dict(count=1, enabled=True, label="small", value=None, explicitNull=None)
node = ScalarInput.model_validate(values)
assert node.value is None
assert node.explicit_null is None
assert node.optional_value is None
assert ScalarInput.model_fields["value"].is_required()
assert ScalarInput.model_fields["explicit_null"].is_required()
assert not ScalarInput.model_fields["optional_value"].is_required()
assert node.model_dump(by_alias=True)["value"] is None
assert type(flatten_component_tree(node)[0]["count"]) is int
assert type(flatten_component_tree(node)[0]["enabled"]) is bool

for value in (1, False, "small", None):
    parsed = ScalarInput.model_validate(dict(values, mixed=value))
    assert parsed.mixed == value and type(parsed.mixed) is type(value)

for value in ("2030-01-02", {"path": "/input"}):
    parsed = ScalarInput.model_validate(dict(values, value=value))
    assert isinstance(parsed.value, (str, DataBinding))

for field, invalid_values in {
    "count": ["1", "2", True, False, 3],
    "enabled": ["true", 1, False],
    "label": [1, True, "unknown"],
    "value": [7, True],
    "explicitNull": [7, True],
    "mixed": [True, 0, "1"],
}.items():
    for invalid in invalid_values:
        try:
            ScalarInput.model_validate(dict(values, **{field: invalid}))
        except ValidationError:
            pass
        else:
            raise AssertionError((field, invalid))

for field in ("count", "enabled", "label", "value", "explicitNull"):
    omitted = {key: value for key, value in values.items() if key != field}
    try:
        ScalarInput.model_validate(omitted)
    except ValidationError:
        pass
    else:
        raise AssertionError(f"Missing required field accepted: {field}")
''';
          final scriptFile = File(p.join(tempDir.path, 'test_scalar_types.py'))
            ..writeAsStringSync(pyScript);
          final ProcessResult result = Process.runSync(
            pythonBin,
            [scriptFile.path],
            workingDirectory: tempDir.path,
            environment: pyEnv,
          );
          expect(
            result.exitCode,
            0,
            reason: '${result.stdout}\n${result.stderr}',
          );
        },
      );

      test(
        'nested nullable unions import and keep required fields required',
        () {
          const pyScript = '''
from pydantic import ValidationError
from scalar_types import NullableInput

for value in (None, "2030-01-02"):
    node = NullableInput(value=value, onlyNull=None)
    assert node.value == value
    assert node.only_null is None
    assert node.optional_value is None
assert NullableInput.model_fields["value"].is_required()
assert NullableInput.model_fields["only_null"].is_required()
assert not NullableInput.model_fields["optional_value"].is_required()

for invalid in (
    {"value": None},
    {"onlyNull": None},
    {"value": 7, "onlyNull": None},
    {"value": None, "onlyNull": "wrong"},
):
    try:
        NullableInput.model_validate(invalid)
    except ValidationError:
        pass
    else:
        raise AssertionError(invalid)
''';
          final scriptFile = File(
            p.join(tempDir.path, 'test_nullable_unions.py'),
          )..writeAsStringSync(pyScript);
          final ProcessResult result = Process.runSync(
            pythonBin,
            [scriptFile.path],
            workingDirectory: tempDir.path,
            environment: pyEnv,
          );
          expect(
            result.exitCode,
            0,
            reason: '${result.stdout}\n${result.stderr}',
          );
        },
      );

      test('integral double enums emit exact integer literals', () {
        const pyScript = '''
from pydantic import ValidationError
from scalar_types import IntegralInput, flatten_component_tree

for count in (1, 2):
    for size in (9007199254740992, -9223372036854775808, 9223372036854774784):
        node = IntegralInput(count=count, size=size)
        wire = flatten_component_tree(node)[0]
        assert wire["count"] == count and type(wire["count"]) is int
        assert wire["size"] == size and type(wire["size"]) is int

for invalid in (
    {"count": "1", "size": 9007199254740992},
    {"count": "2", "size": 9007199254740992},
    {"count": True, "size": 9007199254740992},
    {"count": 1, "size": "9007199254740992"},
    {"count": 1, "size": 9223372036854775807},
):
    try:
        IntegralInput.model_validate(invalid)
    except ValidationError:
        pass
    else:
        raise AssertionError(invalid)
''';
        final scriptFile = File(p.join(tempDir.path, 'test_integral_enums.py'))
          ..writeAsStringSync(pyScript);
        final ProcessResult result = Process.runSync(
          pythonBin,
          [scriptFile.path],
          workingDirectory: tempDir.path,
          environment: pyEnv,
        );
        expect(
          result.exitCode,
          0,
          reason: '${result.stdout}\n${result.stderr}',
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
