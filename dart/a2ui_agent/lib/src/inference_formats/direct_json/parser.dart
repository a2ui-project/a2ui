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
import 'constants.dart';
import 'streaming.dart';

/// Parses A2UI JSON payload envelopes enclosed in `<a2ui-json>` sentinel tags.
///
/// One instance per turn: [parseChunk] state must not be shared.
class DirectJsonParser<C extends ComponentApi, F extends FunctionApi>
    extends Parser {
  /// The active catalogs compiled payloads are validated against.
  final List<Catalog<C, F>> catalogs;

  /// An override for [progressiveKeys].
  final Set<String>? customProgressiveKeys;

  /// The validator applied to compiled payloads.
  final A2uiValidator<C, F> validator;

  DirectJsonParser({
    required this.catalogs,
    this.customProgressiveKeys,
    A2uiValidator<C, F>? validator,
  }) : validator = validator ?? A2uiValidator<C, F>(catalogs: catalogs);

  /// The keys safe to auto-close when a stream cuts them mid-token.
  Set<String> get progressiveKeys =>
      customProgressiveKeys ?? defaultProgressiveKeys;

  @override
  bool get supportsStreaming => true;

  /// The stream processor backing [parseChunk] for this turn.
  late final DirectJsonStreamProcessor<C, F> streamProcessor =
      DirectJsonStreamProcessor<C, F>(
        catalogs: catalogs,
        progressiveKeys: progressiveKeys,
        validator: validator,
      );

  @override
  String wrap(List<RawResponsePart> blocks) {
    throw UnimplementedError('DirectJsonParser.wrap');
  }

  @override
  List<RawResponsePart> unwrap(String content) {
    throw UnimplementedError('DirectJsonParser.unwrap');
  }

  @override
  List<A2uiMessage> compile(String formatContent) {
    throw UnimplementedError('DirectJsonParser.compile');
  }

  @override
  String decompile(List<A2uiMessage> a2uiPayload) {
    throw UnimplementedError('DirectJsonParser.decompile');
  }

  @override
  List<ResponsePart> parseChunk(String chunk, {bool wrapped = true}) {
    throw UnimplementedError('DirectJsonParser.parseChunk');
  }
}
