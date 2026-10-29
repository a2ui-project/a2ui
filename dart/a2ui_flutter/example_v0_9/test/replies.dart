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

import 'dart:convert';

import 'package:a2ui_core/a2ui_core.dart';

/// A direct JSON block holding [messages].
String block(List<Map<String, Object?>> messages) =>
    '<a2ui-json>${jsonEncode(messages)}</a2ui-json>';

/// A v0.9 `createSurface` of [surfaceId] on the basic catalog.
Map<String, Object?> createSurface(
  String surfaceId, {
  bool sendDataModel = false,
}) => {
  'version': 'v0.9',
  'createSurface': {
    'surfaceId': surfaceId,
    'catalogId': BasicCatalog.v0_9Id,
    if (sendDataModel) 'sendDataModel': true,
  },
};

/// A v0.9 `updateComponents` whose root, in [surfaceId], is a [component]
/// with [text].
Map<String, Object?> rootComponent(
  String surfaceId,
  String text, {
  String component = 'Text',
}) => {
  'version': 'v0.9',
  'updateComponents': {
    'surfaceId': surfaceId,
    'components': [
      {'id': 'root', 'component': component, 'text': text},
    ],
  },
};

/// A v0.9 `updateDataModel` setting [path] of [surfaceId] to [value].
Map<String, Object?> updateDataModel(
  String surfaceId,
  Object? value, {
  String? path,
}) => {
  'version': 'v0.9',
  'updateDataModel': {'surfaceId': surfaceId, 'path': ?path, 'value': value},
};
