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

import '../../parser/response_part.dart';

/// Incrementally decodes a streamed DIRECT_JSON response.
///
/// Buffers partial tokens, heals [progressiveKeys] strings, and yields
/// messages only once complete and reachable from a surface root.
class DirectJsonStreamProcessor<C extends ComponentApi, F extends FunctionApi> {
  /// The active catalogs yielded payloads are validated against.
  final List<Catalog<C, F>> catalogs;

  /// String keys whose values may be auto-closed when cut mid-token.
  final Set<String> progressiveKeys;

  /// The validator applied to yielded payloads.
  final A2uiValidator<C, F> validator;

  DirectJsonStreamProcessor({
    required this.catalogs,
    required this.progressiveKeys,
    A2uiValidator<C, F>? validator,
  }) : validator = validator ?? A2uiValidator<C, F>(catalogs: catalogs);

  /// Feeds the next chunk of the stream and returns the parts it completed.
  List<ResponsePart> process(String chunk, {bool wrapped = true}) {
    throw UnimplementedError('DirectJsonStreamProcessor.process');
  }

  /// Flushes buffered content at the end of a stream.
  ///
  /// Throws [A2uiParseError] if a payload block is still unterminated.
  List<ResponsePart> finish() {
    throw UnimplementedError('DirectJsonStreamProcessor.finish');
  }

  /// Discards buffered state for a new turn.
  void reset() {
    throw UnimplementedError('DirectJsonStreamProcessor.reset');
  }
}
