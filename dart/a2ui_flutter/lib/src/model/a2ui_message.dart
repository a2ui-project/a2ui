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

import 'package:json_schema_builder/json_schema_builder.dart';

import 'a2ui_schemas.dart';
import 'catalog.dart';

/// Returns the JSON schema for an A2UI message, parameterized by [catalog].
///
/// The message types themselves live in `package:a2ui_core`; this schema is
/// GenUI-specific because it is parameterized by the renderer's [Catalog].
Schema a2uiMessageSchema(Catalog catalog) {
  return S.combined(
    title: 'A2UI Message Schema',
    description:
        'Describes a JSON payload for an A2UI (Agent to UI) message, '
        'which is used to dynamically construct and update user interfaces.',
    oneOf: [
      S.object(
        properties: {
          'version': S.string(constValue: 'v0.9'),
          'createSurface': A2uiSchemas.createSurfaceSchema(),
        },
        required: ['version', 'createSurface'],
        additionalProperties: false,
      ),
      S.object(
        properties: {
          'version': S.string(constValue: 'v0.9'),
          'updateComponents': A2uiSchemas.updateComponentsSchema(catalog),
        },
        required: ['version', 'updateComponents'],
        additionalProperties: false,
      ),
      S.object(
        properties: {
          'version': S.string(constValue: 'v0.9'),
          'updateDataModel': A2uiSchemas.updateDataModelSchema(),
        },
        required: ['version', 'updateDataModel'],
        additionalProperties: false,
      ),
      S.object(
        properties: {
          'version': S.string(constValue: 'v0.9'),
          'deleteSurface': A2uiSchemas.deleteSurfaceSchema(),
        },
        required: ['version', 'deleteSurface'],
        additionalProperties: false,
      ),
    ],
  );
}
