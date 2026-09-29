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

import 'package:a2ui_core/a2ui_core.dart';

import 'parser/parser.dart';
import 'prompt/generator.dart';

/// Selects the notation the LLM writes A2UI payloads in.
abstract class InferenceFormatFactory {
  const InferenceFormatFactory();

  /// Creates the format for [catalogs], the catalogs active for one request.
  InferenceFormat createFormat(List<SchemaCatalog> catalogs);
}

/// One inference format bound to the catalogs of one request: the prompt that
/// teaches the LLM the format, and the parser that reads what the LLM wrote.
abstract class InferenceFormat {
  const InferenceFormat();

  /// Renders the prompt snippet describing the format and the catalogs.
  PromptGenerator get promptGenerator;

  /// Creates a parser for one LLM response.
  Parser createParser();
}
