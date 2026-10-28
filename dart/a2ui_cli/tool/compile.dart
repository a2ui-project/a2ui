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

import 'package:args/args.dart';
import 'package:path/path.dart' as p;

/// Detects the target platform identifier (e.g., 'linux-x64', 'darwin-arm64').
String detectTarget() {
  final String os = switch (Platform.operatingSystem) {
    'macos' => 'darwin',
    'linux' => 'linux',
    'windows' => 'windows',
    final other => other,
  };

  String arch = 'x64';
  if (Platform.isLinux || Platform.isMacOS) {
    try {
      final ProcessResult uname = Process.runSync('uname', ['-m']);
      final String machine = uname.stdout.toString().trim();
      if (machine == 'arm64' || machine == 'aarch64') {
        arch = 'arm64';
      } else if (machine == 'x86_64' || machine == 'amd64') {
        arch = 'x64';
      }
    } on Object {
      // Fall back to x64.
    }
  } else if (Platform.isWindows) {
    final String? procArch = Platform.environment['PROCESSOR_ARCHITECTURE'];
    if (procArch != null && procArch.toLowerCase().contains('arm')) {
      arch = 'arm64';
    }
  }

  return '$os-$arch';
}

/// Reads package version from pubspec.yaml.
String readPubspecVersion(Directory packageDir) {
  final File pubspecFile = File(p.join(packageDir.path, 'pubspec.yaml'));
  if (!pubspecFile.existsSync()) {
    throw StateError('pubspec.yaml not found at ${pubspecFile.path}');
  }
  for (final String line in pubspecFile.readAsLinesSync()) {
    final trimmed = line.trim();
    if (trimmed.startsWith('version:')) {
      return trimmed.substring('version:'.length).trim();
    }
  }
  throw StateError('version field not found in ${pubspecFile.path}');
}

/// Gets the current git commit SHA, or empty string if not in git.
String getGitCommitSha(Directory packageDir) {
  try {
    final ProcessResult result = Process.runSync('git', [
      'rev-parse',
      'HEAD',
    ], workingDirectory: packageDir.path);
    if (result.exitCode == 0) {
      return result.stdout.toString().trim();
    }
  } on Object {
    // Git might not be available.
  }
  return '';
}

/// Builds the argument parser for the compile tool.
ArgParser buildCompileArgParser() {
  return ArgParser()
    ..addOption(
      'target',
      abbr: 't',
      help: 'Target platform identifier (e.g. linux-x64, darwin-arm64).',
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
  final File scriptFile = File(Platform.script.toFilePath());
  final Directory packageDir = scriptFile.parent.parent;
  final String entrypoint = p.join(packageDir.path, 'bin', 'a2ui.dart');

  final String target = (parsed['target'] as String?) ?? detectTarget();
  final String version =
      (parsed['version'] as String?) ?? readPubspecVersion(packageDir);
  final String commitSha = getGitCommitSha(packageDir);

  final bool isWindows = target.startsWith('windows');
  final String ext = isWindows ? '.exe' : '';
  final String rawOutput =
      (parsed['output'] as String?) ??
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
  stdout.writeln('  Commit:     $commitSha');
  stdout.writeln('  Output:     $outputPath');

  final List<String> compileArgs = [
    'compile',
    'exe',
    entrypoint,
    '-DCLI_VERSION=$version',
    if (commitSha.isNotEmpty) '-DCLI_GIT_COMMIT=$commitSha',
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
