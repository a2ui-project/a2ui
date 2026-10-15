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
import 'package:flutter/material.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';

/// Builds the basic `Card` component: its `child` on a Material [Card].
Widget buildCard(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  final ComponentNode<ComponentImplementation>? child = props.child('child');
  return Card(
    child: Padding(
      padding: const EdgeInsets.all(8),
      child: child == null ? null : buildChild(child),
    ),
  );
}
