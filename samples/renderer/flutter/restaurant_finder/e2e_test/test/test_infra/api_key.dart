// Copyright 2025 Google LLC
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

import 'dart:io';

const geminiApiKeyName = 'GEMINI_API_KEY';

/// API key for Google Generative AI (only needed if using google backend).
/// Get an API key from https://aistudio.google.com/app/apikey
/// Specify this when running the app with "-D GEMINI_API_KEY=$GEMINI_API_KEY"
const String geminiApiKey = String.fromEnvironment(geminiApiKeyName);

String apiKeyForEval() {
  String apiKey = geminiApiKey;
  if (apiKey.isEmpty) {
    apiKey = Platform.environment[geminiApiKeyName] ?? '';
  }

  if (apiKey.isEmpty) {
    throw Exception('$geminiApiKeyName is not configured.');
  }
  return apiKey;
}
