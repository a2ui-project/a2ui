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

import '../../inference_format.dart';
import '../../parser/parser.dart';
import 'parser.dart';
import 'prompt_generator.dart';

/// The compact Express DSL format, enclosed in `<a2ui-express>` tags.
class ExpressFormat<C extends ComponentApi, F extends FunctionApi>
    extends InferenceFormat<C, F> {
  /// The active catalogs bound to this format.
  final List<Catalog<C, F>> catalogs;

  @override
  final ExpressPromptGenerator<C, F> promptGenerator;

  ExpressFormat(this.catalogs, {Map<String, List<A2uiMessage>>? examples})
    : promptGenerator = ExpressPromptGenerator<C, F>(
        catalogs,
        examples: examples,
      );

  @override
  Parser createParser() => ExpressParser<C, F>(catalogs: catalogs);
}

/// Builds [ExpressFormat] strategies bound to a set of active catalogs.
class ExpressFormatFactory<C extends ComponentApi, F extends FunctionApi>
    extends InferenceFormatFactory<C, F> {
  const ExpressFormatFactory();

  @override
  ExpressFormat<C, F> createFormat(
    List<Catalog<C, F>> catalogs, {
    Map<String, List<A2uiMessage>>? examples,
  }) => ExpressFormat<C, F>(catalogs, examples: examples);
}
