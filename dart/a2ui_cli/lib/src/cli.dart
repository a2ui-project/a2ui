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
import 'package:args/command_runner.dart';
import 'commands/codegen_command.dart';

class A2uiCommandRunner extends CommandRunner<int> {
  A2uiCommandRunner()
    : super(
        'a2ui',
        'A2UI CLI developer tool and typesafe component generator',
      ) {
    argParser.addFlag(
      'version',
      abbr: 'v',
      negatable: false,
      help: 'Output the current version.',
    );
    addCommand(CodegenCommand());
  }

  @override
  String get usage => '''Usage: a2ui [options] [command]

A2UI CLI developer tool and typesafe component generator

Options:
  -v, --version   Output the current version.
  -h, --help      display help for command

Commands:
  codegen         Generates typesafe A2UI component libraries from catalog schemas.
  help [command]  display help for command''';
}

Future<int> runCli(List<String> args) async {
  final runner = A2uiCommandRunner();

  if (args.isEmpty || args.contains('-h') || args.contains('--help')) {
    if (args.contains('codegen')) {
      stdout.writeln(
        'Usage: a2ui codegen [options]\n\n'
        'Generates typesafe A2UI component libraries from catalog schemas.\n\n'
        'Options:\n'
        '  -c, --catalog <path>       Path to the catalog JSON Schema file.\n'
        '  -o, --out <dir>            Output directory or file where generated code will be written.\n'
        '  --lang <language>          Target language for code generation (default: "python")\n'
        '  --base-import <module>     Base module from which ComponentBuilderNode, etc. are imported.\n'
        '  --catalog-name <name>      Override the inferred catalog module name.\n'
        '  -h, --help                 display help for command',
      );
      return 0;
    }
    stdout.writeln(runner.usage);
    return 0;
  }

  if (args.contains('-v') || args.contains('--version')) {
    stdout.writeln('0.1.0');
    return 0;
  }

  // Check for unknown options before running to format errors consistently
  for (final arg in args) {
    if (arg.startsWith('-') &&
        ![
          '--catalog',
          '-c',
          '--out',
          '-o',
          '--lang',
          '--base-import',
          '--catalog-name',
          '--help',
          '-h',
          '--version',
          '-v',
        ].contains(arg)) {
      stderr.writeln("error: unknown option '$arg'");
      return 1;
    }
  }

  try {
    final result = await runner.run(args);
    return result ?? 0;
  } on UsageException catch (e) {
    stderr.writeln(e.message);
    return 1;
  } catch (e) {
    stderr.writeln('Error: $e');
    return 1;
  }
}
