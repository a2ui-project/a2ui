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

import 'package:dartantic_ai/dartantic_ai.dart' as dartantic;
import 'package:flutter_test/flutter_test.dart';
import 'package:googleai_dart/googleai_dart.dart' as ga;

import 'api_key.dart';

/// An abstract interface for AI clients.
abstract interface class AiClient {
  /// Sends a message stream request to the AI service.
  ///
  /// [prompt] is the user's message.
  /// [history] is the conversation history.
  Stream<String> sendStream(
    String prompt, {
    required List<dartantic.ChatMessage> history,
  });

  /// Dispose of resources.
  void dispose();
}

/// An implementation of [AiClient] using `package:dartantic_ai`.
class DartanticAiClient implements AiClient {
  DartanticAiClient({String? modelName}) {
    final String apiKey = apiKeyForEval();
    _provider = dartantic.GoogleProvider(apiKey: apiKey);
    _agent = dartantic.Agent.forProvider(
      _provider,
      chatModelName: modelName ?? 'gemini-3.6-flash',
    );
  }

  late final dartantic.GoogleProvider _provider;
  late final dartantic.Agent _agent;

  @override
  Stream<String> sendStream(
    String prompt, {
    required List<dartantic.ChatMessage> history,
  }) async* {
    for (var attempt = 1; ; attempt++) {
      var yielded = false;
      try {
        await for (final dartantic.ChatResult<String> result
            in _agent.sendStream(prompt, history: history)) {
          if (result.output.isEmpty) continue;
          yielded = true;
          yield result.output;
        }
        return;
      } on Exception catch (e) {
        if (yielded) rethrow;
        if (attempt == 3) {
          if (ModelUnavailableException.isUnavailable(e)) {
            throw ModelUnavailableException(e);
          }
          rethrow;
        }
        await Future<void>.delayed(Duration(seconds: 5 * attempt));
      }
    }
  }

  @override
  void dispose() {
    // Dartantic Agent/Provider doesn't strictly require disposal currently,
    // but good to have the hook.
  }
}

/// Thrown when the model stays unavailable through every retry: the API key
/// is out of quota (HTTP 429) or the model is overloaded (HTTP 503).
///
/// This says nothing about the code under test, so [modelTest] skips the test
/// instead of failing it.
class ModelUnavailableException implements Exception {
  ModelUnavailableException(this.cause);

  /// The last error the API returned.
  final Exception cause;

  /// Whether [e] means the model is unavailable, not that the request is
  /// wrong.
  static bool isUnavailable(Exception e) =>
      e is ga.ApiException && (e.statusCode == 429 || e.statusCode == 503);

  @override
  String toString() => 'The model is unavailable: $cause';
}

/// Declares a test that calls the model, as [test] does.
///
/// If the model is unavailable, the test is skipped and a GitHub Actions
/// warning is printed, so the run passes without filing a failure issue, and
/// the warning still shows on the run.
void modelTest(
  String description,
  Future<void> Function() body, {
  Timeout? timeout,
}) {
  test(description, () async {
    try {
      await body();
    } on ModelUnavailableException catch (e) {
      print('::warning title=Model unavailable::Skipped "$description": $e');
      markTestSkipped('$e');
    }
  }, timeout: timeout);
}
