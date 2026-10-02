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

/// Flutter framework adapter for A2UI.
///
/// Provides the root surface widget and component implementation abstraction
/// for rendering reactive A2UI component trees in Flutter.
library;

// Re-export core types commonly used with the adapter.
export 'package:a2ui_core/a2ui_core.dart'
    show
        A2uiClientAction,
        A2uiClientError,
        A2uiProtocolVersion,
        AgentToRendererMessage,
        AgentToRendererMessagePayload,
        Catalog,
        ComponentApi,
        ComponentModel,
        ComponentNode,
        DataModel,
        FunctionImplementation,
        MessageProcessor,
        NodeProps,
        NodeResolver,
        NodeState,
        ResolvedBinding,
        SurfaceGroupModel,
        SurfaceModel,
        ValidationConfig,
        WritableBinding;

// Binding accessors.
export 'src/binding/node_props_accessors.dart';

// Basic catalog implementations.
export 'src/catalog/basic/basic_catalog.dart';
export 'src/catalog/basic/button.dart';
export 'src/catalog/basic/card.dart';
export 'src/catalog/basic/check_box.dart';
export 'src/catalog/basic/choice_picker.dart';
export 'src/catalog/basic/column.dart';
export 'src/catalog/basic/date_time_input.dart';
export 'src/catalog/basic/divider.dart';
export 'src/catalog/basic/icon.dart';
export 'src/catalog/basic/image.dart';
export 'src/catalog/basic/list.dart';
export 'src/catalog/basic/modal.dart';
export 'src/catalog/basic/row.dart';
export 'src/catalog/basic/slider.dart';
export 'src/catalog/basic/tabs.dart';
export 'src/catalog/basic/text.dart';
export 'src/catalog/basic/text_field.dart';

// Catalog and component implementation types.
export 'src/catalog/component_implementation.dart';

// Node rendering and fallback views.
export 'src/nodes/fallback_views.dart';
export 'src/nodes/node_view.dart';

// Surface views and ambient scope.
export 'src/surface/a2ui_surface.dart';
export 'src/surface/surface_scope.dart';

// Theme adapter.
export 'src/theme/theme_adapter.dart';
