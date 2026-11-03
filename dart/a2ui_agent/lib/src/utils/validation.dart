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

import 'renderer_state.dart';

/// Checks [payload] the way a renderer holding [catalogs] would.
///
/// The check is stateless: it sees one payload, with no record of what
/// earlier payloads sent. A surface that the payload creates is checked in
/// full, so its components must be valid and reachable from the root, and
/// their references must resolve once every message in the payload is
/// applied: a component may name a child that a later message adds. A
/// surface that the payload only updates may already hold components, so
/// references to components outside the payload and a missing root are
/// accepted there. Each of its components is still checked against a
/// catalog that defines all of them, and the surface passes if one such
/// catalog accepts it.
///
/// To check a payload against what earlier payloads sent, keep a
/// [RendererState] and call its [RendererState.apply] and
/// [RendererState.checkTopology] inside [RendererState.transaction], so a
/// rejected response is rolled back whole.
///
/// Each message must state a `version` that the catalogs' protocol version
/// accepts, such as `v0.9` or `v0.9.1` for v0.9 catalogs and `v1.0` for v1.0
/// catalogs.
///
/// Throws [A2uiValidationError], or a subclass such as [A2uiIntegrityError],
/// describing the first problem found if a renderer holding [catalogs] would
/// reject the payload, and [A2uiCatalogError] if [catalogs] is empty or they
/// target protocol versions whose messages differ.
void validatePayload(
  List<CatalogApi> catalogs,
  Iterable<AgentToRendererMessage> payload,
) {
  final RendererState state = createPayloadState(catalogs);
  try {
    state.checkTopology(state.apply(payload));
  } finally {
    state.dispose();
  }
}
