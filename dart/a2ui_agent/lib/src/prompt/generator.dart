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

/// Renders the system prompt snippet teaching an LLM one inference format.
///
/// Obtained from `InferenceFormat.promptGenerator`, bound to the catalogs of
/// one request.
abstract class PromptGenerator {
  const PromptGenerator(this.catalogs, {this.examples = const []});

  /// The catalogs whose components and functions the snippet describes.
  final List<SchemaCatalog> catalogs;

  /// Example turns the snippet shows the model, in order. Each is the list of
  /// messages making up one turn.
  ///
  /// An example carries no label: what the model learns from it is the
  /// payload.
  final List<List<AgentToRendererMessage>> examples;

  /// Renders the snippet, which describes the format, the components and
  /// functions of [catalogs], and [examples].
  ///
  /// The agent adds its own role and workflow instructions around it.
  String generate();
}
