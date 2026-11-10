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

/// The message types [allowedMessages] names, in the order
/// [AgentToRendererMessage.typesFor] lists the types of [version], or all of
/// them when [allowedMessages] is null.
///
/// Throws [ArgumentError] if [allowedMessages] names a message type [version]
/// does not have.
List<String> resolveAllowedMessages(
  List<String>? allowedMessages,
  A2uiProtocolVersion version,
) {
  final List<String> messageTypes = AgentToRendererMessage.typesFor(version);
  if (allowedMessages == null) return messageTypes;
  for (final String type in allowedMessages) {
    if (!messageTypes.contains(type)) {
      throw ArgumentError.value(
        allowedMessages,
        'allowedMessages',
        "'$type' is not a ${version.jsonValue} message type. The types are: "
            '${messageTypes.join(', ')}',
      );
    }
  }
  return [
    for (final String type in messageTypes)
      if (allowedMessages.contains(type)) type,
  ];
}
