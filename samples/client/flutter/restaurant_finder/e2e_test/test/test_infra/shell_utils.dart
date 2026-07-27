// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// ignore_for_file: avoid_print

import 'dart:async';
import 'dart:io';

/// A function that checks the response of the service.
///
/// Throws error if the response is not valid.
typedef ResponseChecker = void Function(String response);

class ShellProbe {
  final String command;
  final ResponseChecker responseChecker;
  final Duration timeout;

  ShellProbe({
    required this.command,
    required this.responseChecker,
    this.timeout = const Duration(seconds: 10),
  });

  /// Validates the response of the service, retrying until [timeout] elapses.
  ///
  /// Runs [command], checks the response and throws error if the response
  /// is not valid.
  Future<void> validate() async {
    final DateTime deadline = DateTime.now().add(timeout);
    while (true) {
      try {
        final String response = runCommandSync(command);
        responseChecker(response);
        return;
      } catch (e) {
        if (DateTime.now().isAfter(deadline)) rethrow;
        await Future<void>.delayed(const Duration(seconds: 1));
      }
    }
  }
}

/// Kills any processes currently listening on [port].
///
/// Safe to call when no process is on the port — exits silently.
void killProcessesOnPort(int port) {
  Process.runSync('bash', [
    '-c',
    'lsof -ti tcp:$port | xargs kill -9 2>/dev/null || true',
  ]);
}

String runCommandSync(String command) {
  final ProcessResult result = Process.runSync('bash', ['-c', command]);
  if (result.exitCode != 0) {
    throw Exception(
      'Command failed with exit code ${result.exitCode}: '
      '$command\n${result.stderr}',
    );
  }
  return result.stdout as String;
}

Future<Process> startAndVerifyService(
  String command,
  String workingDirectory,
  List<ShellProbe> probes, {
  Duration quietPeriod = const Duration(seconds: 2),
}) async {
  print('Starting service: `$command` in $workingDirectory');
  print('Current directory: ${Directory.current}');
  final Process process = await Process.start('bash', [
    '-c',
    command,
  ], workingDirectory: workingDirectory);

  final serviceStabilizedOutput = Completer<void>();
  Timer? timer;
  StreamSubscription<String>? stdoutSub;
  StreamSubscription<String>? stderrSub;

  void onTimer() {
    serviceStabilizedOutput.complete();
    stdoutSub?.cancel();
    stderrSub?.cancel();
    timer?.cancel();
  }

  void restartTimer(String chunk) {
    stdout.write(chunk);
    timer?.cancel();
    if (!serviceStabilizedOutput.isCompleted) {
      timer = Timer(quietPeriod, onTimer);
    }
  }

  stdoutSub = process.stdout
      .transform(const SystemEncoding().decoder)
      .listen(restartTimer, onDone: onTimer);

  stderrSub = process.stderr
      .transform(const SystemEncoding().decoder)
      .listen(restartTimer, onDone: onTimer);

  restartTimer('Started timer.\n');
  await serviceStabilizedOutput.future;

  for (final probe in probes) {
    await probe.validate();
  }
  return process;
}
