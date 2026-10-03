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

import '../primitives/protocol_version.dart';

/// Which checks `MessageProcessor` applies to each message.
///
/// Every `updateComponents` message is checked against the surface it would
/// leave behind: the components the surface already holds, with the batch
/// applied on top. The flags here relax the graph checks a surface delivered
/// across several messages may not satisfy yet: a root, references that
/// resolve, and components reachable from the root.
///
/// Duplicate ids, self-references, cycles, over-deep chains and malformed
/// data-model paths are always checked, because no later message can make
/// them right. That holds even for [none], which turns off only catalog schema
/// checks. TypeScript's `MessageProcessor` skips every check when it has no
/// config; this SDK matches Python and keeps the graph checks.
///
/// [strict] is the default. The other SDKs spell these flags
/// `allow_orphan_components`, `allow_dangling_references`, `allow_missing_root`
/// and `allow_unknown_elements`, with the same defaults.
class ValidationConfig {
  /// Creates a configuration. Every flag defaults to the strict setting.
  const ValidationConfig({
    this.allowOrphanComponents = false,
    this.allowDanglingReferences = false,
    this.allowMissingRoot = false,
    this.allowUnknownElements = false,
    this.validateSchemas = true,
    this.targetVersion,
    this.allowedMessages,
    this.rootId,
    this.maxDepth,
  });

  /// Whether a surface may hold a component unreachable from its root.
  ///
  /// v0.9 has no way to remove a component, so a placeholder swapped out by
  /// re-sending its parent with new children stays on the surface with nothing
  /// pointing at it. The basic catalog's `31_incremental-dashboard` example
  /// does exactly that.
  final bool allowOrphanComponents;

  /// Whether a component may reference a component the surface does not hold.
  final bool allowDanglingReferences;

  /// Whether a surface may hold components but none with the root id.
  ///
  /// A surface without a root has no single entry point, so reachability is
  /// not checked either.
  final bool allowMissingRoot;

  /// Whether a component may name a type its catalog does not declare.
  ///
  /// Such a component is accepted without a schema check, and contributes no
  /// child references to the graph checks.
  final bool allowUnknownElements;

  /// Whether components and themes are checked against their catalog's
  /// schemas.
  ///
  /// When false, only the schema checks are skipped. The graph checks still
  /// run, governed by the other flags.
  final bool validateSchemas;

  /// The protocol version the processor must default to, or null to accept
  /// whichever version it defaults to.
  ///
  /// `MessageProcessor` throws `A2uiValidationError` on construction when this
  /// and its `defaultVersion` are both set and differ.
  final A2uiProtocolVersion? targetVersion;

  /// The message names a payload may contain, such as `createSurface` or
  /// `updateComponents`, or null to allow every message.
  final List<String>? allowedMessages;

  /// The id of the component a surface is rooted at, or null for the
  /// surface's own root id, which is `root` unless set otherwise.
  final String? rootId;

  /// The deepest component chain a surface may declare, or null for the
  /// default of 50.
  final int? maxDepth;

  /// Every check on: what a payload that renders a whole surface must pass.
  static const ValidationConfig strict = ValidationConfig();

  /// The graph checks that span messages off, and unknown component types
  /// allowed, for a surface delivered across several payloads.
  ///
  /// Schemas, duplicate ids, cycles and depth are still checked: those are not
  /// waiting on anything. Matches TypeScript's `RELAXED_VALIDATION`.
  static const ValidationConfig relaxed = ValidationConfig(
    allowOrphanComponents: true,
    allowDanglingReferences: true,
    allowMissingRoot: true,
    allowUnknownElements: true,
  );

  /// Catalog schema checks off; the graph checks run as in [strict].
  ///
  /// For a caller that trusts its components' shapes, or has checked them
  /// already, but still needs a surface it can render.
  static const ValidationConfig none = ValidationConfig(validateSchemas: false);

  @override
  String toString() =>
      'ValidationConfig(allowOrphanComponents: $allowOrphanComponents, '
      'allowDanglingReferences: $allowDanglingReferences, '
      'allowMissingRoot: $allowMissingRoot, '
      'allowUnknownElements: $allowUnknownElements, '
      'validateSchemas: $validateSchemas, '
      'targetVersion: ${targetVersion?.jsonValue}, '
      'allowedMessages: $allowedMessages, '
      'rootId: $rootId, '
      'maxDepth: $maxDepth)';
}
