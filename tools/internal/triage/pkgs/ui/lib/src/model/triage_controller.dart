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

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared/shared.dart';

import 'analysis_draft.dart';
import 'applier.dart';
import 'github_item.dart';
import 'log_entry.dart';
import 'milestone_change.dart';
import 'triage_item.dart';
import 'triage_service.dart';
import 'triage_session.dart';

/// A group of the item list, as `ui.blueprint.md` describes. An item can be
/// in two groups: its own and [teamInput].
enum ItemGroup {
  /// **Needs triage**: the items in the queue without
  /// `status: needs-team-input` when they were loaded.
  newItems,

  /// **Needs team input**.
  teamInput,

  /// **Not in the queue**: the items opened by URL.
  notInQueue,
}

/// The state of the triage UI: the items, the selected one, the triager's
/// drafts and what the triager applied.
class TriageController extends ChangeNotifier {
  /// [connect] finds the triager's GitHub token and returns the service that
  /// uses it.
  TriageController({
    required Future<TriageService> Function() connect,
    TriageSession? session,
  }) : _connect = connect,
       session = session ?? TriageSession();

  final Future<TriageService> Function() _connect;
  TriageService? _service;

  final TriageSession session;

  /// The items with `status: needs-triage` or `status: needs-team-input`,
  /// from all the repositories the UI triages.
  List<TriageItem> _queue = const [];

  /// The items in [_queue] that had `status: needs-team-input` when they
  /// were loaded. The **Needs triage** group shows the other items in the
  /// queue.
  Set<ItemRef> _loadedTeamInput = const {};

  /// The items that the list shows under **Needs team input**: the ones in
  /// [_loadedTeamInput], and the ones that the triager applied a suggestion
  /// that adds the label to since, which also stay in their own group. An
  /// item stays in the group until a refresh, even if the triager removes
  /// the label.
  Set<ItemRef> _teamInput = const {};

  /// When each item in [_queue] was last updated, as of the last load. The
  /// list is ordered by these times, so that the triager's own changes do
  /// not move items until a refresh.
  Map<ItemRef, DateTime> _listedUpdatedAt = const {};

  /// Items opened by URL that are not in the queue.
  List<TriageItem> _opened = const [];

  /// The items that [hideTriaged] and [removeFromList] took out of each
  /// group, until a refresh.
  Set<(ItemGroup, ItemRef)> _hidden = const {};

  /// The listed items that [refreshItems] found no longer belong to a group
  /// that lists them, such as items that someone triaged on GitHub, until a
  /// refresh.
  Set<ItemRef> _leftOnGitHub = const {};

  /// The items that the triager took out of the list with [removeFromList],
  /// until a refresh.
  Set<ItemRef> _removed = const {};

  /// The repositories whose items the UI triages.
  static const List<String> repositories = [a2uiRepository, genuiRepository];

  Map<String, RepositoryInfo> _repositoryInfo = const {};

  /// The labels, assignable people and milestones of [repository].
  RepositoryInfo repositoryInfo(String repository) =>
      _repositoryInfo[repository] ?? const RepositoryInfo();

  /// How many loads are running. [start], [refresh], [refreshItems] and
  /// [open] can overlap.
  int _loads = 0;

  /// Whether the items are being loaded.
  bool get loading => _loads > 0;

  bool _disposed = false;

  String? _error;

  /// The last error, until [dismissError].
  String? get error => _error;

  /// Whether the controller reached GitHub and loaded the items once.
  bool get isConnected => _service != null;

  ItemRef? _selected;

  /// The group in which the triager selected [_selected], or null for the
  /// first group that has it.
  ItemGroup? _selectedGroup;

  /// The items that the triager selected together with Shift-click, in the
  /// order they were selected, with the group each was selected in. Empty
  /// unless more than one item is selected, and then [_selected] is null.
  List<(ItemRef, ItemGroup)> _multiSelection = const [];

  GitHubItem? _pendingOpen;

  final Set<ItemRef> _changedOnGitHub = {};
  final Map<ItemRef, AnalysisDraft> _drafts = {};
  final Map<ItemRef, ApplyResult> _results = {};
  final Map<ItemRef, List<LogEntry>> _logs = {};
  final Set<ItemRef> _applying = {};

  /// The items in the **Needs triage** group, in the order the list shows them.
  List<TriageItem> get newItems => _sorted(
    _queue.where(
      (i) =>
          !_loadedTeamInput.contains(i.ref) && _isShown(ItemGroup.newItems, i),
    ),
  );

  /// The items in the **Needs team input** group, in the order the list
  /// shows them. An item that the triager applied a suggestion that adds
  /// `status: needs-team-input` to is also in its own group.
  List<TriageItem> get teamInputItems => _sorted(
    [..._queue, ..._opened].where(
      (i) => _teamInput.contains(i.ref) && _isShown(ItemGroup.teamInput, i),
    ),
  );

  /// The items opened by URL that are not in the queue, in the order the
  /// triager opened them.
  List<TriageItem> get opened => [
    for (final i in _opened)
      if (_isShown(ItemGroup.notInQueue, i)) i,
  ];

  bool _isShown(ItemGroup group, TriageItem item) =>
      !_hidden.contains((group, item.ref));

  /// The items in [group], in the order the list shows them.
  List<TriageItem> itemsIn(ItemGroup group) => switch (group) {
    ItemGroup.newItems => newItems,
    ItemGroup.teamInput => teamInputItems,
    ItemGroup.notInQueue => opened,
  };

  /// Each group's items, in the order the list shows them. An item in two
  /// groups is listed twice.
  List<(ItemGroup, TriageItem)> get _listed => [
    for (final ItemGroup g in ItemGroup.values)
      for (final TriageItem i in itemsIn(g)) (g, i),
  ];

  /// The listed items that the triager applied a suggestion to, with the
  /// group that they no longer belong to as they are now.
  List<(ItemGroup, TriageItem)> get _triaged => [
    for (final (ItemGroup g, TriageItem i) in _listed)
      if (isHandled(i.ref) && !_belongsTo(g, i)) (g, i),
  ];

  /// Whether [hideTriaged] has items to hide.
  bool get hasTriaged => _triaged.isNotEmpty;

  /// Takes out of each group the items that the triager applied a
  /// suggestion to and that no longer belong to it, until a refresh. An
  /// item sent to the team leaves **Needs triage** and stays in **Needs team
  /// input**. Deselects the selected item if no group has it anymore.
  void hideTriaged() {
    _hidden = {
      ..._hidden,
      for (final (ItemGroup g, TriageItem i) in _triaged) (g, i.ref),
    };
    if (_selected != null && selectedGroup == null) {
      _selected = null;
      _selectedGroup = null;
    }
    _setMultiSelection([
      for (final (ItemRef r, ItemGroup g) in _multiSelection)
        if (!_hidden.contains((g, r))) (r, g),
    ]);
    notifyListeners();
  }

  /// Whether [item], as it is now, belongs to [group], as `ui.blueprint.md`
  /// defines the groups.
  static bool _belongsTo(ItemGroup group, TriageItem item) {
    final bool queued =
        item.isOpen &&
        !item.isDraft &&
        (item.isPullRequest || item.repository == a2uiRepository) &&
        (item.needsTriage || item.needsTeamInput);
    return switch (group) {
      ItemGroup.newItems => queued && !item.needsTeamInput,
      ItemGroup.teamInput => queued && item.needsTeamInput,
      ItemGroup.notInQueue => !queued,
    };
  }

  /// How many items are in the queue: the items in **Needs triage** and
  /// **Needs team input** when they loaded.
  int get queueLength => _queue.length;

  /// How many items in the queue are not [isHandled].
  int get remaining => _queue.where((i) => !isHandled(i.ref)).length;

  /// Whether the triager is done with [item]: applied a suggestion to it,
  /// sent it to the team or removed it from the list, or a refresh of its
  /// tab found that it [leftOnGitHub].
  bool isHandled(ItemRef item) =>
      session.isHandled(item) ||
      _leftOnGitHub.contains(item) ||
      _removed.contains(item);

  /// Whether [refreshItems] found that [item] no longer belongs to a group
  /// that lists it, such as when someone triaged it on GitHub.
  bool leftOnGitHub(ItemRef item) => _leftOnGitHub.contains(item);

  /// Takes [item] out of every group of the list, without changing it on
  /// GitHub, until a refresh. If it is selected, selects the next item that
  /// is not handled yet, as after an apply, or nothing if there is none.
  void removeFromList(TriageItem item) {
    final List<(ItemGroup, TriageItem)> order = _listed;
    _removed = {..._removed, item.ref};
    if (_selected == item.ref) {
      _selectNextAfterGroup([item], selectedGroup, order);
      if (_selected == item.ref) {
        _selected = null;
        _selectedGroup = null;
      }
    }
    _hidden = {
      ..._hidden,
      for (final ItemGroup g in ItemGroup.values) (g, item.ref),
    };
    _setMultiSelection([
      for (final e in _multiSelection)
        if (e.$1 != item.ref) e,
    ]);
    notifyListeners();
  }

  TriageItem? get selected => _selected == null ? null : item(_selected!);

  /// The group in which the selected item is selected: the one the triager
  /// selected it in, if it is still there, or else the first group that has
  /// it.
  ItemGroup? get selectedGroup {
    final ItemRef? ref = _selected;
    if (ref == null) return null;
    bool has(ItemGroup g) => itemsIn(g).any((i) => i.ref == ref);
    if (_selectedGroup case final ItemGroup g when has(g)) return g;
    return ItemGroup.values.where(has).firstOrNull;
  }

  /// The items that the triager selected with Shift-click, in the order they
  /// were selected, when more than one item is selected. Empty otherwise.
  List<TriageItem> get multiSelection => [
    for (final (ItemRef r, _) in _multiSelection) ?item(r),
  ];

  /// Whether [item] is one of the [multiSelection], selected in [group].
  bool isInMultiSelection(ItemRef item, ItemGroup group) =>
      _multiSelection.contains((item, group));

  /// Adds [item], in [group], to the selection, or takes it out if it is
  /// selected, as a Shift-click on it does. A selection of one item is
  /// [selected]; a selection of more is [multiSelection].
  void toggleInSelection(ItemRef item, ItemGroup group) {
    final List<(ItemRef, ItemGroup)> current = [
      ..._multiSelection,
      if (_selected case final ItemRef r) (r, selectedGroup ?? group),
    ];
    final bool had = current.any((e) => e.$1 == item);
    _selected = null;
    _selectedGroup = null;
    _setMultiSelection([
      for (final e in current)
        if (e.$1 != item) e,
      if (!had) (item, group),
    ]);
    notifyListeners();
  }

  /// Sets the [multiSelection] to [selection] if it has more than one item.
  /// A [selection] of one item becomes [selected] instead. An empty one
  /// leaves [selected] as it is.
  void _setMultiSelection(List<(ItemRef, ItemGroup)> selection) {
    if (selection.length > 1) {
      _multiSelection = selection;
      _selected = null;
      _selectedGroup = null;
      return;
    }
    _multiSelection = const [];
    if (selection case [(final ItemRef item, final ItemGroup group)]) {
      _selected = item;
      _selectedGroup = group;
    }
  }

  var _revealCount = 0;

  /// Grows each time the controller selects an item on its own, such as an
  /// item opened by URL or the next item after an apply, and on [reveal], so
  /// that the list shows the selected item even if it is in a collapsed
  /// group or scrolled out of view.
  int get revealCount => _revealCount;

  /// Asks the list to show the selected item: to expand its group and
  /// subgroup, and to scroll to it.
  void reveal() {
    if (_selected == null) return;
    _revealCount++;
    notifyListeners();
  }

  /// The loaded item that [ref] refers to, or null.
  TriageItem? item(ItemRef ref) {
    for (final TriageItem i in [..._queue, ..._opened]) {
      if (i.ref == ref) return i;
    }
    return null;
  }

  /// The linked and related items that are neither in the queue nor opened
  /// by URL, loaded by [loadLinked] and [relatedItem].
  final Map<ItemRef, TriageItem> _linked = {};

  /// The item that [ref] refers to, whether or not it needs triage, or null
  /// if it is not loaded yet.
  ///
  /// An item that is not loaded is loaded in the background, and the
  /// controller notifies its listeners once it is.
  TriageItem? relatedItem(ItemRef ref) {
    if (item(ref) ?? _linked[ref] case final TriageItem i) return i;
    if (_service != null) {
      unawaited(_linkedFetches.putIfAbsent(ref, () => _fetch(ref)));
    }
    return null;
  }

  /// The fetches that [loadLinked] and [relatedItem] started, by item.
  final Map<ItemRef, Future<void>> _linkedFetches = {};

  /// [item] and all the items linked to it, whether or not they need
  /// triage, which the details show as tabs and apply together.
  ///
  /// A linked item that is not loaded yet is left out, and loaded in the
  /// background; the group includes it once it is.
  List<TriageItem> group(TriageItem item) {
    final List<ItemRef> linked = item.linkedItems;
    if (linked.any((r) => this.item(r) == null && !_linked.containsKey(r))) {
      unawaited(loadLinked(item));
    }
    return [
      item,
      for (final r in linked)
        if (this.item(r) ?? _linked[r] case final TriageItem i) i,
    ];
  }

  /// Loads the items linked to [item] that are not loaded yet, and waits
  /// for the ones that are being loaded.
  Future<void> loadLinked(TriageItem item) => Future.wait([
    for (final ItemRef r in item.linkedItems)
      if (this.item(r) == null) _linkedFetches.putIfAbsent(r, () => _fetch(r)),
  ]);

  Future<void> _fetch(ItemRef ref) async {
    try {
      if (await _service!.fetchItem(ref) case final TriageItem linked) {
        _linked[ref] = linked;
        notifyListeners();
      }
    } on Object {
      // Forgotten, so that the next refresh of the item's tab tries again.
      unawaited(_linkedFetches.remove(ref));
    }
  }

  /// Whether a refresh found that [item] changed on GitHub, which reset its
  /// draft.
  bool changedOnGitHub(ItemRef item) => _changedOnGitHub.contains(item);

  bool isApplying(ItemRef item) => _applying.contains(item);

  /// Whether changes to any item are being applied. A refresh then would
  /// see the item changed by the apply, and drop its draft.
  bool get isApplyingAny => _applying.isNotEmpty;

  ApplyResult? lastResult(ItemRef item) => _results[item];

  /// What the tool did to [item] in this session, and what it found out
  /// about it, oldest first. Kept across refreshes.
  List<LogEntry> logOf(ItemRef item) => _logs[item] ?? const [];

  void _log(ItemRef item, LogEntry entry) => (_logs[item] ??= []).add(entry);

  /// The draft for [item], which starts as [initial], or as the item's
  /// analysis if [initial] is null, and removes `status: needs-triage`
  /// if the item has it.
  ///
  /// A linked item that is neither listed nor needs triage was triaged
  /// already, so its draft starts empty rather than from its old analysis,
  /// and a group apply changes it only if the triager edits it.
  AnalysisDraft draftFor(TriageItem item, [TriageAnalysis? initial]) =>
      _drafts.putIfAbsent(
        item.ref,
        () => AnalysisDraft(
          _startingDraft(
            item,
            initial ??
                (this.item(item.ref) == null && !item.needsTriage
                    ? const TriageAnalysis()
                    : item.analysis?.analysis ?? const TriageAnalysis()),
          ),
        ),
      );

  /// Undoes the triager's changes to the drafts of [items].
  void revert(List<TriageItem> items) {
    for (final i in items) {
      draftFor(i).revert();
    }
  }

  void dismissError() {
    _error = null;
    notifyListeners();
  }

  /// Connects to GitHub and loads the items.
  Future<void> start() => _load(() async {
    final TriageService service = await _connect();
    final (List<RepositoryInfo> info, List<TriageItem> queue) = await (
      [for (final r in repositories) service.fetchRepositoryInfo(r)].wait,
      service.fetchQueue(),
    ).wait;
    _service = service;
    _repositoryInfo = {
      for (var k = 0; k < repositories.length; k++) repositories[k]: info[k],
    };
    _setQueue(queue);
  }, then: _openPending);

  /// Loads the queue again and the items opened by URL.
  ///
  /// Resets the drafts of the items that changed on GitHub, so that the
  /// triager sees their current state.
  Future<void> refresh() => _load(() async {
    final TriageService service = _service!;
    final List<TriageItem> wereOpened = _opened;
    final List<TriageItem> queue = await service.fetchQueue();
    final Set<ItemRef> inQueue = {for (final i in queue) i.ref};
    final opened = <TriageItem>[];
    for (final i in wereOpened) {
      if (inQueue.contains(i.ref)) continue;
      final TriageItem? fresh = await service.fetchItem(i.ref);
      if (fresh != null) opened.add(fresh);
    }

    final Map<ItemRef, TriageItem> old = {
      for (final i in [..._queue, ..._opened]) i.ref: i,
    };
    _changedOnGitHub.clear();
    for (final i in [...queue, ...opened]) {
      if (old[i.ref] case final TriageItem before) _resetIfChanged(before, i);
    }
    _setQueue(queue);
    // An item that [open] loaded while the refresh ran is current already.
    final Set<ItemRef> refreshed = {for (final i in wereOpened) i.ref};
    _opened = [
      ...opened,
      for (final i in _opened)
        if (!refreshed.contains(i.ref) && !inQueue.contains(i.ref)) i,
    ];
    // Keeps the selected items that are still listed in their groups.
    _setMultiSelection([
      for (final (ItemRef r, ItemGroup g) in _multiSelection)
        if (itemsIn(g).any((i) => i.ref == r)) (r, g),
    ]);
    // Loaded again when the triager selects an item linked to them.
    _linked.clear();
    _linkedFetches.clear();
  });

  /// Loads [items] again, such as the items in the details' tabs, and
  /// resets the drafts of the ones that changed on GitHub, as [refresh] does
  /// for all the items.
  ///
  /// The items stay in their groups and places in the list until the next
  /// [refresh]. A listed item that no longer belongs to a group that lists
  /// it is [leftOnGitHub], and counts as handled.
  Future<void> refreshItems(List<TriageItem> items) => _load(() async {
    final TriageService service = _service!;
    final List<TriageItem?> fresh = await Future.wait([
      for (final i in items) service.fetchItem(i.ref),
    ]);
    for (var k = 0; k < items.length; k++) {
      final TriageItem? i = fresh[k];
      if (i == null) continue;
      _changedOnGitHub.remove(i.ref);
      _resetIfChanged(items[k], i);
      _replace(i);
      final bool left = ItemGroup.values.any(
        (g) => itemsIn(g).any((e) => e.ref == i.ref) && !_belongsTo(g, i),
      );
      _leftOnGitHub = {
        for (final ItemRef r in _leftOnGitHub)
          if (r != i.ref) r,
        if (left) i.ref,
      };
    }
  });

  /// If [fresh] was updated on GitHub since [before] loaded, resets its
  /// draft and last apply result, and logs that.
  ///
  /// An item that is being applied changes by the apply itself, so it keeps
  /// its draft; the apply loads it again when it ends.
  void _resetIfChanged(TriageItem before, TriageItem fresh) {
    if (before.updatedAt == fresh.updatedAt) return;
    final ItemRef n = fresh.ref;
    if (_applying.contains(n)) return;
    _changedOnGitHub.add(n);
    session.forgetReply(n);
    _drafts.remove(n)?.dispose();
    _results.remove(n);
    _log(
      n,
      LogEntry(
        'A refresh found that the item changed on GitHub, and reset '
        'its analysis to the current state',
      ),
    );
  }

  /// Selects [item], loading it first if it is not loaded.
  Future<void> open(GitHubItem item) async {
    if (!isConnected) {
      // Opened when the items are loaded.
      _pendingOpen = item;
      return;
    }
    if (this.item(item.ref) == null) {
      await _load(() async {
        final TriageItem? fetched = await _service!.fetchItem(item.ref);
        if (fetched == null) {
          throw GitHubException('${item.url} does not exist.');
        }
        _opened = [..._opened, fetched];
      });
    }
    if (this.item(item.ref) != null) {
      // An item that the triager took out of the list comes back, so that
      // the list can show it.
      _removed = {
        for (final r in _removed)
          if (r != item.ref) r,
      };
      _hidden = {
        for (final h in _hidden)
          if (h.$2 != item.ref) h,
      };
      _revealCount++;
      select(item.ref);
    }
  }

  /// Selects [item].
  ///
  /// [group] is the group in which the triager selected it, which decides
  /// the next item after an apply. If it is null, the first group that has
  /// the item.
  void select(ItemRef item, {ItemGroup? group}) {
    _selected = item;
    _selectedGroup = group;
    _multiSelection = const [];
    notifyListeners();
  }

  /// Selects nothing.
  void deselect() {
    _selected = null;
    _selectedGroup = null;
    _multiSelection = const [];
    notifyListeners();
  }

  /// Applies the draft for [item] to it on GitHub.
  ///
  /// If the item is selected, selects the next item that is not handled
  /// yet right away, without waiting for the apply. On success, records the
  /// item in the session.
  Future<void> apply(TriageItem item) => applyAll([item]);

  /// Applies the drafts of [items], one after another, skipping the drafts
  /// that change nothing. An item whose apply fails does not stop the
  /// others.
  ///
  /// If one of [items] is selected, or [items] are the [multiSelection],
  /// selects the next item that is not handled yet right away, so that the
  /// triager can go on while the applies run. A failed item shows it in the
  /// list.
  Future<void> applyAll(List<TriageItem> items) async {
    // What to apply is fixed now: a draft can change or go away while the
    // earlier items are applied.
    final List<(TriageItem, TriageAnalysis, MilestoneChange)> changed = [
      for (final i in items)
        if (draftFor(i) case final AnalysisDraft d when d.hasChanges)
          (i, d.toAnalysis(), d.milestoneChange),
    ];
    // Mark them all first, so that the next item is none of them.
    _applying.addAll(changed.map((c) => c.$1.ref));
    final List<(ItemGroup, TriageItem)> order = _listed;
    if (_multiSelection.isNotEmpty) {
      _selectNextAfterMultiSelection(items, order);
    } else {
      _selectNextAfterGroup(items, selectedGroup, order);
    }
    notifyListeners();
    for (final (TriageItem i, TriageAnalysis a, MilestoneChange m) in changed) {
      await _applyOne(i, a, m);
    }
  }

  /// Applies [analysis] and [milestone] to [item].
  Future<void> _applyOne(
    TriageItem item,
    TriageAnalysis analysis,
    MilestoneChange milestone,
  ) async {
    final ItemRef n = item.ref;
    _applying.add(n);
    _results.remove(n);
    notifyListeners();

    try {
      final String? reply = replyToPost(analysis);
      final ApplyResult result = await applySuggestion(
        _service!,
        item,
        analysis,
        // A retry after a failure does not post the same reply twice. A
        // different reply is a new one.
        replyPosted: reply != null && session.postedReply(n) == reply,
        onReplyPosted: () => session.recordReply(n, reply!),
        milestone: milestone,
        milestones: repositoryInfo(item.repository).milestones,
      );
      _results[n] = result;
      _log(
        n,
        LogEntry(
          result.succeeded ? 'Applied the suggestion' : 'Some changes failed',
          steps: result.steps,
        ),
      );
      if (result.succeeded) {
        session.recordApplied(item, analysis);
        if (analysis.addedLabels.contains(needsTeamInputLabel)) {
          _addToTeamInput(item);
        }
      }
    } on Object catch (e) {
      _results[n] = ApplyResult([
        StepResult('Apply', StepStatus.failed, error: '$e'),
      ]);
      _log(n, LogEntry('The apply failed: $e'));
    } finally {
      await _finish(n);
    }
  }

  /// [analysis] as a draft for [item] starts:
  ///
  /// 1. It removes `status: needs-triage`, if the item has it.
  /// 2. Its reply has no heading. The apply adds the heading that fits:
  ///    [replyHeading], or [teamNoteHeading] for a note to the team.
  /// 3. A pull request has no close reason, so any `close_as` closes it, as
  ///    `triage_bot/analysis.blueprint.md` says, and there is no item that
  ///    it duplicates.
  static TriageAnalysis _startingDraft(
    TriageItem item,
    TriageAnalysis analysis,
  ) {
    final bool closesPr = item.isPullRequest && analysis.closeAs != null;
    return TriageAnalysis(
      tldr: analysis.tldr,
      summary: analysis.summary,
      reason: analysis.reason,
      suggestion: analysis.suggestion,
      reply: switch (analysis.reply) {
        final String reply => withoutReplyHeading(reply),
        null => null,
      },
      closeAs: closesPr ? TriageCloseReason.completed : analysis.closeAs,
      duplicateOf: closesPr ? null : analysis.duplicateOf,
      addedLabels: analysis.addedLabels,
      removedLabels: [
        ...analysis.removedLabels,
        if (item.needsTriage &&
            !analysis.removedLabels.contains(needsTriageLabel))
          needsTriageLabel,
      ],
      newAssignees: analysis.newAssignees,
      removedAssignees: analysis.removedAssignees,
      targetingPrs: analysis.targetingPrs,
      targetedIssues: analysis.targetedIssues,
      relatedItems: analysis.relatedItems,
    );
  }

  /// Adds [item] to the **Needs team input** group. It stays in its own
  /// group too.
  void _addToTeamInput(TriageItem item) {
    final ItemRef n = item.ref;
    _teamInput = {..._teamInput, n};
    _listedUpdatedAt = {n: item.updatedAt, ..._listedUpdatedAt};
  }

  /// Loads [item] again, and ends its apply.
  Future<void> _finish(ItemRef item) async {
    // Show the item as it is now, so that a refresh does not take the
    // triager's own changes for someone else's.
    try {
      final TriageItem? fresh = await _service!.fetchItem(item);
      if (fresh != null) _replace(fresh);
    } on Object {
      // The item keeps its old state until the next refresh.
    } finally {
      _applying.remove(item);
      notifyListeners();
    }
  }

  void _setQueue(List<TriageItem> queue) {
    _queue = queue;
    _loadedTeamInput = {
      for (final i in queue)
        if (i.needsTeamInput) i.ref,
    };
    _teamInput = _loadedTeamInput;
    _hidden = const {};
    _leftOnGitHub = const {};
    _removed = const {};
    _listedUpdatedAt = {for (final i in queue) i.ref: i.updatedAt};
  }

  /// If one of [items] is selected, selects the next item that is not
  /// handled or being applied after the selected one in [group], in
  /// [order]: the list as it was before the items changed, since a change
  /// can add an item to a group. After the last item of [group] come the
  /// next groups.
  void _selectNextAfterGroup(
    List<TriageItem> items,
    ItemGroup? group,
    List<(ItemGroup, TriageItem)> order,
  ) {
    final ItemRef? selected = _selected;
    if (!items.any((i) => i.ref == selected)) return;
    final int index = order.indexWhere(
      (e) => e.$1 == group && e.$2.ref == selected,
    );
    // An item that the list does not show, such as one opened by URL after
    // it was hidden, has no place in [order].
    final Iterable<(ItemGroup, TriageItem)> candidates = index < 0
        ? order
        : [...order.skip(index + 1), ...order.take(index)];
    for (final (ItemGroup g, TriageItem i) in candidates) {
      if (!isHandled(i.ref) && !isApplying(i.ref)) {
        _selected = i.ref;
        _selectedGroup = g;
        _revealCount++;
        return;
      }
    }
  }

  /// If [items] are the [multiSelection], selects the next item that is not
  /// handled or being applied after the first selected item in [order], as
  /// [_selectNextAfterGroup] does after one item. Selects nothing if there
  /// is no such item.
  void _selectNextAfterMultiSelection(
    List<TriageItem> items,
    List<(ItemGroup, TriageItem)> order,
  ) {
    final Set<ItemRef> refs = {for (final i in items) i.ref};
    if (!_multiSelection.every((e) => refs.contains(e.$1))) return;
    final (ItemGroup, TriageItem)? first = order
        .where((e) => _multiSelection.contains((e.$2.ref, e.$1)))
        .firstOrNull;
    _multiSelection = const [];
    _selected = first?.$2.ref;
    _selectedGroup = first?.$1;
    _selectNextAfterGroup(items, _selectedGroup, order);
    // No item is left to select.
    if (_selected == first?.$2.ref) {
      _selected = null;
      _selectedGroup = null;
    }
  }

  void _replace(TriageItem fresh) {
    List<TriageItem> replaced(List<TriageItem> items) => [
      for (final i in items) i.ref == fresh.ref ? fresh : i,
    ];
    _queue = replaced(_queue);
    _opened = replaced(_opened);
    if (_linked.containsKey(fresh.ref)) _linked[fresh.ref] = fresh;
  }

  Future<void> _openPending() async {
    final GitHubItem? pending = _pendingOpen;
    _pendingOpen = null;
    if (pending != null && isConnected) await open(pending);
  }

  Future<void> _load(
    Future<void> Function() body, {
    Future<void> Function()? then,
  }) async {
    _loads++;
    _error = null;
    notifyListeners();
    try {
      await body();
    } on GitHubException catch (e) {
      _error = e.message;
    } on Object catch (e) {
      _error = '$e';
    } finally {
      _loads--;
      notifyListeners();
    }
    await then?.call();
  }

  /// [items] in the order `ui.blueprint.md` lists them: by kind, then the
  /// items with an analysis first, then the least recently updated first.
  List<TriageItem> _sorted(Iterable<TriageItem> items) {
    DateTime updatedAt(TriageItem i) => _listedUpdatedAt[i.ref] ?? i.updatedAt;
    int withoutAnalysis(TriageItem i) => i.analysis == null ? 1 : 0;
    return items.toList()..sort(
      (a, b) => a.kind != b.kind
          ? a.kind.index.compareTo(b.kind.index)
          : withoutAnalysis(a) != withoutAnalysis(b)
          ? withoutAnalysis(a).compareTo(withoutAnalysis(b))
          : updatedAt(a).compareTo(updatedAt(b)),
    );
  }

  /// Notifies the listeners, unless the controller is disposed: loads and
  /// applies can end after that.
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final AnalysisDraft draft in _drafts.values) {
      draft.dispose();
    }
    super.dispose();
  }
}
