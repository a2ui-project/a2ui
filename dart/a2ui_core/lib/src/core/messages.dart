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

/// Base class for all A2UI messages.
abstract class A2uiMessage {
  /// The declared protocol version, as it appears on the wire.
  final String version;

  A2uiMessage({this.version = 'v0.9'});

  /// Deserializes a JSON envelope into a typed [A2uiMessage].
  ///
  /// Throws [A2uiValidationError] if `version` is missing or unsupported.
  factory A2uiMessage.fromJson(Map<String, dynamic> json) {
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
class CreateSurfaceMessage extends A2uiMessage {
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
class UpdateComponentsMessage extends A2uiMessage {
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
class UpdateDataModelMessage extends A2uiMessage {
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
class DeleteSurfaceMessage extends A2uiMessage {
  final String surfaceId;

  DeleteSurfaceMessage({super.version, required this.surfaceId});

  @override
  Map<String, dynamic> toJson() => {
    'version': version,
    'deleteSurface': {'surfaceId': surfaceId},
  };
}

/// Reports a user-initiated action from a component.
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

  Map<String, dynamic> toJson() => {
    'name': name,
    'surfaceId': surfaceId,
    'sourceComponentId': sourceComponentId,
    'timestamp': timestamp.toIso8601String(),
    'context': context,
  };
}

/// Reports a client-side error.
class A2uiClientError {
  final String code;
  final String surfaceId;
  final String message;
  final Object? details;

  A2uiClientError({
    required this.code,
    required this.surfaceId,
    required this.message,
    this.details,
  });

  Map<String, dynamic> toJson() => {
    'code': code,
    'surfaceId': surfaceId,
    'message': message,
    if (details != null) 'details': details,
  };
}
