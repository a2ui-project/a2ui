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
/// The agent owns the surrounding preamble and suffix.
abstract class PromptGenerator<C extends ComponentApi, F extends FunctionApi> {
  /// The catalogs to describe.
  final List<Catalog<C, F>> catalogs;

  /// Few-shot turns, keyed by description, valued by the payload the model
  /// is expected to produce.
  final Map<String, List<A2uiMessage>>? examples;

  PromptGenerator(this.catalogs, {this.examples});

  /// Renders the instructions and catalog schemas.
  String generate();
}
