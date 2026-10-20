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
import 'package:flutter/widgets.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';
import 'layout.dart';

/// Builds the basic `List` component: its `children` along `direction`,
/// aligned on the cross axis by `align`, in a [flexContainer] that scrolls
/// when the main axis is bounded.
///
/// Every child is built, and keeps its element whatever constraints the
/// List gets. Children's weights are ignored.
Widget buildList(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  final Axis direction = props.string('direction') == 'horizontal'
      ? Axis.horizontal
      : Axis.vertical;
  return SingleChildScrollView(
    scrollDirection: direction,
    primary: false,
    child: flexContainer(direction, props, buildChild),
  );
}
