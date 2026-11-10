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

import 'dart:ffi' show Abi;
import 'dart:io';

import 'package:args/args.dart';
import 'package:path/path.dart' as p;

/// Detects the target platform identifier (e.g., 'linux-x64', 'darwin-arm64').
String detectTarget() => switch (Abi.current()) {
  Abi.linuxX64 => 'linux-x64',
  Abi.linuxArm64 => 'linux-arm64',
  Abi.macosX64 => 'darwin-x64',
  Abi.macosArm64 => 'darwin-arm64',
  Abi.windowsX64 => 'windows-x64',
  Abi.windowsArm64 => 'windows-arm64',
  final abi => throw UnsupportedError('Unsupported host ABI: $abi'),
};

/// Reads package version from pubspec.yaml.
String readPubspecVersion(Directory packageDir) {
  final pubspecFile = File(p.join(packageDir.path, 'pubspec.yaml'));
  if (!pubspecFile.existsSync()) {
    throw StateError('pubspec.yaml not found at ${pubspecFile.path}');
  }
  for (final String line in pubspecFile.readAsLinesSync()) {
    if (line.startsWith('version:')) {
      return line.substring('version:'.length).trim();
    }
  }
  throw StateError('version field not found in ${pubspecFile.path}');
}

/// Builds the argument parser for the compile tool.
ArgParser buildCompileArgParser() {
  return ArgParser()
    ..addOption(
      'target',
      abbr: 't',
      help:
          'Target platform identifier (must match host target; defaults to host target).',
    )
    ..addOption(
      'version',
      abbr: 'v',
      help: 'Version to inject (defaults to version in pubspec.yaml).',
    )
    ..addOption('output', abbr: 'o', help: 'Output binary file path.')
    ..addFlag(
      'help',
      abbr: 'h',
      negatable: false,
      help: 'Show this help message.',
    );
}

void main(List<String> args) {
  final ArgParser parser = buildCompileArgParser();

  final ArgResults parsed;
  try {
    parsed = parser.parse(args);
  } on FormatException catch (e) {
    stderr.writeln('Error: ${e.message}');
    stderr.writeln(parser.usage);
    exit(64);
  }

  if (parsed['help'] == true) {
    stdout.writeln(
      'Compiles the A2UI CLI into a standalone native executable.\n\n'
      'Usage: dart tool/compile.dart [options]\n',
    );
    stdout.writeln(parser.usage);
    exit(0);
  }

  // Find package directory relative to script
  final scriptFile = File(Platform.script.toFilePath());
  final Directory packageDir = scriptFile.parent.parent;
  final String entrypoint = p.join(packageDir.path, 'bin', 'a2ui.dart');

  String? nonEmptyOption(String name) {
    final String? value = (parsed[name] as String?)?.trim();
    return (value == null || value.isEmpty) ? null : value;
  }

  final String hostTarget = detectTarget();
  final String target = nonEmptyOption('target') ?? hostTarget;
  if (target != hostTarget) {
    stderr.writeln(
      'Error: --target $target does not match host $hostTarget; '
      'dart compile exe cannot cross-compile to this target.',
    );
    exit(64);
  }

  final String version =
      nonEmptyOption('version') ?? readPubspecVersion(packageDir);

  final bool isWindows = target.startsWith('windows');
  final ext = isWindows ? '.exe' : '';
  final String rawOutput =
      nonEmptyOption('output') ??
      p.join(packageDir.path, 'dist', 'a2ui-$target$ext');
  final File outFile = File(rawOutput).absolute;
  final String outputPath = outFile.path;

  // Ensure output directory exists.
  if (!outFile.parent.existsSync()) {
    outFile.parent.createSync(recursive: true);
  }

  stdout.writeln('Compiling A2UI CLI:');
  stdout.writeln('  Entrypoint: $entrypoint');
  stdout.writeln('  Target:     $target');
  stdout.writeln('  Version:    $version');
  stdout.writeln('  Output:     $outputPath');

  final compileArgs = [
    'compile',
    'exe',
    entrypoint,
    '-DCLI_VERSION=$version',
    '-o',
    outputPath,
  ];

  final String dartExec = Platform.resolvedExecutable;
  stdout.writeln('Running: $dartExec ${compileArgs.join(' ')}');
  final ProcessResult result = Process.runSync(
    dartExec,
    compileArgs,
    workingDirectory: packageDir.path,
  );

  stdout.write(result.stdout);
  stderr.write(result.stderr);

  if (result.exitCode != 0) {
    stderr.writeln('Compilation failed with exit code ${result.exitCode}');
    exit(result.exitCode);
  }

  if (outFile.existsSync()) {
    final int sizeBytes = outFile.lengthSync();
    final double sizeMb = sizeBytes / (1024 * 1024);
    stdout.writeln(
      'Successfully compiled $outputPath (${sizeMb.toStringAsFixed(2)} MB)',
    );
  } else {
    stderr.writeln('Error: Output binary was not found at $outputPath');
    exit(1);
  }
}
