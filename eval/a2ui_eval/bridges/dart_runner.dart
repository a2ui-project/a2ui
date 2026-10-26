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

/// Dart bridge runner for evaluating `package:a2ui_agent`.
///
/// Reads a JSON request from stdin and writes a JSON response to stdout:
/// `{"result": ...}` on success, or `{"error": "..."}` on failure.
///
/// The request fields mirror the Python bridge (`dart_bridge.py`):
/// `action`, `format_name`, `version`, `resolved_catalog_path`,
/// `surface_id`, `completion`, `require_complete_tags` and `validate`.
library;

// ignore_for_file: depend_on_referenced_packages

import 'dart:convert';
import 'dart:io';

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';

/// The protocol versions `package:a2ui_agent` implements.
///
/// The SDK's catalog providers accept only v0.9 and v0.9.1 documents, its
/// direct JSON parser accepts only messages compatible with v0.9, and its
/// Express compiler emits v0.9 messages. A v1.0 run is rejected here rather
/// than silently evaluated as v0.9. Keep this in sync with
/// `SDK_SUPPORTED_VERSIONS["dart"]` in `base.py`.
const Set<A2uiProtocolVersion> _sdkSupportedVersions = {
  A2uiProtocolVersion.v0_9,
  A2uiProtocolVersion.v0_9_1,
};

/// The surface the Dart Express compiler writes to when a block names none.
///
/// `package:a2ui_agent` does not export this constant or let callers choose
/// the default surface, while the Python SDK uses the requested surface id.
/// The runner rewrites this id to the requested one so both SDKs report the
/// same surface (see [_alignExpressEnvelope]). A block that explicitly writes
/// `surface("default_surface")` is rewritten too.
const String _expressDefaultSurfaceId = 'default_surface';

/// An error raised by the runner itself, reported without a type prefix.
class _BridgeError implements Exception {
  _BridgeError(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Maps a requested version such as `1.0`, `v0.9.1` or `0.9` to the SDK enum.
A2uiProtocolVersion _resolveVersion(String requested, String formatName) {
  final String trimmed = requested.trim();
  final String wire = trimmed.startsWith('v') ? trimmed : 'v$trimmed';
  final A2uiProtocolVersion? version = A2uiProtocolVersion.tryParse(wire);
  if (version == null) {
    throw _BridgeError(
      "Unknown A2UI protocol version '$requested'. Known versions: "
      '${A2uiProtocolVersion.values.map((v) => v.semverValue).join(', ')}.',
    );
  }
  if (!_sdkSupportedVersions.contains(version)) {
    throw _BridgeError(
      "The Dart agent SDK (package:a2ui_agent) does not support protocol "
      "${version.jsonValue} for the '$formatName' format. Supported versions: "
      '${_sdkSupportedVersions.map((v) => v.semverValue).join(', ')}.',
    );
  }
  return version;
}

/// Loads the catalog the way the Python bridge does: from its path, with the
/// requested protocol version and no catalog id beyond what it declares.
CatalogApi _loadCatalog(
  String resolvedCatalogPath,
  A2uiProtocolVersion version,
) => CatalogConfig.fromPath(
  resolvedCatalogPath,
  protocolVersion: version,
).transformedCatalog;

InferenceFormat _createStrategy(String formatName, CatalogApi catalog) {
  switch (formatName) {
    case 'direct_json':
      return const DirectJsonFormatFactory().createFormat([catalog]);
    case 'express':
      return const ExpressFormatFactory().createFormat([catalog]);
  }
  throw _BridgeError("Unknown format strategy for Dart SDK: '$formatName'.");
}

/// Serializes [message], dropping a `sendDataModel: false` the model did not
/// write.
///
/// Dart's `CreateSurfaceMessage` always serializes `sendDataModel`, while the
/// Python SDK emits only fields that were set. [raw] is the envelope the model
/// wrote, when known: an explicit `sendDataModel` in it is kept.
Map<String, Object?> _messageJson(
  AgentToRendererMessage message,
  Map<String, Object?>? raw,
) {
  final Map<String, Object?> json = message.toJson();
  if (message is! CreateSurfaceMessage || message.sendDataModel) return json;
  final Object? rawCreate = raw?['createSurface'];
  if (rawCreate is Map && rawCreate.containsKey('sendDataModel')) return json;
  final Object? create = json['createSurface'];
  if (create is! Map) return json;
  return <String, Object?>{
    ...json,
    'createSurface': <String, Object?>{
      for (final MapEntry<String, Object?> e
          in create.cast<String, Object?>().entries)
        if (e.key != 'sendDataModel') e.key: e.value,
    },
  };
}

/// The envelopes of a direct JSON block, if it decodes to a list of
/// [expectedCount] objects; otherwise null.
List<Map<String, Object?>?>? _rawEnvelopes(String raw, int expectedCount) {
  final Object? decoded;
  try {
    decoded = jsonDecode(raw.trim());
  } on FormatException {
    return null;
  }
  if (decoded is! List || decoded.length != expectedCount) return null;
  return [
    for (final Object? item in decoded)
      item is Map<String, Object?> ? item : null,
  ];
}

/// Aligns an envelope compiled from Express with the Python SDK's output.
///
/// Replaces the default surface id with [surfaceId] (see
/// [_expressDefaultSurfaceId]). The Dart Express compiler always stamps
/// `v0.9`, while the Python SDK stamps the requested version, so a v0.9.1 run
/// gets `v0.9.1`. Both share the v0.9 message shapes, so only the label
/// changes; other versions are left untouched.
Map<String, Object?> _alignExpressEnvelope(
  Map<String, Object?> json,
  String surfaceId,
  A2uiProtocolVersion version,
) {
  final Object? declared = json['version'];
  final A2uiProtocolVersion? compiled = declared is String
      ? A2uiProtocolVersion.tryParse(declared)
      : null;
  final bool relabel =
      compiled != null &&
      compiled != version &&
      compiled.major == version.major &&
      compiled.minor == version.minor;
  return <String, Object?>{
    for (final MapEntry<String, Object?> entry in json.entries)
      entry.key: switch (entry.value) {
        final Map<String, Object?> body
            when body['surfaceId'] == _expressDefaultSurfaceId =>
          <String, Object?>{...body, 'surfaceId': surfaceId},
        final Object? other => other,
      },
    if (relabel) 'version': version.jsonValue,
  };
}

Map<String, Object?> _parseAndValidate({
  required String formatName,
  required A2uiProtocolVersion version,
  required InferenceFormat strategy,
  required String surfaceId,
  required String completion,
  required bool requireCompleteTags,
  required bool validate,
}) {
  final Parser parser = strategy.createParser();
  final bool isDirectJson = formatName == 'direct_json';
  if (requireCompleteTags &&
      !parser.hasFormatContent(completion, complete: true)) {
    throw _BridgeError(
      isDirectJson
          ? "A2UI tags '<a2ui-json>' and '</a2ui-json>' not found in response."
          : "A2UI tags '<a2ui>' and '</a2ui>' not found in response.",
    );
  }

  // Like `parser.parseResponse(completion)`, but keeps each raw block so
  // explicit fields the model wrote can be preserved, and checks the
  // messages only when asked.
  final compiledMessages = <AgentToRendererMessage>[];
  final compiledJsons = <Map<String, Object?>>[];
  final serializedParts = <Map<String, Object?>>[];
  for (final RawResponsePart part in parser.unwrap(completion)) {
    switch (part) {
      case TextPart(:final String text):
        serializedParts.add({'text': text, 'a2ui_json': null});
      case RawA2uiPart(:final String a2uiRaw):
        final List<AgentToRendererMessage> messages = parser.compile(a2uiRaw);
        final List<Map<String, Object?>?>? raws = isDirectJson
            ? _rawEnvelopes(a2uiRaw, messages.length)
            : null;
        final msgDicts = <Map<String, Object?>>[];
        for (var i = 0; i < messages.length; i++) {
          Map<String, Object?> json = _messageJson(messages[i], raws?[i]);
          AgentToRendererMessage message = messages[i];
          if (!isDirectJson) {
            json = _alignExpressEnvelope(json, surfaceId, version);
            message = AgentToRendererMessage.fromJson(json);
          }
          msgDicts.add(json);
          compiledMessages.add(message);
        }
        serializedParts.add({'text': '', 'a2ui_json': msgDicts});
        compiledJsons.addAll(msgDicts);
    }
  }

  if (compiledMessages.isEmpty) {
    throw _BridgeError(
      isDirectJson
          ? 'No A2UI JSON found in response (tags missing or empty)'
          : 'No compiled A2UI $formatName user interface found in parsed parts.',
    );
  }

  if (validate) {
    // The response is checked as a whole against a new renderer state, as
    // `parser.parseResponse` checks it, so its surfaces must be complete.
    final state = RendererState(parser.catalogs);
    try {
      state.checkTopology(state.apply(compiledMessages));
    } finally {
      state.dispose();
    }
  }
  return {'compiled_jsons': compiledJsons, 'parts': serializedParts};
}

/// Describes [err] without Dart type prefixes such as `Bad state:`.
///
/// Expected failures (SDK, argument and runner errors) report only their
/// message, like `str(exc)` in the Python bridge. Anything else is a bug in
/// the runner or the SDK and keeps its stack trace.
String _describeError(Object err, StackTrace stackTrace) {
  switch (err) {
    case A2uiValidationError(:final String? path, :final String message)
        when path != null && path.isNotEmpty:
      return '$path: $message';
    case A2uiDataError(:final String? path, :final String message)
        when path != null && path.isNotEmpty:
      return '$path: $message';
    case A2uiError(:final String message):
      return message;
    case _BridgeError(:final String message):
      return message;
    case StateError(:final String message):
      return message;
    case ArgumentError(:final Object? message) when message != null:
      return message.toString();
    case FormatException():
      return err.toString().replaceFirst('FormatException: ', '');
  }
  return '$err\n$stackTrace'.trim();
}

Future<void> main() async {
  try {
    final String rawInput = await utf8.decoder.bind(stdin).join();
    final req = jsonDecode(rawInput) as Map<String, Object?>;
    final action = req['action']! as String;
    final formatName = req['format_name']! as String;
    final resolvedCatalogPath = req['resolved_catalog_path']! as String;
    final String requestedVersion = (req['version'] as String?) ?? '';
    final String surfaceId = (req['surface_id'] as String?) ?? 'main';
    final String completion = (req['completion'] as String?) ?? '';
    final bool requireCompleteTags =
        (req['require_complete_tags'] as bool?) ?? false;

    final A2uiProtocolVersion version = _resolveVersion(
      requestedVersion,
      formatName,
    );
    final CatalogApi catalog = _loadCatalog(resolvedCatalogPath, version);
    final InferenceFormat strategy = _createStrategy(formatName, catalog);

    switch (action) {
      case 'generate_prompt':
        stdout.write(
          jsonEncode({'result': strategy.promptGenerator.generate()}),
        );
      case 'parse_and_validate':
        final Map<String, Object?> result = _parseAndValidate(
          formatName: formatName,
          version: version,
          strategy: strategy,
          surfaceId: surfaceId,
          completion: completion,
          requireCompleteTags: requireCompleteTags,
          validate: (req['validate'] as bool?) ?? true,
        );
        stdout.write(jsonEncode({'result': result}));
      default:
        throw _BridgeError("Unsupported bridge action: '$action'.");
    }
  } on Object catch (err, stackTrace) {
    stdout.write(jsonEncode({'error': _describeError(err, stackTrace)}));
  }
}
