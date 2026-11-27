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

/// The arguments of `bin/staleness_ping.dart`.
typedef PingArgs = ({bool dryRun, String? messagesPath});

/// How to run `bin/staleness_ping.dart`.
const String pingUsage =
    'Usage: dart run tools/internal/triage/pkgs/pinger/bin/staleness_ping.dart '
    '[--dry-run] [--messages <file>]';

/// Reads the arguments of `bin/staleness_ping.dart` from [args].
///
/// The file after `--messages` must not be empty or start with `-`, so that
/// `--messages --dry-run`, with the file missing, fails instead of running
/// without `--dry-run`.
///
/// Throws a [FormatException] that says what is wrong.
PingArgs parsePingArgs(List<String> args) {
  var dryRun = false;
  String? messagesPath;
  for (var i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        dryRun = true;
      case '--messages':
        final String? path = i + 1 < args.length ? args[++i] : null;
        if (path == null || path.isEmpty || path.startsWith('-')) {
          throw FormatException(
            path == null
                ? "'--messages' needs a file."
                : "'--messages' needs a file, not '$path'.",
          );
        }
        messagesPath = path;
      case final String arg:
        throw FormatException("Unknown argument '$arg'.");
    }
  }
  return (dryRun: dryRun, messagesPath: messagesPath);
}
