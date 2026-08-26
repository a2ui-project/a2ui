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

/// The standard A2UI JSON payload format, enclosed in `<a2ui-json>` tags.
class DirectJsonFormat<C extends ComponentApi, F extends FunctionApi>
    extends InferenceFormat<C, F> {
  /// The active catalogs bound to this format.
  final List<Catalog<C, F>> catalogs;

  /// The payload envelope names the model may emit.
  final List<String>? allowedMessages;

  @override
  final DirectJsonPromptGenerator<C, F> promptGenerator;

  DirectJsonFormat(
    this.catalogs, {
    Map<String, List<A2uiMessage>>? examples,
    this.allowedMessages,
  }) : promptGenerator = DirectJsonPromptGenerator<C, F>(
         catalogs,
         examples: examples,
         allowedMessages: allowedMessages,
       );

  @override
  Parser createParser() => DirectJsonParser<C, F>(catalogs: catalogs);
}

/// Builds [DirectJsonFormat] strategies bound to a set of active catalogs.
class DirectJsonFormatFactory<C extends ComponentApi, F extends FunctionApi>
    extends InferenceFormatFactory<C, F> {
  /// The payload envelope names the model may emit.
  final List<String>? allowedMessages;

  const DirectJsonFormatFactory({this.allowedMessages});

  @override
  DirectJsonFormat<C, F> createFormat(
    List<Catalog<C, F>> catalogs, {
    Map<String, List<A2uiMessage>>? examples,
  }) => DirectJsonFormat<C, F>(
    catalogs,
    examples: examples,
    allowedMessages: allowedMessages,
  );
}
