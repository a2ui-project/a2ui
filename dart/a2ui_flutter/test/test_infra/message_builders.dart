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

// Test-only builders for `a2ui_core` messages and component wire JSON.
//
// `package:genui` consumes the core message types directly; these helpers keep
// test setup terse and mirror the named-argument shape the tests already use.

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:a2ui_flutter/src/model/data_path.dart';
import 'package:a2ui_flutter/src/primitives/simple_items.dart';

/// Builds a component's wire JSON: `{'id': ..., 'component': ..., ...props}`.
JsonMap component({
  required String id,
  required String type,
  JsonMap properties = const {},
}) => {'id': id, 'component': type, ...properties};

core.CreateSurfaceMessage createSurface({
  String version = 'v0.9',
  required String surfaceId,
  required String catalogId,
  JsonMap? theme,
  bool sendDataModel = false,
}) => core.CreateSurfaceMessage(
  version: version,
  surfaceId: surfaceId,
  catalogId: catalogId,
  theme: theme,
  sendDataModel: sendDataModel,
);

core.UpdateComponentsMessage updateComponents({
  String version = 'v0.9',
  required String surfaceId,
  required List<JsonMap> components,
}) => core.UpdateComponentsMessage(
  version: version,
  surfaceId: surfaceId,
  components: components,
);

core.UpdateDataModelMessage updateDataModel({
  String version = 'v0.9',
  required String surfaceId,
  DataPath path = DataPath.root,
  Object? value,
}) => core.UpdateDataModelMessage(
  version: version,
  surfaceId: surfaceId,
  path: path.toString(),
  value: value,
);

core.DeleteSurfaceMessage deleteSurface({
  String version = 'v0.9',
  required String surfaceId,
}) => core.DeleteSurfaceMessage(version: version, surfaceId: surfaceId);
