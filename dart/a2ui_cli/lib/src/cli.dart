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

import 'dart:io' as io;

import 'package:args/args.dart';
import 'package:args/command_runner.dart';

import 'commands/codegen_command.dart';

const String packageVersion = '0.0.1-wip001';

class A2uiCommandRunner extends CommandRunner<int> {
  final StringSink outSink;
  final StringSink errSink;

  A2uiCommandRunner({StringSink? outSink, StringSink? errSink})
    : outSink = outSink ?? io.stdout,
      errSink = errSink ?? io.stderr,
      super(
        'a2ui',
        'A2UI CLI developer tool and typesafe component generator',
      ) {
    argParser.addFlag(
      'version',
      abbr: 'v',
      negatable: false,
      help: 'Output the current version.',
    );
    addCommand(CodegenCommand(outSink: this.outSink, errSink: this.errSink));
  }

  @override
  void printUsage() {
    outSink.writeln(usage);
  }

  @override
  Future<int?> runCommand(ArgResults topLevelResults) async {
    if (topLevelResults['version'] == true) {
      outSink.writeln(packageVersion);
      return 0;
    }
    return super.runCommand(topLevelResults);
  }
}

Future<int> runCli(
  List<String> args, {
  StringSink? stdout,
  StringSink? stderr,
}) async {
  final StringSink out = stdout ?? io.stdout;
  final StringSink err = stderr ?? io.stderr;
  final runner = A2uiCommandRunner(outSink: out, errSink: err);

  if (args.isEmpty) {
    runner.printUsage();
    return 0;
  }

  try {
    final int? result = await runner.run(args);
    return result ?? 0;
  } on UsageException catch (e) {
    final RegExpMatch? unknownOpt = RegExp(
      r'Could not find an option named "([^"]+)"',
    ).firstMatch(e.message);
    final RegExpMatch? unknownFlag = RegExp(
      r'Could not find an option or flag "([^"]+)"',
    ).firstMatch(e.message);
    if (unknownOpt != null) {
      final String name = unknownOpt.group(1)!;
      final formatted = name.startsWith('-') ? name : '--$name';
      err.writeln("error: unknown option '$formatted'");
    } else if (unknownFlag != null) {
      final String name = unknownFlag.group(1)!;
      final formatted = name.startsWith('-') ? name : '-$name';
      err.writeln("error: unknown option '$formatted'");
    } else {
      err.writeln(e.message);
    }
    return 64;
  } catch (e) {
    if (e is ArgumentError) {
      err.writeln('Error: ${e.message}');
      return 64;
    }
    err.writeln('Error: $e');
    return 1;
  }
}
