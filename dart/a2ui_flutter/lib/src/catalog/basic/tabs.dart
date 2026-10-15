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

typedef _Tab = ({String title, ComponentNode<ComponentImplementation>? child});

/// Builds the basic `Tabs` component: a header with the title of each of
/// `tabs` above the child of the selected tab, the first until the user
/// selects another. Selecting a tab discards the widget state of the
/// previous tab's child. When the Tabs' height is bounded, the child fills
/// the height the header leaves.
Widget buildTabs(
  BuildContext context,
  ComponentNode<ComponentImplementation> node,
  ComponentProps props,
  ChildWidgetBuilder buildChild,
) {
  final List<_Tab> tabs = [
    for (final Object? item in props.list('tabs'))
      if (item is Map<String, Object?>)
        (
          title: ComponentProps.asString(item['title']) ?? '',
          child: switch (item['child']) {
            final ComponentNode<ComponentImplementation> child => child,
            _ => null,
          },
        ),
  ];
  if (tabs.isEmpty) return const SizedBox.shrink();
  return DefaultTabController(
    length: tabs.length,
    child: _Tabs(tabs: tabs, buildChild: buildChild),
  );
}

class _Tabs extends StatelessWidget {
  const _Tabs({required this.tabs, required this.buildChild});

  final List<_Tab> tabs;
  final ChildWidgetBuilder buildChild;

  @override
  Widget build(BuildContext context) {
    final TabController controller = DefaultTabController.of(context);
    final Widget selected = ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final ComponentNode<ComponentImplementation>? child =
            tabs[controller.index].child;
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: child == null ? null : buildChild(child),
        );
      },
    );
    return LayoutBuilder(
      builder: (context, constraints) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: constraints.hasBoundedWidth
            ? CrossAxisAlignment.stretch
            : CrossAxisAlignment.start,
        spacing: 8,
        children: [
          TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [for (final tab in tabs) Tab(text: tab.title)],
          ),
          // One wrapper either way, so the child keeps its state when the
          // height bound changes.
          Flexible(
            flex: constraints.hasBoundedHeight ? 1 : 0,
            fit: FlexFit.tight,
            child: selected,
          ),
        ],
      ),
    );
  }
}
