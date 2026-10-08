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

import 'dart:async';

import 'package:a2ui_flutter_example/chat_session.dart';
import 'package:a2ui_flutter_example/llm_client.dart';

/// Replies to each request with the next of [replies], chunk by chunk, and
/// keeps the requests.
class FakeClient implements LlmClient {
  FakeClient(this.replies, {this.failures = const {}});

  /// The chunks of each reply, in order.
  final List<List<String>> replies;

  /// The error that the reply to the request at each index ends with.
  final Map<int, Object> failures;

  /// The system prompt of each request, in order.
  final List<String> systemPrompts = [];

  /// The turns of each request, in order.
  final List<List<ChatTurn>> requests = [];

  @override
  Stream<String> generate(String systemPrompt, List<ChatTurn> turns) async* {
    systemPrompts.add(systemPrompt);
    requests.add(turns);
    final int index = requests.length - 1;
    yield* Stream.fromIterable(replies[index]);
    if (failures[index] case final Object error) {
      Error.throwWithStackTrace(error, StackTrace.current);
    }
  }
}

/// Replies to each request with what the test adds to [reply].
class ControlledClient implements LlmClient {
  /// The turns of each request, in order.
  final List<List<ChatTurn>> requests = [];

  /// The reply to the latest request.
  late StreamController<String> reply;

  /// Whether the reader of a reply cancelled it.
  bool cancelled = false;

  @override
  Stream<String> generate(String systemPrompt, List<ChatTurn> turns) {
    requests.add(turns);
    reply = StreamController(onCancel: () => cancelled = true);
    return reply.stream;
  }
}

/// The text of [session]'s error entries.
List<String> errorsOf(ChatSession session) => [
  for (final ChatEntry entry in session.entries)
    if (entry.kind == ChatEntryKind.error) entry.text,
];
