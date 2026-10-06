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

// TODO(yjbanov): this should probably be merged with interfaces. There's not
//                much value in splitting up code that's meant to assist with
//                embedding GenUI into a host app.

/// Widgets used to display GenUI surfaces.
library;

export 'widgets/fallback_widget.dart';
export 'widgets/node_surface.dart';
export 'widgets/surface.dart';
export 'widgets/widget_utilities.dart';
