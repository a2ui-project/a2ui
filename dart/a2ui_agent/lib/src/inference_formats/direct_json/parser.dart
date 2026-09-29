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

import '../../parser/parser.dart';
import '../../parser/response_part.dart';

/// Reads A2UI messages written as JSON inside `<a2ui-json>` tags, from a
/// complete response or as it streams.
class DirectJsonParser extends Parser {
  DirectJsonParser(List<SchemaCatalog> catalogs, {this.customProgressiveKeys})
    : catalogs = List.unmodifiable(catalogs);

  /// The catalogs payloads are validated against.
  final List<SchemaCatalog> catalogs;

  /// Replaces the default [progressiveKeys] when not null.
  final Set<String>? customProgressiveKeys;

  /// The string properties whose value a streamed payload may show before
  /// the value is complete, such as the text of a `Text` component.
  Set<String> get progressiveKeys =>
      customProgressiveKeys ??
      (throw UnimplementedError('DirectJsonParser.progressiveKeys'));

  /// Direct JSON can be read before a block closes, by healing the unfinished
  /// JSON.
  @override
  bool get supportsStreaming => true;

  @override
  bool hasFormatContent(String content, {bool complete = false}) =>
      throw UnimplementedError('DirectJsonParser.hasFormatContent');

  @override
  String wrap(List<RawResponsePart> parts) =>
      throw UnimplementedError('DirectJsonParser.wrap');

  @override
  List<RawResponsePart> unwrap(String content) =>
      throw UnimplementedError('DirectJsonParser.unwrap');

  /// Throws [A2uiValidationError] if a message declares a version other than
  /// v0.9, or none.
  @override
  List<AgentToRendererMessage> compile(String formatContent) =>
      throw UnimplementedError('DirectJsonParser.compile');

  @override
  String decompile(List<AgentToRendererMessage> a2uiPayload) =>
      throw UnimplementedError('DirectJsonParser.decompile');

  /// Values of [progressiveKeys] are shown while they grow; any other
  /// unfinished value is held back until it is complete.
  @override
  List<ResponsePart> parseChunk(String chunk, {bool wrapped = true}) =>
      throw UnimplementedError('DirectJsonParser.parseChunk');
}
