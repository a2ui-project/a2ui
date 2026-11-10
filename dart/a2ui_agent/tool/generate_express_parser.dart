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

/// Generates the Express lexer and parser from the specification's
/// `Express.g4` with ANTLR.
///
/// The output in `lib/src/inference_formats/express/generated/` is checked
/// in. Run from the package directory after editing the grammar, and commit
/// the result:
///
/// ```sh
/// dart run tool/generate_express_parser.dart
/// ```
///
/// With `--check`, the tool compares `generated/` with fresh output instead of
/// writing it, and exits 1 if they differ. CI runs this check.
///
/// ANTLR needs a Java runtime (11 or newer), from `JAVA_HOME` or the `PATH`.
/// The ANTLR jar is downloaded from Maven Central on first use, into the Maven
/// cache where the Python SDK's `antlr4-tools` keeps it too.
library;

import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:yaml/yaml.dart';

// Keep in step with the antlr4 constraint in pubspec.yaml.
const String _antlrVersion = '4.13.2';

/// The SHA-256 of the jar Maven Central publishes for [_antlrVersion].
const String _antlrJarSha256 =
    'eae2dfa119a64327444672aff63e9ec35a20180dc5b8090b7a6ab85125df4d76';

const String _antlrJarName = 'antlr4-$_antlrVersion-complete.jar';
const String _antlrJarUrl =
    'https://repo1.maven.org/maven2/org/antlr/antlr4/$_antlrVersion/'
    '$_antlrJarName';

/// ANTLR names its output after the grammar; Dart files use snake_case
/// names. Its `.interp` and `.tokens` files are for tools, so they are not
/// kept.
const Map<String, String> _renames = {
  'ExpressLexer.dart': 'express_lexer.dart',
  'ExpressParser.dart': 'express_parser.dart',
};

final Directory _packageDir = Directory.fromUri(Platform.script.resolve('..'));
final File _grammar = File.fromUri(
  _packageDir.uri.resolve(
    '../../specification/inference_formats/express/Express.g4',
  ),
);
final Directory _generatedDir = Directory.fromUri(
  _packageDir.uri.resolve('lib/src/inference_formats/express/generated/'),
);
const String _location = 'lib/src/inference_formats/express/generated';
const String _regenerateCommand = 'dart run tool/generate_express_parser.dart';

/// ANTLR could not be found or did not finish successfully.
class _GenerationError implements Exception {
  _GenerationError(this.message);

  final String message;
}

Future<void> main(List<String> args) async {
  final bool check = args.contains('--check');
  if (args.any((arg) => arg != '--check')) {
    stderr.writeln('Usage: $_regenerateCommand [--check]');
    exitCode = 64;
    return;
  }

  final Map<String, String> expected;
  try {
    expected = await _generate();
  } on _GenerationError catch (e) {
    stderr.writeln('error: ${e.message}');
    exitCode = 1;
    return;
  }

  final Map<String, String> current = _readGeneratedDir();
  final List<String> stale = [
    for (final String name in {...current.keys, ...expected.keys})
      if (current[name] != expected[name]) name,
  ]..sort();

  if (check) {
    if (stale.isEmpty) {
      stdout.writeln('$_location matches ${_grammar.uri.pathSegments.last}.');
      return;
    }
    stderr.writeln(
      '$_location is out of date (${stale.join(', ')}). Run '
      '`$_regenerateCommand` from dart/a2ui_agent and commit the result.',
    );
    exitCode = 1;
    return;
  }

  _generatedDir.createSync(recursive: true);
  for (final name in stale) {
    final file = File.fromUri(_generatedDir.uri.resolve(name));
    if (expected[name] case final String content) {
      file.writeAsStringSync(content);
      stdout.writeln('written  $name');
    } else {
      file.deleteSync();
      stdout.writeln('deleted  $name');
    }
  }
  stdout.writeln(
    stale.isEmpty
        ? '$_location is up to date.'
        : '$_location: ${stale.length} file(s) updated.',
  );
}

/// Runs ANTLR on the grammar and returns the files for `generated/`, keyed
/// by name, renamed and formatted.
Future<Map<String, String>> _generate() async {
  if (!_grammar.existsSync()) {
    throw _GenerationError('Grammar not found: ${_grammar.path}');
  }
  final File jar = await _antlrJar();
  final Directory tmp = Directory.systemTemp.createTempSync('express_parser');
  try {
    // Running from the grammar's directory keeps absolute paths out of the
    // generated headers.
    _run(_java(), [
      '-jar',
      jar.path,
      '-Dlanguage=Dart',
      '-no-listener',
      '-no-visitor',
      '-o',
      tmp.path,
      _grammar.uri.pathSegments.last,
    ], workingDirectory: _grammar.parent.path);

    final out = Directory('${tmp.path}/out')..createSync();
    for (final MapEntry<String, String> rename in _renames.entries) {
      File('${tmp.path}/${rename.key}').copySync('${out.path}/${rename.value}');
    }
    // `dart format` gives a package's files the language version of its SDK
    // floor. Files outside a package get the newest one instead, so it is
    // given explicitly.
    _run(Platform.resolvedExecutable, [
      'format',
      '--language-version=${_languageVersion()}',
      out.path,
    ]);
    return {
      for (final String name in _renames.values)
        name: File('${out.path}/$name').readAsStringSync(),
    };
  } finally {
    tmp.deleteSync(recursive: true);
  }
}

/// The files currently in `generated/`, keyed by name.
Map<String, String> _readGeneratedDir() {
  if (!_generatedDir.existsSync()) return {};
  return {
    for (final File file in _generatedDir.listSync().whereType<File>())
      file.uri.pathSegments.last: file.readAsStringSync(),
  };
}

/// The language version of this package: the lower bound of its SDK
/// constraint, such as `3.10` for `>=3.10.0 <4.0.0`.
String _languageVersion() {
  final pubspec =
      loadYaml(
            File.fromUri(
              _packageDir.uri.resolve('pubspec.yaml'),
            ).readAsStringSync(),
          )
          as YamlMap;
  final constraint = (pubspec['environment'] as YamlMap)['sdk'] as String;
  final Match match = RegExp(r'(\d+)\.(\d+)').firstMatch(constraint)!;
  return '${match[1]}.${match[2]}';
}

/// The Java executable, from `JAVA_HOME` if it is set.
String _java() {
  final String? home = Platform.environment['JAVA_HOME'];
  if (home == null || home.isEmpty) return 'java';
  // A path, unlike a bare name, is run without the extension Windows adds.
  final executable = Platform.isWindows ? 'java.exe' : 'java';
  return '$home${Platform.pathSeparator}bin${Platform.pathSeparator}'
      '$executable';
}

/// The ANTLR jar, downloaded into the Maven cache if it is not there yet.
Future<File> _antlrJar() async {
  final String? home =
      Platform.environment['HOME'] ?? Platform.environment['USERPROFILE'];
  if (home == null) {
    throw _GenerationError(
      'Neither HOME nor USERPROFILE is set, so the Maven cache for the ANTLR '
      'jar cannot be found.',
    );
  }
  final jar = File(
    [
      home,
      '.m2',
      'repository',
      'org',
      'antlr',
      'antlr4',
      _antlrVersion,
      _antlrJarName,
    ].join(Platform.pathSeparator),
  );
  if (jar.existsSync()) {
    _verify(
      jar.readAsBytesSync(),
      jar.path,
      hint: ' Delete it to download it again.',
    );
    return jar;
  }

  stdout.writeln('Downloading $_antlrJarUrl');
  final client = HttpClient();
  final List<int> bytes;
  try {
    final HttpClientResponse response = await (await client.getUrl(
      Uri.parse(_antlrJarUrl),
    )).close();
    if (response.statusCode != HttpStatus.ok) {
      throw _GenerationError(
        'Downloading $_antlrJarUrl failed with HTTP ${response.statusCode}.',
      );
    }
    bytes = [for (final List<int> chunk in await response.toList()) ...chunk];
  } on IOException catch (e) {
    throw _GenerationError('Downloading $_antlrJarUrl failed: $e');
  } finally {
    client.close();
  }
  _verify(bytes, _antlrJarUrl);
  jar.parent.createSync(recursive: true);
  // Written beside the jar and renamed, so an interrupted download does not
  // leave a partial jar in the cache.
  final partial = File('${jar.path}.part')..writeAsBytesSync(bytes);
  return partial.renameSync(jar.path);
}

void _verify(List<int> bytes, String source, {String hint = ''}) {
  final digest = sha256.convert(bytes).toString();
  if (digest != _antlrJarSha256) {
    throw _GenerationError(
      '$source has SHA-256 $digest, but ANTLR $_antlrVersion has '
      '$_antlrJarSha256.$hint',
    );
  }
}

/// Runs [executable], and throws with its output if it fails.
void _run(
  String executable,
  List<String> arguments, {
  String? workingDirectory,
}) {
  final ProcessResult result;
  try {
    result = Process.runSync(
      executable,
      arguments,
      workingDirectory: workingDirectory,
    );
  } on ProcessException catch (e) {
    throw _GenerationError(
      'Could not run $executable: ${e.message}. ANTLR needs a Java runtime '
      '(11 or newer) on the PATH or in JAVA_HOME.',
    );
  }
  if (result.exitCode != 0) {
    throw _GenerationError(
      '$executable ${arguments.join(' ')} failed with exit code '
      '${result.exitCode}:\n${result.stdout}${result.stderr}',
    );
  }
}
