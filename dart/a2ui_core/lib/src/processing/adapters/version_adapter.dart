// Copyright 2026 Google LLC
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

import '../../core/messages.dart';
import '../../primitives/errors.dart';
import '../../primitives/protocol_version.dart';
import '../operations.dart';
import 'v0_9_adapter.dart';
import 'v1_0_adapter.dart';

/// Translates between one protocol version's wire messages and the
/// version-independent [InternalOperation]s a `MessageProcessor` executes.
///
/// One adapter serves one protocol release and any releases wire-compatible
/// with it, listed in [versions]. Inbound, [toOperations] and [operationsFor]
/// map an agent-to-renderer message onto operations, rejecting a message of a
/// version the adapter does not serve or an action that version does not
/// define. Outbound, [fromRendererMessage] produces the wire form of a
/// renderer-to-agent message.
abstract class VersionAdapter {
  const VersionAdapter();

  /// The release this adapter is named for.
  A2uiProtocolVersion get version;

  /// Every release this adapter serves, including [version].
  Set<A2uiProtocolVersion> get versions => {version};

  /// Maps one raw agent-to-renderer envelope onto operations.
  ///
  /// The envelope is parsed with [AgentToRendererMessage.fromJson], which
  /// checks it against the shape its declared version defines, and the parsed
  /// message is passed to [operationsFor].
  ///
  /// Throws [A2uiValidationError] if the envelope declares a version this
  /// adapter does not serve or is not a well-formed message of its version.
  List<InternalOperation> toOperations(Map<String, Object?> rawMessage) {
    checkServes(
      A2uiProtocolVersion.fromJson(rawMessage['version'], details: rawMessage),
      details: rawMessage,
    );
    return operationsFor(
      AgentToRendererMessage.fromJson(Map<String, dynamic>.from(rawMessage)),
    );
  }

  /// Maps one parsed agent-to-renderer message onto operations.
  ///
  /// Throws [A2uiValidationError] if [message] declares a version this adapter
  /// does not serve, or is a message its version does not define.
  List<InternalOperation> operationsFor(AgentToRendererMessage message);

  /// The wire form of an outbound [message] under this adapter's version.
  ///
  /// Throws [A2uiValidationError] if [message] declares a version this adapter
  /// does not serve, or is a message its version does not define.
  Map<String, Object?> fromRendererMessage(RendererToAgentMessage message);

  /// Throws [A2uiValidationError] unless this adapter serves [declared].
  void checkServes(A2uiProtocolVersion declared, {Object? details}) {
    if (versions.contains(declared)) return;
    throw A2uiValidationError(
      'Invalid ${version.jsonValue} message: it declares version '
      "'${declared.jsonValue}', which this adapter does not serve.",
      details: details,
    );
  }

  /// The release [message] declares, checked to be one this adapter serves.
  A2uiProtocolVersion servedVersionOf(AgentToRendererMessage message) {
    final A2uiProtocolVersion declared =
        A2uiProtocolVersion.fromJson(message.version);
    checkServes(declared);
    return declared;
  }

  /// Throws [A2uiValidationError] for a [messageType] this adapter's version
  /// does not define.
  Never rejectMessage(String messageType) => throw A2uiValidationError(
        "Invalid ${version.jsonValue} message: '$messageType' is not defined "
        'in this version.',
      );
}

/// The [VersionAdapter]s a `MessageProcessor` routes messages through, one
/// per protocol release.
///
/// Each message is routed on its own `version`, so one processor can hold
/// surfaces of different versions side by side.
class VersionAdapterRegistry {
  final Map<A2uiProtocolVersion, VersionAdapter> _adapters;

  /// A registry of [adapters].
  ///
  /// Throws [ArgumentError] if two adapters serve the same release.
  VersionAdapterRegistry(Iterable<VersionAdapter> adapters)
      : _adapters = _index(adapters);

  /// The registry a `MessageProcessor` uses by default: [V0_9Adapter] for
  /// v0.9 and v0.9.1, and [V1_0Adapter] for v1.0.
  factory VersionAdapterRegistry.standard() =>
      VersionAdapterRegistry(const [V0_9Adapter(), V1_0Adapter()]);

  static Map<A2uiProtocolVersion, VersionAdapter> _index(
    Iterable<VersionAdapter> adapters,
  ) {
    final index = <A2uiProtocolVersion, VersionAdapter>{};
    for (final adapter in adapters) {
      for (final A2uiProtocolVersion served in adapter.versions) {
        if (index.containsKey(served)) {
          throw ArgumentError.value(
            adapter,
            'adapters',
            'More than one adapter serves ${served.jsonValue}.',
          );
        }
        index[served] = adapter;
      }
    }
    return index;
  }

  /// The releases some adapter in this registry serves.
  Iterable<A2uiProtocolVersion> get supportedVersions => _adapters.keys;

  /// The adapter serving [version].
  ///
  /// Throws [A2uiValidationError] if no adapter serves it.
  VersionAdapter adapterFor(A2uiProtocolVersion version, {Object? details}) =>
      _adapters[version] ??
      (throw A2uiValidationError(
        "Unsupported protocol version '${version.jsonValue}'. Supported "
        'versions: ${_adapters.keys.map((v) => v.jsonValue).join(', ')}.',
        details: details,
      ));

  /// The adapter for the version [rawMessage] declares.
  ///
  /// Throws [A2uiValidationError] if [rawMessage] declares no version, one
  /// this SDK does not know, or one no adapter here serves.
  VersionAdapter resolve(Map<String, Object?> rawMessage) => adapterFor(
        A2uiProtocolVersion.fromJson(rawMessage['version'],
            details: rawMessage),
        details: rawMessage,
      );

  /// The adapter for the version [message] declares.
  ///
  /// Throws [A2uiValidationError] if no adapter here serves it.
  VersionAdapter resolveMessage(AgentToRendererMessage message) =>
      adapterFor(A2uiProtocolVersion.fromJson(message.version));
}
