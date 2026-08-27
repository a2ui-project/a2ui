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

/// Pairs a prompt generator with a parser for one wire format.
abstract class InferenceFormat<C extends ComponentApi, F extends FunctionApi> {
  const InferenceFormat();

  /// The prompt generator for this format.
  PromptGenerator<C, F> get promptGenerator;

  /// Creates a turn-scoped parser bound to this format's catalogs.
  Parser createParser();
}

/// Constructs [InferenceFormat]s bound to a set of active catalogs.
abstract class InferenceFormatFactory<
  C extends ComponentApi,
  F extends FunctionApi
> {
  const InferenceFormatFactory();

  /// Binds a format to [catalogs].
  InferenceFormat<C, F> createFormat(
    List<Catalog<C, F>> catalogs, {
    Map<String, List<A2uiMessage>>? examples,
  });
}
