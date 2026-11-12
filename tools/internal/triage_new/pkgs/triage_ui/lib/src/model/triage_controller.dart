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
import 'package:triage/triage.dart';

import '../github/github_client.dart';
import '../github/triage_service.dart';
import '../github_item.dart';
import 'applier.dart';
import 'log_entry.dart';
import 'milestone_change.dart';
import 'suggestion_draft.dart';
import 'triage_item.dart';
import 'triage_session.dart';

/// A group of the item list, as `ui.blueprint.md` describes. An item can be
/// in two groups: its own and [teamInput].
enum ItemGroup {
  /// **New**: the items in the queue without `status: needs-team-input` when
  /// they were loaded.
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
  /// were loaded. The **New** group shows the other items in the queue.
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

  /// The items that [hideTriaged] took out of each group, until a refresh.
  Set<(ItemGroup, ItemRef)> _hidden = const {};

  /// The repositories whose items the UI triages.
  static const List<String> repositories = [a2uiRepository, genuiRepository];

  Map<String, RepositoryInfo> _repositoryInfo = const {};

  /// The labels, assignable people and milestones of [repository].
  RepositoryInfo repositoryInfo(String repository) =>
      _repositoryInfo[repository] ?? const RepositoryInfo();

  bool _loading = false;

  /// Whether the items are being loaded.
  bool get loading => _loading;

  String? _error;

  /// The last error, until [dismissError].
  String? get error => _error;

  /// Whether the controller reached GitHub and loaded the items once.
  bool get isConnected => _service != null;

  ItemRef? _selected;

  /// The group in which the triager selected [_selected], or null for the
  /// first group that has it.
  ItemGroup? _selectedGroup;

  GitHubItem? _pendingOpen;

  final Set<ItemRef> _changedOnGitHub = {};
  final Map<ItemRef, SuggestionDraft> _drafts = {};
  final Map<ItemRef, ApplyResult> _results = {};
  final Map<ItemRef, List<LogEntry>> _logs = {};
  final Set<ItemRef> _applying = {};

  /// The items in the **New** group, in the order the list shows them.
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
      if (session.isHandled(i.ref) && !_belongsTo(g, i)) (g, i),
  ];

  /// Whether [hideTriaged] has items to hide.
  bool get hasTriaged => _triaged.isNotEmpty;

  /// Takes out of each group the items that the triager applied a
  /// suggestion to and that no longer belong to it, until a refresh. An
  /// item sent to the team leaves **New** and stays in **Needs team
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
    notifyListeners();
  }

  /// Whether [item], as it is now, belongs to [group], as `ui.blueprint.md`
  /// defines the groups.
  static bool _belongsTo(ItemGroup group, TriageItem item) {
    final bool queued =
        item.isOpen &&
        (item.isPullRequest || item.repository == a2uiRepository) &&
        (item.needsTriage || item.needsTeamInput);
    return switch (group) {
      ItemGroup.newItems => queued && !item.needsTeamInput,
      ItemGroup.teamInput => queued && item.needsTeamInput,
      ItemGroup.notInQueue => !queued,
    };
  }

  /// How many items are in the queue: the items in **New** and **Needs team
  /// input** when they loaded.
  int get queueLength => _queue.length;

  /// How many items in the queue the triager did not apply a suggestion to.
  int get remaining => _queue.where((i) => !session.isHandled(i.ref)).length;

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
  /// by URL, loaded by [loadLinked] and [closedAs].
  final Map<ItemRef, TriageItem> _linked = {};

  /// "merged" if [ref] refers to a merged pull request, "closed" if the
  /// item is closed otherwise, and null if it is open or not known yet.
  ///
  /// An item that is not loaded is loaded in the background, and the
  /// controller notifies its listeners once it is.
  String? closedAs(ItemRef ref) {
    if (item(ref) ?? _linked[ref] case final TriageItem i) {
      return i.isMerged
          ? 'merged'
          : i.isOpen
          ? null
          : 'closed';
    }
    if (_service != null) {
      unawaited(_linkedFetches.putIfAbsent(ref, () => _fetch(ref)));
    }
    return null;
  }

  /// The fetches that [loadLinked] and [closedAs] started, by item.
  final Map<ItemRef, Future<void>> _linkedFetches = {};

  /// [item] and all the items linked to it, whether or not they need
  /// triage, which the details show as tabs and apply together.
  ///
  /// A linked item that is not loaded yet is left out, and loaded in the
  /// background; the group includes it once it is.
  List<TriageItem> group(TriageItem item) {
    final List<ItemRef> linked = [
      for (final n in item.linkedItems) item.refTo(n),
    ];
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
    for (final n in item.linkedItems)
      if (item.refTo(n) case final ItemRef r when this.item(r) == null)
        _linkedFetches.putIfAbsent(r, () => _fetch(r)),
  ]);

  Future<void> _fetch(ItemRef ref) async {
    try {
      if (await _service!.fetchItem(ref) case final TriageItem linked) {
        _linked[ref] = linked;
        notifyListeners();
      }
    } on GitHubException {
      // Tried again after a refresh.
    }
  }

  /// Whether a refresh found that [item] changed on GitHub, which reset its
  /// draft.
  bool changedOnGitHub(ItemRef item) => _changedOnGitHub.contains(item);

  bool isApplying(ItemRef item) => _applying.contains(item);

  ApplyResult? lastResult(ItemRef item) => _results[item];

  /// What the tool did to [item] in this session, and what it found out
  /// about it, oldest first. Kept across refreshes.
  List<LogEntry> logOf(ItemRef item) => _logs[item] ?? const [];

  void _log(ItemRef item, LogEntry entry) => (_logs[item] ??= []).add(entry);

  /// The draft for [item], which starts as [initial], or as the item's
  /// suggestion if [initial] is null, and removes `status: needs-triage`
  /// if the item has it.
  SuggestionDraft draftFor(TriageItem item, [TriageSuggestion? initial]) =>
      _drafts.putIfAbsent(
        item.ref,
        () => SuggestionDraft(
          _withoutNeedsTriage(
            item,
            initial ?? item.suggestion?.suggestion ?? const TriageSuggestion(),
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
    final List<TriageItem> queue = await service.fetchQueue();
    final Set<ItemRef> inQueue = {for (final i in queue) i.ref};
    final opened = <TriageItem>[];
    for (final TriageItem i in _opened) {
      if (inQueue.contains(i.ref)) continue;
      final TriageItem? fresh = await service.fetchItem(i.ref);
      if (fresh != null) opened.add(fresh);
    }

    final Map<ItemRef, TriageItem> old = {
      for (final i in [..._queue, ..._opened]) i.ref: i,
    };
    _changedOnGitHub.clear();
    for (final i in [...queue, ...opened]) {
      final TriageItem? before = old[i.ref];
      if (before != null && before.updatedAt != i.updatedAt) {
        _changedOnGitHub.add(i.ref);
        _drafts.remove(i.ref)?.dispose();
        _results.remove(i.ref);
        _log(
          i.ref,
          LogEntry(
            'A refresh found that the item changed on GitHub, and reset '
            'its suggestion to the current state',
          ),
        );
      }
    }
    _setQueue(queue);
    _opened = opened;
    // Loaded again when the triager selects an item linked to them.
    _linked.clear();
    _linkedFetches.clear();
  });

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
    notifyListeners();
  }

  /// Selects nothing.
  void deselect() {
    _selected = null;
    _selectedGroup = null;
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
  /// If one of [items] is selected, selects the next item that is not
  /// handled yet right away, so that the triager can go on while the
  /// applies run. A failed item shows it in the list.
  Future<void> applyAll(List<TriageItem> items) async {
    final List<TriageItem> changed = [
      for (final i in items)
        if (draftFor(i).hasChanges) i,
    ];
    // Mark them all first, so that the next item is none of them.
    _applying.addAll(changed.map((i) => i.ref));
    _selectNextAfterGroup(items, selectedGroup, _listed);
    notifyListeners();
    for (final i in changed) {
      await _applyOne(i);
    }
  }

  /// Applies the draft for [item].
  Future<void> _applyOne(TriageItem item) async {
    final ItemRef n = item.ref;
    final TriageSuggestion suggestion = _drafts[n]!.toSuggestion();
    final MilestoneChange milestone = _drafts[n]!.milestoneChange;
    _applying.add(n);
    _results.remove(n);
    notifyListeners();

    final ApplyResult result = await applySuggestion(
      _service!,
      item,
      suggestion,
      replyPosted: session.hasReplied(n),
      onReplyPosted: () => session.recordReplied(n),
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
      session.recordApplied(item, suggestion);
      if (suggestion.addedLabels.contains(needsTeamInputLabel)) {
        _addToTeamInput(item);
      }
    }
    await _finish(n);
  }

  /// Adds `status: needs-triage` to the labels that [suggestion] removes,
  /// if [item] has the label.
  static TriageSuggestion _withoutNeedsTriage(
    TriageItem item,
    TriageSuggestion suggestion,
  ) => item.needsTriage ? _removing(suggestion, needsTriageLabel) : suggestion;

  /// [suggestion], removing [label] too.
  static TriageSuggestion _removing(TriageSuggestion suggestion, String label) {
    if (suggestion.removedLabels.contains(label)) return suggestion;
    return TriageSuggestion(
      summary: suggestion.summary,
      reason: suggestion.reason,
      suggestion: suggestion.suggestion,
      reply: suggestion.reply,
      closeAs: suggestion.closeAs,
      duplicateOf: suggestion.duplicateOf,
      addedLabels: suggestion.addedLabels,
      removedLabels: [...suggestion.removedLabels, label],
      newAssignees: suggestion.newAssignees,
      removedAssignees: suggestion.removedAssignees,
      relatedIssues: suggestion.relatedIssues,
      relatedPrs: suggestion.relatedPrs,
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
    } on GitHubException {
      // The item keeps its old state until the next refresh.
    }
    _applying.remove(item);
    notifyListeners();
  }

  void _setQueue(List<TriageItem> queue) {
    _queue = queue;
    _loadedTeamInput = {
      for (final i in queue)
        if (i.needsTeamInput) i.ref,
    };
    _teamInput = _loadedTeamInput;
    _hidden = const {};
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
    final Iterable<(ItemGroup, TriageItem)> candidates = [
      ...order.skip(index + 1),
      ...order.take(index),
    ];
    for (final (ItemGroup g, TriageItem i) in candidates) {
      if (!session.isHandled(i.ref) && !isApplying(i.ref)) {
        _selected = i.ref;
        _selectedGroup = g;
        _revealCount++;
        return;
      }
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
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      await body();
    } on GitHubException catch (e) {
      _error = e.message;
    }
    _loading = false;
    notifyListeners();
    await then?.call();
  }

  /// [items] in the order `ui.blueprint.md` lists them: by kind, then the
  /// items with a suggestion first, then the least recently updated first.
  List<TriageItem> _sorted(Iterable<TriageItem> items) {
    DateTime updatedAt(TriageItem i) => _listedUpdatedAt[i.ref] ?? i.updatedAt;
    int withoutSuggestion(TriageItem i) => i.suggestion == null ? 1 : 0;
    return items.toList()..sort(
      (a, b) => a.kind != b.kind
          ? a.kind.index.compareTo(b.kind.index)
          : withoutSuggestion(a) != withoutSuggestion(b)
          ? withoutSuggestion(a).compareTo(withoutSuggestion(b))
          : updatedAt(a).compareTo(updatedAt(b)),
    );
  }

  @override
  void dispose() {
    for (final SuggestionDraft draft in _drafts.values) {
      draft.dispose();
    }
    super.dispose();
  }
}
