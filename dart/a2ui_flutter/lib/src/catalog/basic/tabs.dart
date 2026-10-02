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
import 'package:json_schema_builder/json_schema_builder.dart';

import '../component_implementation.dart';

/// The basic catalog `Tabs` component implementation.
final flutterTabsImplementation = FlutterComponentImplementation(
  name: 'Tabs',
  schema: Schema.object(
    properties: {
      'tabs': Schema.list(
        items: Schema.object(
          properties: {
            'title': CommonSchemas.dynamicString,
            'child': CommonSchemas.componentId,
          },
          required: ['title', 'child'],
        ),
      ),
    },
    required: ['tabs'],
  ),
  builder: (context, node, buildChild) {
    final Object? rawTabs = node.props.peek()['tabs'];
    if (rawTabs is! List || rawTabs.isEmpty) {
      return const SizedBox.shrink();
    }

    final List<
      ({String title, ComponentNode<FlutterComponentImplementation>? child})
    >
    tabEntries = [];

    for (final Object? item in rawTabs) {
      if (item is Map) {
        final Object? rawTitle = item['title'];
        final String title = rawTitle is ResolvedBinding
            ? rawTitle.value?.toString() ?? ''
            : rawTitle?.toString() ?? '';
        final Object? rawChild = item['child'];
        final ComponentNode<FlutterComponentImplementation>? child =
            rawChild is ComponentNode<FlutterComponentImplementation>
            ? rawChild
            : null;
        tabEntries.add((title: title, child: child));
      }
    }

    if (tabEntries.isEmpty) return const SizedBox.shrink();

    return DefaultTabController(
      length: tabEntries.length,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabBar(
            isScrollable: tabEntries.length > 3,
            tabs: [for (final entry in tabEntries) Tab(text: entry.title)],
          ),
          SizedBox(
            height: 250,
            child: TabBarView(
              children: [
                for (final entry in tabEntries)
                  entry.child != null
                      ? buildChild(entry.child!)
                      : const SizedBox.shrink(),
              ],
            ),
          ),
        ],
      ),
    );
  },
);
