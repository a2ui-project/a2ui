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

import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../model/a2ui_schemas.dart';
import '../../model/catalog_item.dart';
import '../../model/data_model.dart';
import '../../primitives/simple_items.dart';
import '../../widgets/widget_utilities.dart';

final _schema = S.object(
  description: 'A tab layout to navigate between different child components.',
  properties: {
    'tabs': S.list(
      items: S.object(
        properties: {
          'label': A2uiSchemas.stringReference(
            description: 'The label for the tab.',
          ),
          'content': A2uiSchemas.componentReference(
            description:
                'The content (widget ID) to display when this tab is active.',
          ),
        },
        required: ['label', 'content'],
      ),
    ),
    'activeTab': A2uiSchemas.numberReference(
      description: 'The index of the currently active tab.',
    ),
  },
  required: ['tabs'],
);

extension type _TabsData.fromMap(JsonMap _json) {
  factory _TabsData({required List<JsonMap> tabs, Object? activeTab}) =>
      _TabsData.fromMap({'tabs': tabs, 'activeTab': activeTab});

  List<JsonMap> get tabs {
    return (_json['tabs'] as List).cast<JsonMap>();
  }

  Object? get activeTab => _json['activeTab'];
}

class _TabsWidget extends StatefulWidget {
  const _TabsWidget({
    required this.tabs,
    required this.itemContext,
    required this.activeTab,
    this.initialTab = 0,
    required this.onTabChanged,
  });

  final List<JsonMap> tabs;
  final CatalogItemContext itemContext;
  final int? activeTab;
  final int initialTab;
  final ValueChanged<int> onTabChanged;

  @override
  State<_TabsWidget> createState() => _TabsWidgetState();
}

class _TabsWidgetState extends State<_TabsWidget>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    final int initialIndex = (widget.activeTab ?? widget.initialTab).clamp(
      0,
      widget.tabs.length - 1,
    );
    _tabController = TabController(
      length: widget.tabs.length,
      vsync: this,
      initialIndex: initialIndex,
    );
    _tabController.addListener(_handleTabSelection);
  }

  @override
  void didUpdateWidget(_TabsWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.tabs.length != oldWidget.tabs.length) {
      _tabController.dispose();
      final int initialIndex = (widget.activeTab ?? widget.initialTab).clamp(
        0,
        widget.tabs.length - 1,
      );
      _tabController = TabController(
        length: widget.tabs.length,
        vsync: this,
        initialIndex: initialIndex,
      );
      _tabController.addListener(_handleTabSelection);
    } else if (widget.activeTab != oldWidget.activeTab) {
      _handleExternalChange();
    }
  }

  void _handleTabSelection() {
    if (!_tabController.indexIsChanging) {
      widget.onTabChanged(_tabController.index);
    }
  }

  void _handleExternalChange() {
    final int? newIndex = widget.activeTab;
    if (newIndex != null &&
        newIndex >= 0 &&
        newIndex < widget.tabs.length &&
        newIndex != _tabController.index) {
      _tabController.animateTo(newIndex);
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        TabBar(
          controller: _tabController,
          tabs: widget.tabs.map((tabItem) {
            final Object? labelRef = tabItem['label'] ?? tabItem['title'];
            return BoundString(
              dataContext: widget.itemContext.dataContext,
              value: labelRef,
              builder: (context, label) {
                return Tab(text: label ?? '');
              },
            );
          }).toList(),
        ),
        SizedBox(
          child: AnimatedBuilder(
            animation: _tabController,
            builder: (context, child) {
              final int index = _tabController.index;
              return IndexedStack(
                index: index,
                sizing: StackFit.loose,
                children: widget.tabs.map((tabItem) {
                  final contentId =
                      (tabItem['content'] ?? tabItem['child']) as String;
                  return widget.itemContext.buildChild(contentId);
                }).toList(),
              );
            },
          ),
        ),
      ],
    );
  }
}

/// A Material Design tab layout.
///
/// This widget displays a [TabBar] and a view area to allow navigation
/// between different child components. Each tab in `tabs` has a label and
/// a corresponding child component ID to display when selected.
///
/// ## Parameters:
///
/// - `tabs`: A list of tabs to display, each with a `label` and a `content`
///   widget ID.
/// - `activeTab`: (Optional) Binding to the current tab index.
final tabs = CatalogItem(
  name: 'Tabs',
  dataSchema: _schema,
  widgetBuilder: (itemContext) {
    final tabsData = _TabsData.fromMap(itemContext.data as JsonMap);
    final Object? activeTabRef = tabsData.activeTab;
    final path = (activeTabRef is Map && activeTabRef.containsKey('path'))
        ? activeTabRef['path'] as String
        : '${itemContext.id}.activeTab';

    return BoundNumber(
      dataContext: itemContext.dataContext,
      value: {'path': path},
      builder: (context, value) {
        // We pass the current value to _TabsWidget, which will handle
        // updating the TabController when it changes.
        // We no longer pass a ValueNotifier.
        return _TabsWidget(
          tabs: tabsData.tabs,
          itemContext: itemContext,
          activeTab: value?.toInt(),
          initialTab: activeTabRef is num ? activeTabRef.toInt() : 0,
          onTabChanged: (newIndex) {
            itemContext.dataContext.update(DataPath(path), newIndex);
          },
        );
      },
    );
  },
  exampleData: [
    () => '''
      [
        {
          "id": "root",
          "component": "Tabs",
          "activeTab": { "path": "/currentTab" },
          "tabs": [
            {
              "label": "Overview",
              "content": "text1"
            },
            {
              "label": "Details",
              "content": "text2"
            }
          ]
        },
        {
          "id": "text1",
          "component": "Text",
          "text": "This is a short summary of the item."
        },
        {
          "id": "text2",
          "component": "Text",
          "text": "This is a much longer, more detailed description."
        }
      ]
    ''',
  ],
);
