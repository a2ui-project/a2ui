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

import 'package:flutter/material.dart';

import 'chat_app.dart';
import 'chat_session.dart';
import 'llm_client.dart';

const String _apiKey = String.fromEnvironment('GEMINI_API_KEY');

void main() {
  runApp(
    _apiKey.isEmpty
        ? const MaterialApp(
            home: Scaffold(
              body: Center(
                child: Text(
                  'Run the app with --dart-define=GEMINI_API_KEY=<key>.',
                ),
              ),
            ),
          )
        : ChatApp(
            session: ChatSession(client: GeminiClient(apiKey: _apiKey)),
          ),
  );
}
