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
import 'parser.dart';
import 'prompt_generator.dart';

/// The direct JSON format: A2UI messages written as JSON inside `<a2ui-json>`
/// tags, which can be read while the response streams.
///
/// The SDK calls [createFormat] with the catalogs of each request, so the
/// options of the format are given here and passed on to every format created.
class DirectJsonFormatFactory extends InferenceFormatFactory {
  /// See [DirectJsonFormat] for [allowedMessages] and [progressiveKeys].
  const DirectJsonFormatFactory({
    this.allowedMessages,
    this.progressiveKeys = const {},
  });

  /// The message types the model may write, such as `createSurface`, or null
  /// for all of them.
  final List<String>? allowedMessages;

  /// The string properties each parser shows while their value streams.
  final Set<String> progressiveKeys;

  @override
  InferenceFormat createFormat(
    List<SchemaCatalog> catalogs, {
    List<List<AgentToRendererMessage>> examples = const [],
  }) => DirectJsonFormat(
    catalogs,
    examples: examples,
    allowedMessages: allowedMessages,
    progressiveKeys: progressiveKeys,
  );
}

/// The direct JSON format bound to the catalogs of one request.
class DirectJsonFormat extends InferenceFormat {
  /// [allowedMessages] names the message types the model may write, such as
  /// `createSurface`; null allows all of them.
  ///
  /// [progressiveKeys] names the string properties whose value a parser shows
  /// before it is complete, such as the text of a `Text` component. Which
  /// properties hold prose depends on the catalog, so there is no built-in
  /// set. Empty turns healing off.
  DirectJsonFormat(
    List<SchemaCatalog> catalogs, {
    List<List<AgentToRendererMessage>> examples = const [],
    List<String>? allowedMessages,
    Set<String> progressiveKeys = const {},
  }) : promptGenerator = DirectJsonPromptGenerator(
         List.unmodifiable(catalogs),
         examples: List.unmodifiable(examples),
         allowedMessages: allowedMessages,
       ),
       _progressiveKeys = Set.unmodifiable(progressiveKeys);

  final Set<String> _progressiveKeys;

  @override
  final DirectJsonPromptGenerator promptGenerator;

  @override
  DirectJsonParser createParser() => DirectJsonParser(
    promptGenerator.catalogs,
    progressiveKeys: _progressiveKeys,
  );
}
