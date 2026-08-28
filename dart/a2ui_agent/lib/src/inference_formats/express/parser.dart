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
import 'compiler.dart';
import 'decompiler.dart';

/// Parses Express DSL payloads enclosed in `<a2ui-express>` sentinel tags.
class ExpressParser<C extends ComponentApi, F extends FunctionApi>
    extends Parser {
  /// The active catalogs compiled payloads are validated against.
  final List<Catalog<C, F>> catalogs;

  /// The compiler backing [compile].
  final ExpressCompiler<C, F> compiler;

  /// The decompiler backing [decompile].
  final ExpressDecompiler<C, F> decompiler;

  ExpressParser({
    required this.catalogs,
    ExpressCompiler<C, F>? compiler,
    ExpressDecompiler<C, F>? decompiler,
  }) : compiler = compiler ?? ExpressCompiler<C, F>(catalogs: catalogs),
       decompiler = decompiler ?? ExpressDecompiler<C, F>(catalogs: catalogs);

  @override
  bool get supportsStreaming => true;

  @override
  String wrap(List<RawResponsePart> blocks) {
    throw UnimplementedError('ExpressParser.wrap');
  }

  @override
  List<RawResponsePart> unwrap(String content) {
    throw UnimplementedError('ExpressParser.unwrap');
  }

  @override
  List<A2uiMessage> compile(String formatContent) {
    throw UnimplementedError('ExpressParser.compile');
  }

  @override
  String decompile(List<A2uiMessage> a2uiPayload) {
    throw UnimplementedError('ExpressParser.decompile');
  }

  @override
  List<ResponsePart> parseChunk(String chunk, {bool wrapped = true}) {
    throw UnimplementedError('ExpressParser.parseChunk');
  }
}
