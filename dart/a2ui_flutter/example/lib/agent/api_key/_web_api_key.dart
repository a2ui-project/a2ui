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

/// API key for Google Generative AI (only needed if using google backend).
/// Get an API key from https://aistudio.google.com/app/apikey
const String _geminiApiKey = String.fromEnvironment('GEMINI_API_KEY');

String? debugApiKey;

String platformApiKey() {
  if (debugApiKey != null) {
    return debugApiKey!;
  }
  if (_geminiApiKey.isEmpty) {
    throw Exception(
      '''Gemini API key is required when using google backend. Run the app with a GEMINI_API_KEY as a Dart environment variable. You can do this by running with -D GEMINI_API_KEY=\$GEMINI_API_KEY''',
    );
  }
  return _geminiApiKey;
}
