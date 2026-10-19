// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';

/// The protocol versions each e2e turn runs in.
const List<A2uiProtocolVersion> turnVersions = [
  A2uiProtocolVersion.v0_9,
  A2uiProtocolVersion.v1_0,
];

/// The published basic catalog of [version], read from this package's root.
CatalogApi loadBasicCatalog(A2uiProtocolVersion version) =>
    version.isAtLeast(A2uiProtocolVersion.v1_0)
    ? const FileSystemCatalogProvider(
        '../../../catalogs/basic/v1/catalog.json',
      ).load()
    : FileSystemCatalogProvider(
        '../../../specification/v0_9/catalogs/basic/catalog.json',
        protocolVersion: version,
      ).load();
