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

import 'package:dartantic_ai/dartantic_ai.dart' as dartantic;
import 'package:googleai_dart/googleai_dart.dart' as ga;
import 'package:test/test.dart';

import 'api_key.dart';

/// Sends one-turn requests to a Gemini model through `package:dartantic_ai`.
class AiClient {
  AiClient({String modelName = 'gemini-3.6-flash'})
    : _agent = dartantic.Agent.forProvider(
        dartantic.GoogleProvider(apiKey: apiKeyForEval()),
        chatModelName: modelName,
      );

  final dartantic.Agent _agent;

  /// Sends [userMessage] under [systemPrompt] and returns the complete
  /// response.
  ///
  /// Retries a failed request twice, since the API sometimes rejects one
  /// under load (HTTP 503), and rethrows the last failure, as a
  /// [ModelUnavailableException] if the model was unavailable.
  Future<String> send(String systemPrompt, String userMessage) async {
    for (var attempt = 1; ; attempt++) {
      try {
        final dartantic.ChatResult<String> result = await _agent.send(
          userMessage,
          history: [dartantic.ChatMessage.system(systemPrompt)],
        );
        if (result.finishReason != dartantic.FinishReason.stop) {
          print('The model stopped early: ${result.finishReason}.');
        }
        return result.output;
      } on Exception catch (e) {
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

  /// Sends [userMessage] under [systemPrompt] and yields the response as the
  /// model streams it.
  ///
  /// Retries like [send] while nothing has been yielded; a failure after
  /// that is rethrown, since the caller has already read part of the
  /// response.
  Stream<String> sendStream(String systemPrompt, String userMessage) async* {
    for (var attempt = 1; ; attempt++) {
      var yielded = false;
      try {
        await for (final dartantic.ChatResult<String> result
            in _agent.sendStream(
              userMessage,
              history: [dartantic.ChatMessage.system(systemPrompt)],
            )) {
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
