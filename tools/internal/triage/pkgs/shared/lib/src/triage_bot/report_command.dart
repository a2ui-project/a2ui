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

/// The commands of `bin/triage_report.dart`: `report`, `unsubscribe` and
/// `paste`. See `blueprints/features/triage_bot/report.blueprint.md`.
library;

import 'dart:convert';
import 'dart:io';

import '../shared/github_client.dart';
import '../shared/github_token.dart';
import 'report.dart';
import 'report_args.dart';
import 'report_github.dart';
import 'report_render.dart';

/// Where the triage bot posts the report: the URL, and what to do there
/// after `paste`.
///
/// The go links resolve only for Googlers, so the command opens them in the
/// browser and does not read them.
const Map<String, ({String url, String paste})> reportDestinations = {
  'chat': (
    url: 'http://go/a2ui-core-working-group',
    paste: 'Paste the report into the chat space and send it.',
  ),
  'log': (
    url: 'http://go/a2ui-triage-log',
    paste:
        'Click at the start of the line right after the horizontal line under '
        'the header, and paste the report. It ends with its own horizontal '
        'line.',
  ),
};

const String _command =
    'dart run tools/internal/triage/pkgs/shared/bin/triage_report.dart';

/// What the command prints for arguments it does not take.
const String reportUsage =
    'Usage:\n'
    '  $_command report --since <date> [--until <date>] [--login <login>] '
    '--out <dir> [--copy]\n'
    '  $_command unsubscribe <dir>/items.json\n'
    '  $_command paste <dir> --to chat|log';

/// A failure that the command reports with [message] alone.
final class _Failure implements Exception {
  const _Failure(this.message);

  final String message;

  @override
  String toString() => message;
}

Future<GitHubClient> _connect() async =>
    GitHubClient(token: await findGitHubToken());

/// Runs `bin/triage_report.dart` with [args], and returns the exit code: 0
/// on success, 1 on a failure, and 2 for arguments it does not take.
///
/// Writes the output to [out] and the errors to [err], which default to
/// [stdout] and [stderr]. [connect] returns the client for GitHub, and is
/// called only by the commands that need it.
Future<int> runTriageReport(
  List<String> args, {
  StringSink? out,
  StringSink? err,
  Future<GitHubClient> Function() connect = _connect,
}) async {
  final StringSink output = out ?? stdout;
  final StringSink errors = err ?? stderr;
  GitHubClient? github;
  Future<GitHubClient> connectOnce() async => github ??= await connect();
  try {
    return await _run(args, output, errors, connectOnce);
  } catch (error, stack) {
    errors.writeln(switch (error) {
      FormatException(:final String message) => message,
      Exception() => '$error',
      _ => '$error\n$stack',
    });
    return 1;
  } finally {
    github?.close();
  }
}

Future<int> _run(
  List<String> arguments,
  StringSink out,
  StringSink err,
  Future<GitHubClient> Function() connect,
) async {
  final ReportArgs args = parseReportArgs(arguments);
  final String? command = args.positionals.elementAtOrNull(0);
  final String? file = args.positionals.elementAtOrNull(1);
  final bool hasFile = file != null && file.isNotEmpty;
  if (command == 'unsubscribe' && hasFile) {
    return _unsubscribe(file, out, connect);
  }
  if (command == 'paste' &&
      hasFile &&
      reportDestinations.containsKey(args.to)) {
    await _paste(file, args.to!, out);
    return 0;
  }
  final String? since = args.since;
  final String? outDir = args.out;
  if (command != 'report' ||
      since == null ||
      since.isEmpty ||
      outDir == null ||
      outDir.isEmpty) {
    err.writeln(reportUsage);
    return 2;
  }
  final String? until = args.until;
  final period = Period(
    since: parseDate(since, endOfDay: false),
    until: until != null && until.isNotEmpty
        ? parseDate(until, endOfDay: true)
        : DateTime.now(),
  );
  final GitHubClient github = await connect();
  final String login = args.login ?? await viewerLogin(github);
  final Report report = await collectReport(github, login, period);
  await Directory(outDir).create(recursive: true);
  final String textPath = _join(outDir, 'report.txt');
  final String htmlPath = _join(outDir, 'report.html');
  final String text = renderText(report);
  await File(textPath).writeAsString(text);
  await File(htmlPath).writeAsString(renderHtml(report));
  await File(
    _join(outDir, 'report.chat.txt'),
  ).writeAsString(renderChat(report));
  await File(
    _join(outDir, 'report.log.html'),
  ).writeAsString(renderLogHtml(report));
  final List<Map<String, String>> refs = [
    for (final ItemActions item in report.items)
      {'id': item.id, 'url': item.url},
  ];
  await File(
    _join(outDir, 'items.json'),
  ).writeAsString('${const JsonEncoder.withIndent('  ').convert(refs)}\n');
  if (args.copy) await _copy(htmlPath, textPath);
  out.write(text);
  return 0;
}

String _join(String dir, String name) => dir.endsWith(Platform.pathSeparator)
    ? '$dir$name'
    : '$dir${Platform.pathSeparator}$name';

/// Unsubscribes from the items in the `items.json` at [path], and prints the
/// outcome. Returns 1 if it failed for any item.
Future<int> _unsubscribe(
  String path,
  StringSink out,
  Future<GitHubClient> Function() connect,
) async {
  final List<ItemRef> items = [
    for (final Object? item
        in jsonDecode(await File(path).readAsString()) as List<Object?>)
      if (item case {'id': final String id, 'url': final String url})
        (id: id, url: url)
      else
        throw FormatException('Not an item in $path: $item'),
  ];
  final List<String> failures = await unsubscribe(await connect(), items);
  out.writeln(
    'Unsubscribed from ${count(items.length - failures.length, 'item')}.',
  );
  if (failures.isEmpty) return 0;
  out.writeln(
    'Failed for ${count(failures.length, 'item')}:\n${failures.join('\n')}',
  );
  return 1;
}

/// JavaScript for Automation that puts an HTML file and a text file on the
/// clipboard.
const String _copyScript = r'''

ObjC.import('AppKit');
function run(argv) {
  const read = path => $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  const board = $.NSPasteboard.generalPasteboard;
  board.clearContents;
  board.setStringForType(read(argv[0]), $.NSPasteboardTypeHTML);
  board.setStringForType(read(argv[1]), $.NSPasteboardTypeString);
}
''';

/// Runs [executable] with [arguments], and throws if it fails.
Future<void> _exec(String executable, List<String> arguments) async {
  final ProcessResult result = await Process.run(executable, arguments);
  if (result.exitCode != 0) {
    throw _Failure(
      'Command failed: ${[executable, ...arguments].join(' ')}\n'
      '${result.stderr}',
    );
  }
}

/// Puts the report files on the macOS clipboard.
Future<void> _copy(String htmlPath, String textPath) async {
  if (!Platform.isMacOS) {
    throw const _Failure(
      'Copying works only on macOS. Open the HTML file in a browser, and copy '
      'the report from there.',
    );
  }
  await _exec('osascript', [
    '-l',
    'JavaScript',
    '-e',
    _copyScript,
    htmlPath,
    textPath,
  ]);
}

/// Puts the report in [dir] on the clipboard in the form for [to], opens
/// the destination in the browser, and prints what to do there.
Future<void> _paste(String dir, String to, StringSink out) async {
  await _copy(
    _join(dir, to == 'log' ? 'report.log.html' : 'report.html'),
    _join(dir, 'report.txt'),
  );
  final ({String url, String paste}) destination = reportDestinations[to]!;
  await _exec('open', [destination.url]);
  out.writeln(
    'Copied the report and opened ${destination.url}.\n${destination.paste}',
  );
}
