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

/// Builds the format-specific portion of an agent's system instructions.
///
/// The caller owns the surrounding prompt: role and workflow preambles are
/// prepended and any suffix appended by the agent, not by this generator.
abstract class PromptGenerator<C extends ComponentApi, F extends FunctionApi> {
  /// The active catalogs to describe in the system instructions.
  final List<Catalog<C, F>> catalogs;

  /// Few-shot example turns, keyed by a description of the turn.
  ///
  /// Each value is the A2UI payload the model is expected to produce for that
  /// turn.
  final Map<String, List<A2uiMessage>>? examples;

  PromptGenerator(this.catalogs, {this.examples});

  /// Renders the format-specific system instructions and catalog schemas.
  String generate();
}
