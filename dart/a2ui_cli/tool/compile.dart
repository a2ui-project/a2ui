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
    } catch (_) {}
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
  final File pubspecFile = File(
    '${packageDir.path}${Platform.pathSeparator}pubspec.yaml',
  );
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
String getGitCommitSha() {
  try {
    final ProcessResult result = Process.runSync('git', ['rev-parse', 'HEAD']);
    if (result.exitCode == 0) {
      return result.stdout.toString().trim();
    }
  } catch (_) {}
  return '';
}

void printHelp() {
  stdout.writeln(
    'Compiles the A2UI CLI into a standalone native executable.\n\n'
    'Usage: dart tool/compile.dart [options]\n\n'
    'Options:\n'
    '  -t, --target   Target platform identifier (e.g. linux-x64, darwin-arm64).\n'
    '  -v, --version  Version to inject (defaults to version in pubspec.yaml).\n'
    '  -o, --output   Output binary file path.\n'
    '  -h, --help     Show this help message.',
  );
}

void main(List<String> args) {
  String? target;
  String? version;
  String? output;

  for (int i = 0; i < args.length; i++) {
    final arg = args[i];
    if (arg == '-h' || arg == '--help') {
      printHelp();
      exit(0);
    } else if (arg == '-t' || arg == '--target') {
      if (i + 1 < args.length) target = args[++i];
    } else if (arg.startsWith('--target=')) {
      target = arg.substring('--target='.length);
    } else if (arg == '-v' || arg == '--version') {
      if (i + 1 < args.length) version = args[++i];
    } else if (arg.startsWith('--version=')) {
      version = arg.substring('--version='.length);
    } else if (arg == '-o' || arg == '--output') {
      if (i + 1 < args.length) output = args[++i];
    } else if (arg.startsWith('--output=')) {
      output = arg.substring('--output='.length);
    }
  }

  // Find package directory relative to script
  final File scriptFile = File(Platform.script.toFilePath());
  final Directory packageDir = scriptFile.parent.parent;
  final String entrypoint =
      '${packageDir.path}${Platform.pathSeparator}bin${Platform.pathSeparator}a2ui.dart';

  target ??= detectTarget();
  version ??= readPubspecVersion(packageDir);
  final String commitSha = getGitCommitSha();

  final bool isWindows = target.startsWith('windows');
  final String ext = isWindows ? '.exe' : '';
  final String outputPath =
      output ??
      '${packageDir.path}${Platform.pathSeparator}dist${Platform.pathSeparator}a2ui-$target$ext';

  // Ensure output directory exists.
  final File outFile = File(outputPath);
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

  stdout.writeln('Running: dart ${compileArgs.join(' ')}');
  final ProcessResult result = Process.runSync(
    'dart',
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
