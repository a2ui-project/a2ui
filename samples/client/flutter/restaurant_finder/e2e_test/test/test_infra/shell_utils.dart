// Copyright 2024 Google LLC
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
import 'dart:convert';
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
  /// is not valid. After each failed attempt, calls [checkService], which
  /// throws if the service can no longer answer, so that error is reported
  /// instead of the failed command.
  Future<void> validate({void Function()? checkService}) async {
    final DateTime deadline = DateTime.now().add(timeout);
    while (true) {
      try {
        final String response = runCommandSync(command);
        responseChecker(response);
        return;
      } catch (e) {
        checkService?.call();
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

/// How many of the service's last output lines a startup error quotes.
const _recentOutputLines = 50;

/// Starts [command] in [workingDirectory] and waits until [probes] pass.
///
/// The service's output is forwarded to stdout for as long as it runs. If the
/// service exits before the probes pass, throws with its exit code and last
/// output lines.
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

  int? exitCode;
  unawaited(process.exitCode.then((code) => exitCode = code));

  final serviceStabilizedOutput = Completer<void>();
  final recentOutput = <String>[];
  Timer? timer;

  void onQuiet() {
    timer?.cancel();
    if (!serviceStabilizedOutput.isCompleted) {
      serviceStabilizedOutput.complete();
    }
  }

  void restartTimer() {
    timer?.cancel();
    if (!serviceStabilizedOutput.isCompleted) {
      timer = Timer(quietPeriod, onQuiet);
    }
  }

  void onOutput(String chunk) {
    stdout.write(chunk);
    recentOutput.addAll(const LineSplitter().convert(chunk));
    if (recentOutput.length > _recentOutputLines) {
      recentOutput.removeRange(0, recentOutput.length - _recentOutputLines);
    }
    restartTimer();
  }

  process.stdout
      .transform(const SystemEncoding().decoder)
      .listen(onOutput, onDone: onQuiet);
  process.stderr
      .transform(const SystemEncoding().decoder)
      .listen(onOutput, onDone: onQuiet);

  print('Started timer.');
  restartTimer();
  await serviceStabilizedOutput.future;

  void checkService() {
    final code = exitCode;
    if (code == null) return;
    throw Exception(
      'Service `$command` exited with code $code before it was ready. '
      'Its last output:\n${recentOutput.join('\n')}',
    );
  }

  for (final probe in probes) {
    await probe.validate(checkService: checkService);
  }
  return process;
}
