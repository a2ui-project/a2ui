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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';

import 'suggestion.dart';
import 'triage_suggestion.dart';

/// The text that every triage bot comment starts with.
const String triageBotPrefix = '**From triage bot:**';

/// Whether [body] starts the way a triage bot comment does.
///
/// A comment is a triage bot comment only if a team member or a bot posted
/// it as well, which the caller checks.
bool hasTriageBotPrefix(String body) =>
    body.trimLeft().startsWith(triageBotPrefix);

/// Whether [body] has an `<a2ui>` block, as a suggestion comment does.
bool hasA2uiBlock(String body) => _parser.hasFormatContent(body);

final ExpressParser _parser = ExpressParser([triageCatalog]);

final PayloadValidator<ComponentApi, FunctionApi> _validator =
    PayloadValidator<ComponentApi, FunctionApi>(
      catalog: triageCatalog,
      protocolVersion: A2uiProtocolVersion.v1_0,
    );

/// The suggestion in a suggestion comment, as A2UI messages and as values.
///
/// See `blueprints/features/triage_item.blueprint.md`.
final class SuggestionPayload {
  SuggestionPayload._(this.messages, this.suggestion);

  /// Reads the `TriageSuggestion` component from the `<a2ui>` block of a
  /// suggestion comment's [body].
  ///
  /// Throws a [FormatException] that says what is wrong if [body] has no
  /// block, or the block is not one valid `TriageSuggestion` component.
  factory SuggestionPayload.parse(String body) {
    final List<RawA2uiPart> blocks = _parser
        .unwrap(body)
        .whereType<RawA2uiPart>()
        .toList();
    if (blocks.isEmpty) {
      throw const FormatException('The comment has no <a2ui> block.');
    }
    if (blocks.length > 1 || !blocks.single.isFinal) {
      throw const FormatException(
        'The comment must have exactly one closed <a2ui> block.',
      );
    }

    final List<AgentToRendererMessage> messages;
    try {
      messages = _parser.compile(blocks.single.a2uiRaw);
    } on A2uiError catch (e) {
      throw FormatException('The <a2ui> block does not compile: ${e.message}');
    }

    final List<Map<String, Object?>> components = [
      for (final AgentToRendererMessage message in messages)
        ...switch (message) {
          CreateSurfaceMessage(:final components?) => components,
          UpdateComponentsMessage(:final components) => components,
          _ => const <Map<String, Object?>>[],
        },
    ];
    if (components.length != 1 ||
        components.single['component'] != TriageSuggestionProps.componentName) {
      throw const FormatException(
        'The <a2ui> block must hold exactly one TriageSuggestion component.',
      );
    }
    try {
      _validator.validateComponent(components.single);
    } on A2uiError catch (e) {
      throw FormatException('The TriageSuggestion is not valid: ${e.message}');
    }

    final Map<String, Object?> properties = {...components.single}
      ..remove('id');
    return SuggestionPayload._(
      List.unmodifiable(messages),
      TriageSuggestion.fromProperties(properties),
    );
  }

  /// The messages that create a surface with the component as its root.
  final List<AgentToRendererMessage> messages;

  /// The values of the component.
  final TriageSuggestion suggestion;
}
