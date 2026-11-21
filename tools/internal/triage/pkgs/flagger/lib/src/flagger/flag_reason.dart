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

import 'package:shared/shared.dart';

import 'github.dart';
import 'history.dart';
import 'item.dart';
import 'rules.dart';

/// An issue or a pull request: its repository, such as
/// `a2ui-project/a2ui`, and its number there.
typedef ItemRef = ({String repository, int number});

/// The flag reason of one item, as `bin/flag_reason.dart` prints it.
typedef ItemReason = ({String url, String? reason});

final RegExp _numberArg = RegExp(r'^#?(\d+)$');

final RegExp _urlArg = RegExp(
  r'^https://github\.com/([^/]+/[^/]+)/(?:issues|pull)/(\d+)/?$',
);

/// Reads an item argument: a number in [a2uiRepository], with or without
/// `#`, or the URL of an issue or a pull request.
///
/// Throws a [FormatException] for anything else.
ItemRef parseItem(String arg) {
  if (_numberArg.firstMatch(arg) case final RegExpMatch match) {
    return (repository: a2uiRepository, number: int.parse(match[1]!));
  }
  if (_urlArg.firstMatch(arg) case final RegExpMatch match) {
    return (repository: match[1]!, number: int.parse(match[2]!));
  }
  throw FormatException('Not an issue or PR number or URL: $arg');
}

/// [reason], as [flagReason] returns it, as a sentence.
String toSentence(String reason) =>
    reason.isEmpty ? reason : reason[0].toUpperCase() + reason.substring(1);

/// Why the flagger flags the item with [number] in [github]'s repository,
/// with the same rules and data as the flagger's runs. The reason is null if
/// the flagger does not flag it.
///
/// Messages from reading the item go to [log] and [errorLog].
Future<ItemReason> itemReason(
  FlaggerGitHub github,
  int number,
  DateTime now, {
  required StringSink log,
  required StringSink errorLog,
}) async {
  final Item item = await github.item(number);
  final ItemHistory history = await fetchHistory(
    github,
    item,
    log: log,
    errorLog: errorLog,
  );
  final String? reason = decide(item, history, now).reason;
  return (
    url:
        item.htmlUrl ??
        'https://github.com/${github.repository}/issues/$number',
    reason: reason == null ? null : toSentence(reason),
  );
}
