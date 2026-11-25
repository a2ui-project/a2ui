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
import 'dart:io';

/// A direct message that asks an assignee of a stale item to act.
///
/// The pinger does not send it: it writes it to an [Outbox], and the triage
/// bot sends it from the triager's Google account. See
/// `blueprints/features/triage_bot/staleness_ping.blueprint.md`.
typedef DirectMessage = ({
  /// The assignee's GitHub login.
  String login,

  /// The assignee's Google account, such as `someone@google.com`.
  String to,

  /// The message, in the Google Chat format.
  String text,
});

/// Where the pinger puts the direct messages for the triage bot to send.
abstract interface class Outbox {
  /// Adds [message] to the messages to send.
  Future<void> add(DirectMessage message);
}

/// An [Outbox] that writes each message to a file as a line of JSON, with
/// the keys `login`, `to` and `text`.
final class JsonLinesOutbox implements Outbox {
  /// Writes to the file, which it empties first.
  JsonLinesOutbox(this._file) {
    _file.writeAsStringSync('');
  }

  final File _file;

  @override
  Future<void> add(DirectMessage message) {
    final String line = jsonEncode({
      'login': message.login,
      'to': message.to,
      'text': message.text,
    });
    return _file.writeAsString('$line\n', mode: FileMode.append, flush: true);
  }
}

/// Reads the map from GitHub logins to Google accounts, as JSON, such as
/// `{"octocat": "octocat@google.com"}`. An empty or missing [json] is an
/// empty map.
///
/// Throws a [FormatException] if [json] is not a JSON object of strings.
Map<String, String> parseChatUsers(String? json) {
  if (json == null || json.trim().isEmpty) return const {};
  final Object? decoded = jsonDecode(json);
  if (decoded is! Map<String, Object?> ||
      decoded.values.any((Object? account) => account is! String)) {
    throw const FormatException(
      'Expected a JSON object that maps GitHub logins to Google accounts.',
    );
  }
  return decoded.cast<String, String>();
}
