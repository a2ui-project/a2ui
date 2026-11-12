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
import 'package:triage/triage.dart';

import '../model/suggestion_draft.dart';
import '../model/triage_controller.dart';
import '../model/triage_item.dart';
import 'column_divider.dart';
import 'group_actions.dart';
import 'item_info.dart';
import 'item_list.dart';
import 'item_log.dart';
import 'suggestion_editor.dart';
import 'suggestion_surface.dart';
import 'triage_scope.dart';

/// The selected item and the items linked to it, each in a tab of its own.
class ItemDetails extends StatefulWidget {
  const ItemDetails({super.key});

  @override
  State<ItemDetails> createState() => _ItemDetailsState();
}

class _ItemDetailsState extends State<ItemDetails> {
  /// The share of an [ItemView]'s width that its left column takes, which
  /// the triager changes by dragging the divider. Every tab and item uses the
  /// same share.
  double _infoShare = 0.4;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final TriageItem? item = controller.selected;
    if (item == null) {
      return const Center(child: Text('Select an item.'));
    }
    final List<TriageItem> items = controller.group(item);
    return DefaultTabController(
      // A new controller when the items change, such as after a refresh.
      key: ValueKey(items.map((i) => i.url).join(',')),
      length: items.length,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [for (final i in items) _ItemTab(i)],
          ),
          Expanded(
            child: TabBarView(
              children: [
                for (final i in items)
                  ItemView(
                    key: ValueKey(i.ref),
                    item: i,
                    group: items,
                    infoShare: _infoShare,
                    onResize: (double share) =>
                        setState(() => _infoShare = share),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The tab of [item]: its icon and short name, and a blue dot if the triager
/// edited its suggestion.
class _ItemTab extends StatelessWidget {
  const _ItemTab(this.item);

  final TriageItem item;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final SuggestionDraft draft = controller.draftFor(item);
    final (String kind, IconData icon, Color color) = kindStyle(
      context,
      item.kind,
    );
    return Tooltip(
      message: '${item.name}: ${item.title}',
      child: Tab(
        child: ListenableBuilder(
          listenable: draft,
          builder: (context, _) => Row(
            mainAxisSize: MainAxisSize.min,
            spacing: 6,
            children: [
              Icon(icon, size: 18, color: color, semanticLabel: kind),
              Text(item.shortName),
              if (draft.isEdited)
                const Tooltip(
                  message: 'Edited',
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Colors.blue,
                      shape: BoxShape.circle,
                    ),
                    child: SizedBox.square(dimension: 8),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One item in two columns: on the left, what the triager should know about
/// it; on the right, the tabs **Edit**, with its editable suggestion, and
/// **Log**, with what the tool did to it in this session, and below them
/// **Apply**, which applies the suggestions of all the items in [group]. The
/// triager drags the divider between the columns to resize them.
class ItemView extends StatelessWidget {
  const ItemView({
    super.key,
    required this.item,
    required this.group,
    required this.infoShare,
    required this.onResize,
  });

  final TriageItem item;

  /// The items in the details' tabs: the selected item and the items linked
  /// to it.
  final List<TriageItem> group;

  /// The share of the width that the left column takes.
  final double infoShare;

  /// Called with the left column's new share when the triager drags the
  /// divider.
  final void Function(double share) onResize;

  @override
  Widget build(BuildContext context) {
    final TriageController controller = TriageScope.of(context);
    final SuggestionPayload? payload = item.suggestion;
    final int logLength = controller.logOf(item.ref).length;
    return LayoutBuilder(
      builder: (context, constraints) {
        final double maxWidth = constraints.maxWidth;
        final double infoWidth = clampColumnWidth(
          infoShare * maxWidth,
          maxWidth,
        );
        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: infoWidth,
              child: ListView(
                padding: const EdgeInsets.all(24),
                children: [ItemInfo(item: item)],
              ),
            ),
            ColumnDivider(
              label: 'Resize the columns',
              onDrag: (double delta) =>
                  onResize((infoWidth + delta) / maxWidth),
            ),
            Expanded(
              child: DefaultTabController(
                length: 2,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TabBar(
                      isScrollable: true,
                      tabAlignment: TabAlignment.start,
                      tabs: [
                        const Tab(text: 'Edit'),
                        Tab(text: logLength == 0 ? 'Log' : 'Log ($logLength)'),
                      ],
                    ),
                    Expanded(
                      child: TabBarView(
                        children: [
                          ListView(
                            padding: const EdgeInsets.all(24),
                            children: [
                              if (payload != null)
                                SuggestionSurface(item: item, payload: payload)
                              else
                                SuggestionEditor(item: item),
                            ],
                          ),
                          ListView(
                            padding: const EdgeInsets.all(24),
                            children: [ItemLog(item: item)],
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 1),
                    GroupActions(items: group),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
