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

/// Base class for the messages an agent sends a renderer.
///
/// The `createSurface`, `updateComponents`, `updateDataModel` and
/// `deleteSurface` envelopes, which `MessageProcessor` applies to surface
/// state. A whole payload of them is an [AgentToRendererMessagePayload]; the
/// other direction is [RendererToAgentMessage].
abstract class AgentToRendererMessage {
  /// The declared protocol version, as it appears on the wire.
  final String version;

  AgentToRendererMessage({this.version = 'v0.9'});

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
  /// Every envelope must declare [protocolVersion]; a payload mixing versions
  /// is rejected rather than partially parsed.
  ///
  /// Throws [A2uiValidationError] for any envelope that is not a well-formed
  /// message of [protocolVersion], including one carrying more than a single
  /// update type.
  static AgentToRendererMessagePayload parseAll(
    List<Map<String, Object?>> payload, {
    required A2uiProtocolVersion protocolVersion,
  }) => AgentToRendererMessagePayload([
    for (final Map<String, Object?> envelope in payload)
      AgentToRendererMessage.fromJson(
        _checkedEnvelope(envelope, protocolVersion),
      ),
  ]);

  /// Deserializes a JSON envelope into a typed [AgentToRendererMessage].
  ///
  /// Throws [A2uiValidationError] if `version` is missing or unsupported.
  factory AgentToRendererMessage.fromJson(Map<String, dynamic> json) {
    final String version = A2uiProtocolVersion.fromJson(
      json['version'],
      details: json,
    ).jsonValue;

    const messageBodyKeys = {
      'createSurface',
      'updateComponents',
      'updateDataModel',
      'deleteSurface',
    };
    final List<String> presentKeys = messageBodyKeys
        .where(json.containsKey)
        .toList();
    if (presentKeys.length > 1) {
      throw A2uiValidationError(
        'A2UI message must contain exactly one of '
        '${messageBodyKeys.join(', ')}; got ${presentKeys.join(', ')}.',
        details: json,
      );
    }

    for (final key in messageBodyKeys) {
      if (!json.containsKey(key)) continue;
      final Map<String, dynamic> body = _body(json, key);
      switch (key) {
        case 'createSurface':
          return CreateSurfaceMessage(
            version: version,
            surfaceId: _required<String>(body, 'surfaceId', key),
            catalogId: _required<String>(body, 'catalogId', key),
            theme: _optional<Map<String, dynamic>>(body, 'theme', key),
            sendDataModel: _optional<bool>(body, 'sendDataModel', key) ?? false,
          );
        case 'updateComponents':
          return UpdateComponentsMessage(
            version: version,
            surfaceId: _required<String>(body, 'surfaceId', key),
            components: _components(body, key),
          );
        case 'updateDataModel':
          return UpdateDataModelMessage(
            version: version,
            surfaceId: _required<String>(body, 'surfaceId', key),
            path: _optional<String>(body, 'path', key),
            value: body['value'],
          );
        case 'deleteSurface':
          return DeleteSurfaceMessage(
            version: version,
            surfaceId: _required<String>(body, 'surfaceId', key),
          );
      }
    }

    throw A2uiValidationError(
      'Unknown A2UI message type. Expected one of: '
      '${messageBodyKeys.join(', ')}.',
      details: json,
    );
  }

  Map<String, dynamic> toJson();
}

/// The envelope, checked to declare [protocolVersion], as a JSON map.
///
/// Shared by both directions: the version tag is the one field no message body
/// defines, and a payload mixing versions is rejected rather than partially
/// parsed.
///
/// Throws [A2uiValidationError] when the envelope declares no version, or
/// declares one other than [protocolVersion].
Map<String, dynamic> _checkedEnvelope(
  Map<String, Object?> envelope,
  A2uiProtocolVersion protocolVersion,
) {
  final A2uiProtocolVersion version = A2uiProtocolVersion.fromJson(
    envelope['version'],
    details: envelope,
  );
  if (version != protocolVersion) {
    throw A2uiValidationError(
      "Payload declares version '${version.jsonValue}' but this SDK "
      "accepts only '${protocolVersion.jsonValue}'.",
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
  return [
    for (final Object? entry in raw)
      if (entry is Map)
        entry.cast<String, dynamic>()
      else
        throw A2uiValidationError(
          "Field '$messageType.components' must hold objects, got "
          '${entry.runtimeType}.',
          details: body,
        ),
  ];
}

/// Signals the client to create a new surface.
class CreateSurfaceMessage extends AgentToRendererMessage {
  final String surfaceId;
  final String catalogId;
  final Map<String, dynamic>? theme;
  final bool sendDataModel;

  CreateSurfaceMessage({
    super.version,
    required this.surfaceId,
    required this.catalogId,
    this.theme,
    this.sendDataModel = false,
  });

  @override
  Map<String, dynamic> toJson() => {
    'version': version,
    'createSurface': {
      'surfaceId': surfaceId,
      'catalogId': catalogId,
      if (theme != null) 'theme': theme,
      'sendDataModel': sendDataModel,
    },
  };
}

/// Updates a surface with a new set of components.
class UpdateComponentsMessage extends AgentToRendererMessage {
  final String surfaceId;
  final List<Map<String, dynamic>> components;

  UpdateComponentsMessage({
    super.version,
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
  final Object? value;

  UpdateDataModelMessage({
    super.version,
    required this.surfaceId,
    this.path,
    this.value,
  });

  @override
  Map<String, dynamic> toJson() => {
    'version': version,
    'updateDataModel': {
      'surfaceId': surfaceId,
      if (path != null) 'path': path,
      if (value != null) 'value': value,
    },
  };
}

/// Signals the client to delete a surface.
class DeleteSurfaceMessage extends AgentToRendererMessage {
  final String surfaceId;

  DeleteSurfaceMessage({super.version, required this.surfaceId});

  @override
  Map<String, dynamic> toJson() => {
    'version': version,
    'deleteSurface': {'surfaceId': surfaceId},
  };
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
  }) => AgentToRendererMessage.parseAll(
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
/// The body of `client_to_server.json`'s `action`, and what a surface's
/// `onAction` emits. [ActionMessage] is the envelope that carries it to the
/// agent.
class A2uiClientAction {
  final String name;
  final String surfaceId;
  final String sourceComponentId;
  final DateTime timestamp;
  final Map<String, dynamic> context;

  A2uiClientAction({
    required this.name,
    required this.surfaceId,
    required this.sourceComponentId,
    required this.timestamp,
    required this.context,
  });

  /// Parses the body of an `action` envelope.
  ///
  /// Throws [A2uiValidationError] for a missing or mistyped field, including a
  /// `timestamp` that is not an ISO 8601 instant.
  factory A2uiClientAction.fromJson(Map<String, dynamic> json) =>
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
      );

  Map<String, dynamic> toJson() => {
    'name': name,
    'surfaceId': surfaceId,
    'sourceComponentId': sourceComponentId,
    'timestamp': timestamp.toIso8601String(),
    'context': context,
  };
}

/// Reports a client-side error.
///
/// The body of `client_to_server.json`'s `error`, and what a surface's
/// `onError` emits. [ErrorMessage] is the envelope that carries it to the
/// agent.
class A2uiClientError {
  final String code;
  final String surfaceId;
  final String message;

  /// The JSON pointer to the field that failed validation, for example
  /// `/components/0/text`.
  ///
  /// Required of the `VALIDATION_FAILED` variant and defined by no other, so it
  /// is carried rather than folded into [details]: an agent reading a
  /// validation failure needs the field it names, and a round trip through
  /// [toJson] and [A2uiClientError.fromJson] would otherwise lose it.
  final String? path;

  final Object? details;

  A2uiClientError({
    required this.code,
    required this.surfaceId,
    required this.message,
    this.path,
    this.details,
  }) : assert(
         code != validationFailedCode || path != null,
         "A '$validationFailedCode' error must name the 'path' that failed.",
       );

  /// The error code whose variant requires [path].
  static const String validationFailedCode = 'VALIDATION_FAILED';

  /// Parses the body of an `error` envelope.
  ///
  /// Throws [A2uiValidationError] for a missing or mistyped field, and for a
  /// [validationFailedCode] error that names no [path]: the variant requires
  /// it, and it is the only field saying what failed.
  factory A2uiClientError.fromJson(Map<String, dynamic> json) {
    final String code = _required<String>(json, 'code', 'error');
    final String? path = _optional<String>(json, 'path', 'error');
    if (code == validationFailedCode && path == null) {
      throw A2uiValidationError(
        "Field 'error.path' is required of a '$validationFailedCode' error.",
        details: json,
      );
    }
    return A2uiClientError(
      code: code,
      surfaceId: _required<String>(json, 'surfaceId', 'error'),
      message: _required<String>(json, 'message', 'error'),
      path: path,
      details: json['details'],
    );
  }

  Map<String, dynamic> toJson() => {
    'code': code,
    'surfaceId': surfaceId,
    'message': message,
    if (path != null) 'path': path,
    if (details != null) 'details': details,
  };
}

/// Base class for the messages a renderer sends an agent.
///
/// The `action` and `error` envelopes: a renderer reports a user-initiated
/// action as an [ActionMessage] and a client-side failure as an
/// [ErrorMessage]. Each wraps the body a surface's event source already emits,
/// [A2uiClientAction] or [A2uiClientError], so an envelope is built around the
/// value a listener received rather than from a second representation of it.
///
/// A whole payload of them is a [RendererToAgentMessagePayload]; the other
/// direction is [AgentToRendererMessage].
abstract class RendererToAgentMessage {
  /// The declared protocol version, as it appears on the wire.
  final String version;

  RendererToAgentMessage({this.version = 'v0.9'});

  /// Parses a whole payload of envelopes into a
  /// [RendererToAgentMessagePayload].
  ///
  /// The mirror of [AgentToRendererMessage.parseAll], for the payload an agent
  /// receives: [payload] is a list of envelopes, and every one of them must
  /// declare [protocolVersion].
  ///
  /// Throws [A2uiValidationError] for any envelope that is not a well-formed
  /// message of [protocolVersion], including one carrying both an action and
  /// an error.
  static RendererToAgentMessagePayload parseAll(
    List<Map<String, Object?>> payload, {
    required A2uiProtocolVersion protocolVersion,
  }) => RendererToAgentMessagePayload([
    for (final Map<String, Object?> envelope in payload)
      RendererToAgentMessage.fromJson(
        _checkedEnvelope(envelope, protocolVersion),
      ),
  ]);

  /// Deserializes a JSON envelope into a typed [RendererToAgentMessage].
  ///
  /// Throws [A2uiValidationError] if `version` is missing or unsupported, or
  /// if the envelope does not carry exactly one of `action` and `error`.
  factory RendererToAgentMessage.fromJson(Map<String, dynamic> json) {
    final String version = A2uiProtocolVersion.fromJson(
      json['version'],
      details: json,
    ).jsonValue;

    const messageBodyKeys = {'action', 'error'};
    final List<String> presentKeys = messageBodyKeys
        .where(json.containsKey)
        .toList();
    if (presentKeys.length > 1) {
      throw A2uiValidationError(
        'A2UI message must contain exactly one of '
        '${messageBodyKeys.join(', ')}; got ${presentKeys.join(', ')}.',
        details: json,
      );
    }

    if (json.containsKey('action')) {
      return ActionMessage(
        version: version,
        action: A2uiClientAction.fromJson(_body(json, 'action')),
      );
    }
    if (json.containsKey('error')) {
      return ErrorMessage(
        version: version,
        error: A2uiClientError.fromJson(_body(json, 'error')),
      );
    }

    throw A2uiValidationError(
      'Unknown A2UI message type. Expected one of: '
      '${messageBodyKeys.join(', ')}.',
      details: json,
    );
  }

  Map<String, dynamic> toJson();
}

/// Carries a user-initiated action to the agent.
class ActionMessage extends RendererToAgentMessage {
  /// The action, as a surface's `onAction` emitted it.
  final A2uiClientAction action;

  ActionMessage({super.version, required this.action});

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

  ErrorMessage({super.version, required this.error});

  @override
  Map<String, dynamic> toJson() => {
    'version': version,
    'error': error.toJson(),
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
  }) => RendererToAgentMessage.parseAll(
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
