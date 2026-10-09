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

import '../primitives/errors.dart';
import '../primitives/protocol_version.dart';
import '../primitives/semver.dart';

/// Base class for the messages an agent sends a renderer.
///
/// The `createSurface`, `updateComponents`, `updateDataModel` and
/// `deleteSurface` envelopes, which `MessageProcessor` applies to surface
/// state, and, from v1.0, the `callRendererFunction` and
/// `agentFunctionResponse` envelopes. A whole payload of them is an
/// [AgentToRendererMessagePayload]; the other direction is
/// [RendererToAgentMessage].
abstract class AgentToRendererMessage {
  /// The declared protocol version, as it appears on the wire.
  final String version;

  AgentToRendererMessage({required this.version});

  /// Parses a whole payload of envelopes into an
  /// [AgentToRendererMessagePayload].
  ///
  /// An envelope declares its protocol version and exactly one update type;
  /// neither depends on a catalog. A payload is therefore parsed before it is
  /// known which surface, and so which catalog, each message belongs to, which
  /// is what lets `MessageProcessor` route the messages afterwards.
  ///
  /// [payload] is a list of envelopes. For the other shapes a transport hands
  /// over — a lone envelope, or the `{messages: [...]}` wrapper — use
  /// [AgentToRendererMessagePayload.fromJson], which normalizes the shape and
  /// then comes back here.
  ///
  /// Every envelope must declare [protocolVersion] or a version compatible
  /// with it (v0.9 and v0.9.1 are interchangeable); a payload mixing
  /// incompatible versions is rejected rather than partially parsed.
  ///
  /// Throws [A2uiValidationError] for any envelope that is not a well-formed
  /// message of [protocolVersion], including one carrying more than a single
  /// update type.
  static AgentToRendererMessagePayload parseAll(
    List<Map<String, Object?>> payload, {
    required A2uiProtocolVersion protocolVersion,
  }) =>
      AgentToRendererMessagePayload([
        for (final Map<String, Object?> envelope in payload)
          AgentToRendererMessage.fromJson(
            _checkedEnvelope(envelope, protocolVersion),
          ),
      ]);

  /// Deserializes a JSON envelope into a typed [AgentToRendererMessage].
  ///
  /// The envelope is checked against the shape its declared version defines:
  /// it must carry `version` and exactly one message body, every body field
  /// must be one the version defines, required fields must be present, and
  /// fields must have the right JSON type. The `callRendererFunction` and
  /// `agentFunctionResponse` messages exist only from v1.0, `createSurface`
  /// takes `theme` only before v1.0, and it takes `components`, `dataModel`
  /// and `metadata` only from v1.0.
  ///
  /// Component and function-call contents are left to the payload validator,
  /// which knows the catalog.
  ///
  /// Throws [A2uiValidationError] if `version` is missing or unsupported, or
  /// if the envelope breaks any of the rules above.
  factory AgentToRendererMessage.fromJson(Map<String, dynamic> json) {
    final _Envelope envelope = _readEnvelope(
      json,
      bodyKeys: _agentToRendererBodyKeys,
      v1BodyKeys: _agentToRendererV1BodyKeys,
    );
    final String version = envelope.version.jsonValue;
    final bool isV1 = envelope.version.isAtLeast(A2uiProtocolVersion.v1_0);
    final Map<String, dynamic> body = envelope.body;
    final String key = envelope.key;
    switch (key) {
      case 'createSurface':
        _checkKeys(
          body,
          isV1 ? _createSurfaceV1Keys : _createSurfaceV09Keys,
          key,
        );
        return CreateSurfaceMessage(
          version: version,
          surfaceId: _required<String>(body, 'surfaceId', key),
          catalogId: isV1
              ? _optional<String>(body, 'catalogId', key)
              : _required<String>(body, 'catalogId', key),
          theme: _optionalObject(body, 'theme', key),
          sendDataModel: _optional<bool>(body, 'sendDataModel', key) ?? false,
          components:
              body['components'] == null ? null : _components(body, key),
          dataModel: _optionalObject(body, 'dataModel', key),
          metadata: _metadata(body, key),
        );
      case 'updateComponents':
        _checkKeys(body, const {'surfaceId', 'components'}, key);
        return UpdateComponentsMessage(
          version: version,
          surfaceId: _required<String>(body, 'surfaceId', key),
          components: _components(body, key),
        );
      case 'updateDataModel':
        _checkKeys(body, const {'surfaceId', 'path', 'value'}, key);
        if (isV1 && !body.containsKey('value')) {
          throw A2uiValidationError(
            "Message '$key' is missing required field 'value'; from v1.0 a "
            'deletion sets it to null explicitly.',
            details: body,
          );
        }
        return UpdateDataModelMessage(
          version: version,
          surfaceId: _required<String>(body, 'surfaceId', key),
          path: _optional<String>(body, 'path', key),
          value: body['value'],
          hasValue: body.containsKey('value'),
        );
      case 'deleteSurface':
        _checkKeys(body, const {'surfaceId'}, key);
        return DeleteSurfaceMessage(
          version: version,
          surfaceId: _required<String>(body, 'surfaceId', key),
        );
      case 'callRendererFunction':
        _checkKeys(
          body,
          const {'surfaceId', 'functionCallId', 'callFunction'},
          key,
        );
        return CallRendererFunctionMessage(
          version: version,
          surfaceId: _optional<String>(body, 'surfaceId', key),
          functionCallId: _required<String>(body, 'functionCallId', key),
          callFunction: _callFunction(body, key, requireCatalogId: true),
        );
      default: // 'agentFunctionResponse'
        return AgentFunctionResponseMessage(
          version: version,
          response: _functionResponse(body, key),
        );
    }
  }

  Map<String, dynamic> toJson();
}

/// The message bodies an agent-to-renderer envelope may carry in every
/// supported version.
const Set<String> _agentToRendererBodyKeys = {
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
};

/// The agent-to-renderer message bodies added in v1.0.
const Set<String> _agentToRendererV1BodyKeys = {
  'callRendererFunction',
  'agentFunctionResponse',
};

const Set<String> _createSurfaceV09Keys = {
  'surfaceId',
  'catalogId',
  'theme',
  'sendDataModel',
};

const Set<String> _createSurfaceV1Keys = {
  'surfaceId',
  'catalogId',
  'sendDataModel',
  'components',
  'dataModel',
  'metadata',
};

/// The renderer-to-agent message bodies of every supported version.
const Set<String> _rendererToAgentBodyKeys = {'action', 'error'};

/// The renderer-to-agent message bodies added in v1.0.
const Set<String> _rendererToAgentV1BodyKeys = {
  'callAgentFunction',
  'rendererFunctionResponse',
};

/// An envelope's declared version and its single message body.
typedef _Envelope = ({
  A2uiProtocolVersion version,
  String key,
  Map<String, dynamic> body,
});

/// Reads an envelope's version and its one message body.
///
/// [bodyKeys] are the message types every version defines and [v1BodyKeys]
/// those added in v1.0. Shared by both directions: an envelope holds
/// `version` and exactly one message body, and nothing else.
///
/// Throws [A2uiValidationError] when the version is missing or unsupported,
/// when the envelope carries no body, more than one, a body its version does
/// not define, or any other key.
_Envelope _readEnvelope(
  Map<String, dynamic> json, {
  required Set<String> bodyKeys,
  required Set<String> v1BodyKeys,
}) {
  final A2uiProtocolVersion version = A2uiProtocolVersion.fromJson(
    json['version'],
    details: json,
  );
  final bool isV1 = version.isAtLeast(A2uiProtocolVersion.v1_0);
  final allowed = <String>{...bodyKeys, if (isV1) ...v1BodyKeys};
  final present = <String>[];
  for (final String key in json.keys) {
    if (key == 'version') continue;
    if (allowed.contains(key)) {
      present.add(key);
    } else if (v1BodyKeys.contains(key)) {
      throw A2uiValidationError(
        "Message type '$key' requires protocol version "
        "'${A2uiProtocolVersion.v1_0.jsonValue}'; this message declares "
        "'${version.jsonValue}'.",
        details: json,
      );
    } else {
      throw A2uiValidationError(
        "Unknown A2UI message type or envelope key '$key'. Expected "
        "'version' and one of: ${allowed.join(', ')}.",
        details: json,
      );
    }
  }
  if (present.isEmpty) {
    throw A2uiValidationError(
      'Unknown A2UI message type. Expected one of: ${allowed.join(', ')}.',
      details: json,
    );
  }
  if (present.length > 1) {
    throw A2uiValidationError(
      'A2UI message must contain exactly one of '
      '${allowed.join(', ')}; got ${present.join(', ')}.',
      details: json,
    );
  }
  final String key = present.single;
  return (version: version, key: key, body: _body(json, key));
}

/// Rejects any field of [body] outside [allowed].
void _checkKeys(
  Map<String, dynamic> body,
  Set<String> allowed,
  String messageType,
) {
  for (final String key in body.keys) {
    if (!allowed.contains(key)) {
      throw A2uiValidationError(
        "Unknown field '$messageType.$key'. Expected only: "
        '${allowed.join(', ')}.',
        details: body,
      );
    }
  }
}

/// The envelope, checked to declare [protocolVersion], as a JSON map.
///
/// Shared by both directions: the version tag is the one field no message body
/// defines, and a payload mixing versions is rejected rather than partially
/// parsed. A version compatible with [protocolVersion] (see
/// [isCatalogVersionCompatible]) is accepted, so v0.9 and v0.9.1 envelopes are
/// interchangeable.
///
/// Throws [A2uiValidationError] when the envelope declares no version, or
/// declares one incompatible with [protocolVersion].
Map<String, dynamic> _checkedEnvelope(
  Map<String, Object?> envelope,
  A2uiProtocolVersion protocolVersion,
) {
  final A2uiProtocolVersion version = A2uiProtocolVersion.fromJson(
    envelope['version'],
    details: envelope,
  );
  if (!isCatalogVersionCompatible(
    version.jsonValue,
    protocolVersion.jsonValue,
  )) {
    throw A2uiValidationError(
      "Payload declares version '${version.jsonValue}' but this parser "
      "accepts only versions compatible with '${protocolVersion.jsonValue}'.",
      details: envelope,
    );
  }
  return Map<String, dynamic>.from(envelope);
}

/// The envelopes a raw payload carries, in the order they appear.
///
/// Accepts every shape a transport hands over: a lone envelope, a list of
/// envelopes, or the `{messages: [...]}` wrapper the specification defines for
/// protocols that require a top-level object. A null payload and an empty list
/// both yield no envelopes, because an empty batch is not a failure.
///
/// A map is read as the wrapper when it declares `messages`, which no envelope
/// of either direction does. Both directions share the wrapper's shape, so
/// they share this helper rather than a wrapper class each: the wrapper carries
/// nothing but the list, and a type holding one field would be a second name
/// for it.
///
/// Throws [A2uiValidationError] for any other shape.
List<Map<String, Object?>> _envelopesOf(Object? payload) {
  if (payload == null) return const [];
  if (payload is List) {
    return [for (final Object? entry in payload) ..._envelopesOf(entry)];
  }
  if (payload is Map) {
    // `cast` is lazy, so a non-string key would escape as a `TypeError` from
    // whatever later copies the map. A malformed payload is a payload defect,
    // not a programming error, so it is rejected here instead.
    if (payload.keys.any((Object? key) => key is! String)) {
      throw A2uiValidationError(
        'A payload object must have string keys; got '
        '${payload.keys.map((Object? k) => k.runtimeType).toSet().join(', ')}.',
        details: payload,
      );
    }
    if (!payload.containsKey('messages')) {
      return [payload.cast<String, Object?>()];
    }
    final Object? wrapped = payload['messages'];
    if (wrapped is! List) {
      throw A2uiValidationError(
        "A payload wrapper's 'messages' must be a list, got "
        '${wrapped.runtimeType}.',
        details: payload,
      );
    }
    return _envelopesOf(wrapped);
  }
  throw A2uiValidationError(
    'A payload must be a message, a list of messages, or an object wrapping a '
    "list of messages under a 'messages' key; got ${payload.runtimeType}.",
    details: payload,
  );
}

/// Reads a message body, rejecting one that is not an object.
Map<String, dynamic> _body(Map<String, dynamic> json, String key) {
  final Object? body = json[key];
  if (body is! Map) {
    throw A2uiValidationError(
      "Message body '$key' must be an object.",
      details: json,
    );
  }
  return body.cast<String, dynamic>();
}

/// Reads a field a message body must declare.
///
/// A malformed envelope is a payload defect, not a programming error, so it
/// is reported as [A2uiValidationError] rather than left to fail as a cast.
T _required<T extends Object>(
  Map<String, dynamic> body,
  String field,
  String messageType,
) {
  final Object? value = body[field];
  if (value == null) {
    throw A2uiValidationError(
      "Message '$messageType' is missing required field '$field'.",
      details: body,
    );
  }
  if (value is! T) {
    throw A2uiValidationError(
      "Field '$messageType.$field' must be a $T, got "
      '${value.runtimeType}.',
      details: body,
    );
  }
  return value;
}

/// Reads a field a message body may omit.
T? _optional<T extends Object>(
  Map<String, dynamic> body,
  String field,
  String messageType,
) {
  final Object? value = body[field];
  if (value == null) return null;
  if (value is! T) {
    throw A2uiValidationError(
      "Field '$messageType.$field' must be a $T, got "
      '${value.runtimeType}.',
      details: body,
    );
  }
  return value;
}

/// Reads an object-valued field, rejecting one that is not an object.
Map<String, dynamic> _object(
  Map<String, dynamic> body,
  String field,
  String messageType,
) {
  final Object? value = body[field];
  if (value is! Map) {
    throw A2uiValidationError(
      "Field '$messageType.$field' must be an object, got "
      '${value.runtimeType}.',
      details: body,
    );
  }
  if (value.keys.any((key) => key is! String)) {
    throw A2uiValidationError(
      "Field '$messageType.$field' must have string keys.",
      details: body,
    );
  }
  return value.cast<String, dynamic>();
}

/// Reads an ISO 8601 timestamp field.
///
/// A malformed timestamp is reported as [A2uiValidationError] rather than left
/// to escape as the platform's [FormatException], which sits outside the
/// [A2uiError] hierarchy a caller catches.
DateTime _timestamp(
  Map<String, dynamic> body,
  String field,
  String messageType,
) {
  final String raw = _required<String>(body, field, messageType);
  final DateTime? parsed = DateTime.tryParse(raw);
  if (parsed == null) {
    throw A2uiValidationError(
      "Field '$messageType.$field' must be an ISO 8601 timestamp, got "
      "'$raw'.",
      details: body,
    );
  }
  return parsed;
}

/// Reads an object-valued field a message body may omit.
Map<String, dynamic>? _optionalObject(
  Map<String, dynamic> body,
  String field,
  String messageType,
) =>
    body[field] == null ? null : _object(body, field, messageType);

/// Reads an optional v1.0 `metadata` object, which may hold only an
/// `extensions` object.
Map<String, dynamic>? _metadata(Map<String, dynamic> body, String messageType) {
  final Map<String, dynamic>? metadata = _optionalObject(
    body,
    'metadata',
    messageType,
  );
  if (metadata == null) return null;
  _checkKeys(metadata, const {'extensions'}, '$messageType.metadata');
  _optionalObject(metadata, 'extensions', '$messageType.metadata');
  return metadata;
}

/// Reads a non-empty list of component objects.
List<Map<String, dynamic>> _components(
  Map<String, dynamic> body,
  String messageType,
) {
  final Object? raw = body['components'];
  if (raw is! List) {
    throw A2uiValidationError(
      "Field '$messageType.components' must be a list.",
      details: body,
    );
  }
  if (raw.isEmpty) {
    throw A2uiValidationError(
      "Field '$messageType.components' must hold at least one component.",
      details: body,
    );
  }
  return [
    for (final Object? entry in raw)
      if (entry is Map && entry.keys.every((Object? k) => k is String))
        entry.cast<String, dynamic>()
      else
        throw A2uiValidationError(
          "Field '$messageType.components' must hold objects with string "
          'keys, got ${entry.runtimeType}.',
          details: body,
        ),
  ];
}

/// Reads a `callFunction` object: a function call naming its function under
/// `@call`, with optional `args`.
///
/// [requireCatalogId] is set for `callRendererFunction`, whose call must name
/// the catalog that defines the function. The other fields are the
/// catalog's to define, so they are left to the payload validator.
Map<String, dynamic> _callFunction(
  Map<String, dynamic> body,
  String messageType, {
  required bool requireCatalogId,
}) {
  final type = '$messageType.callFunction';
  final Map<String, dynamic> call = _object(body, 'callFunction', messageType);
  _required<String>(call, '@call', type);
  if (requireCatalogId) {
    _required<String>(call, 'catalogId', type);
  } else {
    _optional<String>(call, 'catalogId', type);
  }
  _optionalObject(call, 'args', type);
  return call;
}

/// Reads a function response body: a `functionCallId` and exactly one of
/// `value` and `error`.
A2uiFunctionResponse _functionResponse(
  Map<String, dynamic> body,
  String messageType,
) {
  _checkKeys(body, const {'functionCallId', 'value', 'error'}, messageType);
  final String functionCallId = _required<String>(
    body,
    'functionCallId',
    messageType,
  );
  final bool hasValue = body.containsKey('value');
  final bool hasError = body.containsKey('error');
  if (hasValue == hasError) {
    throw A2uiValidationError(
      "Message '$messageType' must carry exactly one of 'value' and 'error'.",
      details: body,
    );
  }
  if (hasValue) {
    return A2uiFunctionResponse.value(functionCallId, body['value']);
  }
  final errorType = '$messageType.error';
  final Map<String, dynamic> error = _object(body, 'error', messageType);
  _checkKeys(error, const {'code', 'message'}, errorType);
  return A2uiFunctionResponse.error(
    functionCallId,
    A2uiFunctionResponseError(
      code: _required<String>(error, 'code', errorType),
      message: _required<String>(error, 'message', errorType),
    ),
  );
}

/// Whether [version] is v1.0 or a later release, including releases this SDK
/// does not implement yet.
bool _isV1(String version) => compareVersions(version, 'v1.0') >= 0;

/// Signals the client to create a new surface.
class CreateSurfaceMessage extends AgentToRendererMessage {
  final String surfaceId;

  /// The surface's default catalog.
  ///
  /// Required before v1.0. From v1.0 it may be omitted, leaving the renderer
  /// to resolve the catalog.
  final String? catalogId;

  /// The surface theme. Defined before v1.0 only.
  final Map<String, dynamic>? theme;

  final bool sendDataModel;

  /// The surface's initial components. Defined from v1.0 only.
  final List<Map<String, Object?>>? components;

  /// The surface's initial root data model. Defined from v1.0 only.
  final Map<String, Object?>? dataModel;

  /// Surface-level metadata, holding at most an `extensions` object. Defined
  /// from v1.0 only.
  final Map<String, Object?>? metadata;

  CreateSurfaceMessage({
    required super.version,
    required this.surfaceId,
    this.catalogId,
    this.theme,
    this.sendDataModel = false,
    this.components,
    this.dataModel,
    this.metadata,
  });

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        'createSurface': {
          'surfaceId': surfaceId,
          if (catalogId != null) 'catalogId': catalogId,
          if (theme != null) 'theme': theme,
          'sendDataModel': sendDataModel,
          if (components != null) 'components': components,
          if (dataModel != null) 'dataModel': dataModel,
          if (metadata != null) 'metadata': metadata,
        },
      };
}

/// Updates a surface with a new set of components.
class UpdateComponentsMessage extends AgentToRendererMessage {
  final String surfaceId;
  final List<Map<String, dynamic>> components;

  UpdateComponentsMessage({
    required super.version,
    required this.surfaceId,
    required this.components,
  });

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        'updateComponents': {'surfaceId': surfaceId, 'components': components},
      };
}

/// Updates the data model for an existing surface.
class UpdateDataModelMessage extends AgentToRendererMessage {
  final String surfaceId;
  final String? path;

  /// The value to write at [path]. A null value deletes it.
  ///
  /// From v1.0 the wire form always carries `value`, set to null for a
  /// deletion; before v1.0 a deletion omits it.
  final Object? value;

  /// Whether this message carries a `value` entry on the wire.
  ///
  /// Distinguishes an explicit `value: null` (which deletes the key at [path])
  /// from a v0.9 message that omits `value` altogether. Defaults to `true` so
  /// `UpdateDataModelMessage(surfaceId: 's', value: null)` emits
  /// `'value': null` in [toJson].
  final bool hasValue;

  UpdateDataModelMessage({
    required super.version,
    required this.surfaceId,
    this.path,
    this.value,
    this.hasValue = true,
  }) {
    if (!hasValue && value != null) {
      throw A2uiValidationError(
        "UpdateDataModelMessage cannot have a non-null 'value' when "
        "'hasValue' is false.",
      );
    }
  }

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        'updateDataModel': {
          'surfaceId': surfaceId,
          if (path != null) 'path': path,
          if (hasValue || _isV1(version)) 'value': value,
        },
      };
}

/// Signals the client to delete a surface.
class DeleteSurfaceMessage extends AgentToRendererMessage {
  final String surfaceId;

  DeleteSurfaceMessage({required super.version, required this.surfaceId});

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        'deleteSurface': {'surfaceId': surfaceId},
      };
}

/// Asks the renderer to run a function on the agent's behalf. Defined from
/// v1.0 only.
///
/// The renderer answers with a [RendererFunctionResponseMessage] carrying the
/// same [functionCallId].
class CallRendererFunctionMessage extends AgentToRendererMessage {
  /// Optional ID of the surface whose data model provides the evaluation
  /// context for this call. If null, the function executes in a
  /// surface-independent root context with an empty data model.
  final String? surfaceId;

  /// Identifies this call; the renderer copies it into its response.
  final String functionCallId;

  /// The function call, naming the function under `@call` and the catalog
  /// that defines it under `catalogId`, with optional `args`.
  final Map<String, Object?> callFunction;

  CallRendererFunctionMessage({
    required super.version,
    this.surfaceId,
    required this.functionCallId,
    required this.callFunction,
  });

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        'callRendererFunction': {
          if (surfaceId != null) 'surfaceId': surfaceId,
          'functionCallId': functionCallId,
          'callFunction': callFunction,
        },
      };
}

/// Answers a [CallAgentFunctionMessage] the renderer sent. Defined from v1.0
/// only.
class AgentFunctionResponseMessage extends AgentToRendererMessage {
  /// The result or failure of the call.
  final A2uiFunctionResponse response;

  AgentFunctionResponseMessage({
    required super.version,
    required this.response,
  });

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        'agentFunctionResponse': response.toJson(),
      };
}

/// The answer to a function call made across the wire, in either direction:
/// the body of `agentFunctionResponse` and `rendererFunctionResponse`.
///
/// Carries either a [value] or an [error], never both.
class A2uiFunctionResponse {
  /// The `functionCallId` of the call being answered.
  final String functionCallId;

  /// The function's result, which may be null. Unset when [error] is set.
  final Object? value;

  /// Why the call failed, or null when it succeeded with [value].
  final A2uiFunctionResponseError? error;

  /// A successful response returning [value].
  const A2uiFunctionResponse.value(this.functionCallId, this.value)
      : error = null;

  /// A failed response reporting [error].
  const A2uiFunctionResponse.error(
    this.functionCallId,
    A2uiFunctionResponseError this.error,
  ) : value = null;

  Map<String, Object?> toJson() => {
        'functionCallId': functionCallId,
        if (error case final A2uiFunctionResponseError error)
          'error': error.toJson()
        else
          'value': value,
      };
}

/// Why a function call failed, as reported in an [A2uiFunctionResponse].
class A2uiFunctionResponseError {
  /// A machine-readable error code, such as `INVALID_FUNCTION_CALL`.
  final String code;

  /// A human-readable description of the failure.
  final String message;

  const A2uiFunctionResponseError({required this.code, required this.message});

  Map<String, Object?> toJson() => {'code': code, 'message': message};
}

/// A whole agent-to-renderer payload, normalized to the messages it carries.
///
/// `MessageProcessor` is the boundary where untrusted wire data enters the SDK,
/// so it accepts every shape an agent or a transport realistically sends rather
/// than one version's list of envelopes alone. Naming that set lets a signature
/// reference it instead of restating it.
///
/// Each accepted shape has a constructor:
///
/// - a batch of parsed messages, through the default constructor;
/// - one parsed message, through [AgentToRendererMessagePayload.of];
/// - raw decoded JSON — a lone envelope, a list of envelopes, or the
///   `{messages: [...]}` wrapper — through
///   [AgentToRendererMessagePayload.fromJson].
///
/// Single and batch are both accepted because requiring a caller to wrap a lone
/// message in a list pushes trivial normalization onto every transport. Raw
/// JSON is accepted because a transport typically hands over decoded JSON that
/// has not been through the message models yet; parsing and validating it is
/// this layer's job.
///
/// [messages] is unmodifiable, so the list a caller passed cannot change under
/// a processor part-way through applying it.
class AgentToRendererMessagePayload {
  /// The messages this payload carries, in the order they arrived.
  final List<AgentToRendererMessage> messages;

  /// A payload of already parsed [messages].
  AgentToRendererMessagePayload(Iterable<AgentToRendererMessage> messages)
      : messages = List<AgentToRendererMessage>.unmodifiable(messages);

  /// A payload carrying [message] alone.
  AgentToRendererMessagePayload.of(AgentToRendererMessage message)
      : messages = List<AgentToRendererMessage>.unmodifiable([message]);

  /// Parses decoded JSON into a payload.
  ///
  /// [payload] may be a lone envelope, a list of envelopes, or the
  /// `{messages: [...]}` wrapper. A null payload and an empty list both yield
  /// an empty payload, because an empty batch is not a failure.
  ///
  /// Throws [A2uiValidationError] for any other shape, and for any envelope
  /// that is not a well-formed message of [protocolVersion].
  factory AgentToRendererMessagePayload.fromJson(
    Object? payload, {
    required A2uiProtocolVersion protocolVersion,
  }) =>
      AgentToRendererMessage.parseAll(
        _envelopesOf(payload),
        protocolVersion: protocolVersion,
      );

  /// The payload as the `{messages: [...]}` wrapper, matching
  /// `server_to_client_list_wrapper.json`.
  Map<String, Object?> toJson() => {'messages': toJsonList()};

  /// The payload as a bare list of envelopes, matching
  /// `server_to_client_list.json`.
  List<Map<String, dynamic>> toJsonList() => [
        for (final AgentToRendererMessage message in messages) message.toJson(),
      ];
}

/// Reports a user-initiated action from a component.
///
/// The body of the renderer-to-agent `action`, and what a surface's
/// `onAction` emits. [ActionMessage] is the envelope that carries it to the
/// agent.
class A2uiClientAction {
  final String name;
  final String surfaceId;
  final String sourceComponentId;
  final DateTime timestamp;
  final Map<String, dynamic> context;
  final String? userMessage;

  /// The catalog that defines the component that raised the action.
  final String? catalogId;

  /// Action-level metadata. From v1.0 it holds at most an `extensions`
  /// object.
  final Map<String, Object?>? metadata;

  A2uiClientAction({
    required this.name,
    required this.surfaceId,
    required this.sourceComponentId,
    required this.timestamp,
    required this.context,
    this.userMessage,
    this.catalogId,
    this.metadata,
  });

  /// Parses the body of an `action` envelope declaring [protocolVersion].
  ///
  /// The specification leaves the body open to fields it does not define;
  /// those are accepted and dropped.
  ///
  /// Throws [A2uiValidationError] for a missing or mistyped field, including a
  /// `timestamp` that is not an ISO 8601 instant, and, from v1.0, for a
  /// `metadata` object holding anything but `extensions`.
  factory A2uiClientAction.fromJson(
    Map<String, dynamic> json, {
    required A2uiProtocolVersion protocolVersion,
  }) =>
      A2uiClientAction(
        name: _required<String>(json, 'name', 'action'),
        surfaceId: _required<String>(json, 'surfaceId', 'action'),
        sourceComponentId: _required<String>(
          json,
          'sourceComponentId',
          'action',
        ),
        timestamp: _timestamp(json, 'timestamp', 'action'),
        context: _object(json, 'context', 'action'),
        userMessage: _optional<String>(json, 'userMessage', 'action'),
        catalogId: _optional<String>(json, 'catalogId', 'action'),
        metadata: protocolVersion.isAtLeast(A2uiProtocolVersion.v1_0)
            ? _metadata(json, 'action')
            : _optionalObject(json, 'metadata', 'action'),
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'surfaceId': surfaceId,
        'sourceComponentId': sourceComponentId,
        'timestamp': timestamp.toUtc().toIso8601String(),
        'context': context,
        if (userMessage != null && userMessage!.isNotEmpty)
          'userMessage': userMessage,
        if (catalogId != null) 'catalogId': catalogId,
        if (metadata != null) 'metadata': metadata,
      };
}

/// Reports a client-side error.
///
/// The body of the renderer-to-agent `error`, and what a surface's `onError`
/// emits. [ErrorMessage] is the envelope that carries it to the agent.
///
/// The specification defines two shapes. A path error ([validationFailedCode]
/// and, from v1.0, [unallowedParentCode] and [unallowedChildCode]) names the
/// [surfaceId] and the [path] that failed, and nothing else. Any other code is
/// a generic error: before v1.0 it names a [surfaceId]; from v1.0 it names
/// exactly one of [surfaceId] and [functionCallId]. A generic error may carry
/// further fields, kept in [details] and [additionalProperties].
class A2uiClientError {
  final String code;

  /// The surface the error concerns. Null only for a v1.0 generic error that
  /// names a [functionCallId] instead.
  final String? surfaceId;

  final String message;

  /// The JSON pointer to the field that failed validation, for example
  /// `/components/0/text`.
  ///
  /// Required of the path errors, so it is carried rather than folded into
  /// [details]: an agent reading a validation failure needs the field it
  /// names, and a round trip through [toJson] and [A2uiClientError.fromJson]
  /// would otherwise lose it.
  final String? path;

  /// The function call the error concerns, for a v1.0 generic error raised
  /// while answering a call rather than rendering a surface.
  final String? functionCallId;

  final Object? details;

  /// The generic error's fields other than the ones named above, kept so a
  /// round trip does not lose them.
  final Map<String, Object?> additionalProperties;

  /// Creates a client-side error report.
  ///
  /// Throws [A2uiValidationError] when [code] is [validationFailedCode] and
  /// the error names no non-empty [path] or no [surfaceId], or carries
  /// [details] or [additionalProperties].
  A2uiClientError({
    required this.code,
    this.surfaceId,
    required this.message,
    this.path,
    this.functionCallId,
    this.details,
    Map<String, Object?>? additionalProperties,
  }) : additionalProperties = Map<String, Object?>.unmodifiable(
          additionalProperties ?? const <String, Object?>{},
        ) {
    if (code != validationFailedCode) return;
    final String? path = this.path;
    if (path == null || path.isEmpty) {
      throw A2uiValidationError(
        "Field 'error.path' is required of a '$validationFailedCode' error.",
      );
    }
    if (surfaceId == null ||
        details != null ||
        this.additionalProperties.isNotEmpty) {
      throw A2uiValidationError(
        "A '$validationFailedCode' error must name the 'surfaceId' and "
        "'path' that failed, and carry no other fields.",
      );
    }
  }

  /// The code of a payload that failed validation.
  static const String validationFailedCode = 'VALIDATION_FAILED';

  /// The code of a component placed under a parent that does not allow it.
  /// A path error from v1.0.
  static const String unallowedParentCode = 'UNALLOWED_PARENT';

  /// The code of a child a component does not allow. A path error from v1.0.
  static const String unallowedChildCode = 'UNALLOWED_CHILD';

  /// The codes whose errors must name a [surfaceId] and a [path] in v1.0,
  /// and carry no other fields. Before v1.0 only [validationFailedCode] is a
  /// path error, so the constructor, which does not know the version,
  /// enforces the rule for that code alone.
  static const Set<String> pathErrorCodes = {
    validationFailedCode,
    unallowedParentCode,
    unallowedChildCode,
  };

  static const Set<String> _pathErrorKeys = {
    'code',
    'surfaceId',
    'path',
    'message',
  };

  /// Parses the body of an `error` envelope declaring [protocolVersion].
  ///
  /// Throws [A2uiValidationError] for a missing or mistyped field, for a path
  /// error that names no `surfaceId` or non-empty `path` or carries any other
  /// field, and for a generic error that names no `surfaceId` before v1.0, or
  /// not exactly one of `surfaceId` and `functionCallId` from v1.0.
  factory A2uiClientError.fromJson(
    Map<String, dynamic> json, {
    required A2uiProtocolVersion protocolVersion,
  }) {
    final String code = _required<String>(json, 'code', 'error');
    final bool isV1 = protocolVersion.isAtLeast(A2uiProtocolVersion.v1_0);
    final bool isPathError =
        isV1 ? pathErrorCodes.contains(code) : code == validationFailedCode;
    if (isPathError) {
      final String? path = _optional<String>(json, 'path', 'error');
      if (path == null || path.isEmpty) {
        throw A2uiValidationError(
          "Field 'error.path' is required of a '$code' error.",
          details: json,
        );
      }
      _checkKeys(json, _pathErrorKeys, 'error');
      return A2uiClientError(
        code: code,
        surfaceId: _required<String>(json, 'surfaceId', 'error'),
        message: _required<String>(json, 'message', 'error'),
        path: path,
      );
    }

    final String? surfaceId;
    final String? functionCallId;
    if (isV1) {
      surfaceId = _optional<String>(json, 'surfaceId', 'error');
      functionCallId = _optional<String>(json, 'functionCallId', 'error');
      if ((surfaceId == null) == (functionCallId == null)) {
        throw A2uiValidationError(
          "A '$code' error must name exactly one of 'error.surfaceId' and "
          "'error.functionCallId'.",
          details: json,
        );
      }
    } else {
      surfaceId = _required<String>(json, 'surfaceId', 'error');
      functionCallId = null;
    }
    final named = <String>{
      'code',
      'surfaceId',
      'message',
      'path',
      'details',
      if (isV1) 'functionCallId',
    };
    return A2uiClientError(
      code: code,
      surfaceId: surfaceId,
      message: _required<String>(json, 'message', 'error'),
      path: _optional<String>(json, 'path', 'error'),
      functionCallId: functionCallId,
      details: json['details'],
      additionalProperties: {
        for (final MapEntry<String, dynamic> entry in json.entries)
          if (!named.contains(entry.key)) entry.key: entry.value,
      },
    );
  }

  Map<String, dynamic> toJson() => {
        ...additionalProperties,
        'code': code,
        if (surfaceId != null) 'surfaceId': surfaceId,
        if (functionCallId != null) 'functionCallId': functionCallId,
        'message': message,
        if (path != null) 'path': path,
        if (details != null) 'details': details,
      };
}

/// Base class for the messages a renderer sends an agent.
///
/// The `action` and `error` envelopes, and, from v1.0, the
/// `callAgentFunction` and `rendererFunctionResponse` envelopes. A renderer
/// reports a user-initiated action as an [ActionMessage] and a client-side
/// failure as an [ErrorMessage]. Each wraps the body a surface's event source
/// already emits, [A2uiClientAction] or [A2uiClientError], so an envelope is
/// built around the value a listener received rather than from a second
/// representation of it.
///
/// A whole payload of them is a [RendererToAgentMessagePayload]; the other
/// direction is [AgentToRendererMessage].
abstract class RendererToAgentMessage {
  /// The declared protocol version, as it appears on the wire.
  final String version;

  RendererToAgentMessage({required this.version});

  /// Parses a whole payload of envelopes into a
  /// [RendererToAgentMessagePayload].
  ///
  /// The mirror of [AgentToRendererMessage.parseAll], for the payload an agent
  /// receives: [payload] is a list of envelopes, and every one of them must
  /// declare [protocolVersion] or a version compatible with it.
  ///
  /// Throws [A2uiValidationError] for any envelope that is not a well-formed
  /// message of [protocolVersion], including one carrying both an action and
  /// an error.
  static RendererToAgentMessagePayload parseAll(
    List<Map<String, Object?>> payload, {
    required A2uiProtocolVersion protocolVersion,
  }) =>
      RendererToAgentMessagePayload([
        for (final Map<String, Object?> envelope in payload)
          RendererToAgentMessage.fromJson(
            _checkedEnvelope(envelope, protocolVersion),
          ),
      ]);

  /// Deserializes a JSON envelope into a typed [RendererToAgentMessage].
  ///
  /// Throws [A2uiValidationError] if `version` is missing or unsupported, if
  /// the envelope does not carry exactly one message body its version
  /// defines, if it carries any other key, or if the body breaks its
  /// version's rules (see [A2uiClientAction.fromJson] and
  /// [A2uiClientError.fromJson]).
  factory RendererToAgentMessage.fromJson(Map<String, dynamic> json) {
    final _Envelope envelope = _readEnvelope(
      json,
      bodyKeys: _rendererToAgentBodyKeys,
      v1BodyKeys: _rendererToAgentV1BodyKeys,
    );
    final A2uiProtocolVersion protocolVersion = envelope.version;
    final String version = protocolVersion.jsonValue;
    final Map<String, dynamic> body = envelope.body;
    final String key = envelope.key;
    switch (key) {
      case 'action':
        return ActionMessage(
          version: version,
          action: A2uiClientAction.fromJson(
            body,
            protocolVersion: protocolVersion,
          ),
        );
      case 'error':
        return ErrorMessage(
          version: version,
          error: A2uiClientError.fromJson(
            body,
            protocolVersion: protocolVersion,
          ),
        );
      case 'callAgentFunction':
        _checkKeys(
          body,
          const {'surfaceId', 'functionCallId', 'callFunction'},
          key,
        );
        return CallAgentFunctionMessage(
          version: version,
          surfaceId: _required<String>(body, 'surfaceId', key),
          functionCallId: _required<String>(body, 'functionCallId', key),
          callFunction: _callFunction(body, key, requireCatalogId: false),
        );
      default: // 'rendererFunctionResponse'
        return RendererFunctionResponseMessage(
          version: version,
          response: _functionResponse(body, key),
        );
    }
  }

  Map<String, dynamic> toJson();
}

/// Carries a user-initiated action to the agent.
class ActionMessage extends RendererToAgentMessage {
  /// The action, as a surface's `onAction` emitted it.
  final A2uiClientAction action;

  ActionMessage({required super.version, required this.action});

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        'action': action.toJson(),
      };
}

/// Carries a client-side error to the agent.
class ErrorMessage extends RendererToAgentMessage {
  /// The error, as a surface's `onError` emitted it.
  final A2uiClientError error;

  ErrorMessage({required super.version, required this.error});

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        'error': error.toJson(),
      };
}

/// Asks the agent to run a function on the renderer's behalf. Defined from
/// v1.0 only.
///
/// The agent answers with an [AgentFunctionResponseMessage] carrying the same
/// [functionCallId].
class CallAgentFunctionMessage extends RendererToAgentMessage {
  /// The surface the call was made from.
  final String surfaceId;

  /// Identifies this call; the agent copies it into its response.
  final String functionCallId;

  /// The function call, naming the function under `@call`, with optional
  /// `catalogId` and `args`.
  final Map<String, Object?> callFunction;

  CallAgentFunctionMessage({
    required super.version,
    required this.surfaceId,
    required this.functionCallId,
    required this.callFunction,
  });

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        'callAgentFunction': {
          'surfaceId': surfaceId,
          'functionCallId': functionCallId,
          'callFunction': callFunction,
        },
      };
}

/// Answers a [CallRendererFunctionMessage] the agent sent. Defined from v1.0
/// only.
class RendererFunctionResponseMessage extends RendererToAgentMessage {
  /// The result or failure of the call.
  final A2uiFunctionResponse response;

  RendererFunctionResponseMessage({
    required super.version,
    required this.response,
  });

  @override
  Map<String, dynamic> toJson() => {
        'version': version,
        'rendererFunctionResponse': response.toJson(),
      };
}

/// A whole renderer-to-agent payload, normalized to the messages it carries.
///
/// The mirror of [AgentToRendererMessagePayload], built the same way from
/// [RendererToAgentMessage]: a batch of parsed messages, one parsed message
/// through [RendererToAgentMessagePayload.of], or raw decoded JSON through
/// [RendererToAgentMessagePayload.fromJson].
///
/// A renderer reaches for it outbound, to hand a transport one batch rather
/// than a message at a time; an agent reaches for it inbound, to read the batch
/// a renderer sent. Both directions are named so a signature can say which one
/// it means.
///
/// [messages] is unmodifiable, so a payload handed to a transport cannot change
/// under it.
class RendererToAgentMessagePayload {
  /// The messages this payload carries, in the order they were emitted.
  final List<RendererToAgentMessage> messages;

  /// A payload of already built [messages].
  RendererToAgentMessagePayload(Iterable<RendererToAgentMessage> messages)
      : messages = List<RendererToAgentMessage>.unmodifiable(messages);

  /// A payload carrying [message] alone.
  RendererToAgentMessagePayload.of(RendererToAgentMessage message)
      : messages = List<RendererToAgentMessage>.unmodifiable([message]);

  /// Parses decoded JSON into a payload.
  ///
  /// [payload] may be a lone envelope, a list of envelopes, or the
  /// `{messages: [...]}` wrapper. A null payload and an empty list both yield
  /// an empty payload, because an empty batch is not a failure.
  ///
  /// Throws [A2uiValidationError] for any other shape, and for any envelope
  /// that is not a well-formed message of [protocolVersion].
  factory RendererToAgentMessagePayload.fromJson(
    Object? payload, {
    required A2uiProtocolVersion protocolVersion,
  }) =>
      RendererToAgentMessage.parseAll(
        _envelopesOf(payload),
        protocolVersion: protocolVersion,
      );

  /// The payload as the `{messages: [...]}` wrapper, matching
  /// `client_to_server_list_wrapper.json`.
  Map<String, Object?> toJson() => {'messages': toJsonList()};

  /// The payload as a bare list of envelopes, matching
  /// `client_to_server_list.json`.
  List<Map<String, dynamic>> toJsonList() => [
        for (final RendererToAgentMessage message in messages) message.toJson(),
      ];
}
