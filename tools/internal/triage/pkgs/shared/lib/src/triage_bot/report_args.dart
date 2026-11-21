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

/// The command-line arguments of `bin/triage_report.dart`.
final class ReportArgs {
  const ReportArgs({
    required this.positionals,
    required this.options,
    required this.copy,
  });

  /// The arguments that are not options, as the command and its file.
  final List<String> positionals;

  /// The values of the options that take one, by name, as `since`.
  final Map<String, String> options;

  /// Whether `--copy` is given.
  final bool copy;

  String? get since => options['since'];
  String? get until => options['until'];
  String? get login => options['login'];
  String? get out => options['out'];
  String? get to => options['to'];
}

/// The options that take a value.
const Set<String> _valueOptions = {'since', 'until', 'login', 'out', 'to'};

/// The options that take no value.
const Set<String> _flags = {'copy'};

/// Reads the command-line arguments, the way Node's `util.parseArgs` reads
/// them in strict mode with positional arguments allowed.
///
/// An option is `--name value` or `--name=value`, and can come before, after
/// or between the positional arguments. When an option is given more than
/// once, the last value counts. The arguments after `--` are positional.
///
/// Throws a [FormatException] for an unknown option, an option without its
/// value, a value for `--copy`, and a separate value that starts with a dash.
ReportArgs parseReportArgs(List<String> args) {
  final positionals = <String>[];
  final options = <String, String>{};
  var copy = false;
  for (var i = 0; i < args.length; i++) {
    final String arg = args[i];
    if (arg == '--') {
      positionals.addAll(args.skip(i + 1));
      break;
    }
    if (arg.length < 2 || !arg.startsWith('-')) {
      positionals.add(arg);
      continue;
    }
    if (!arg.startsWith('--')) {
      // There are no short options, so the first letter is unknown.
      throw FormatException(_unknownOption(arg.substring(0, 2)));
    }
    final int equals = arg.indexOf('=', 3);
    final String rawName = equals == -1 ? arg : arg.substring(0, equals);
    final String name = rawName.substring(2);
    String? value = equals == -1 ? null : arg.substring(equals + 1);
    if (_valueOptions.contains(name)) {
      final inline = value != null;
      if (!inline && i + 1 < args.length) value = args[++i];
      if (value == null) {
        throw FormatException("Option '--$name <value>' argument missing");
      }
      if (!inline && value.length > 1 && value.startsWith('-')) {
        throw FormatException(
          "Option '$rawName' argument is ambiguous.\n"
          "Did you forget to specify the option argument for '$rawName'?\n"
          'To specify an option argument starting with a dash use '
          "'$rawName=-XYZ'.",
        );
      }
      options[name] = value;
    } else if (_flags.contains(name)) {
      if (value != null) {
        throw FormatException("Option '--$name' does not take an argument");
      }
      copy = true;
    } else {
      throw FormatException(_unknownOption(rawName));
    }
  }
  return ReportArgs(positionals: positionals, options: options, copy: copy);
}

String _unknownOption(String rawName) =>
    "Unknown option '$rawName'. To specify a positional argument starting "
    "with a '-', place it at the end of the command after '--', as in "
    "'-- ${jsonEncode(rawName)}";
