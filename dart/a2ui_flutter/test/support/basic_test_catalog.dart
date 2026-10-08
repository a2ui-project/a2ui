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
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';

/// The space the basic Row, Column and List leave between their children.
const double flexGap = 8;

/// A catalog under the basic catalog's id holding [components], the basic
/// functions and the basic theme schema.
WidgetCatalog basicTestCatalog(List<ComponentImplementation> components) =>
    WidgetCatalog(
      id: BasicCatalog.v0_9Id,
      components: components,
      functions: BasicCatalog.v0_9().functions.values.toList(),
      themeSchema: BasicComponents.api.themeSchema,
    );
