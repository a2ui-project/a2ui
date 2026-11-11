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
import 'milestone_change.dart';
import 'suggestion_draft.dart';
import 'triage_item.dart';
import 'triage_session.dart';

/// The state of the triage UI: the items, the selected one, the triager's
/// drafts and what the triager applied.
class TriageController extends ChangeNotifier {
  /// [connect] finds the triager's GitHub token and returns the service that
  /// uses it.
  TriageController({required Future<TriageService> Function() connect})
    : _connect = connect;

  final Future<TriageService> Function() _connect;
  TriageService? _service;

  final TriageSession session = TriageSession();

  /// The items with `status: needs-triage` or `status: needs-team-input`,
  /// from all the repositories the UI triages.
  List<TriageItem> _queue = const [];

  /// The items in [_queue] that the list shows under **Needs team input**:
  /// the ones that had `status: needs-team-input` when they were loaded, and
  /// the ones that the triager sent to the team since. An item stays in its
  /// group until a refresh, even if the triager removes the label.
  Set<ItemRef> _teamInput = const {};

  /// When each item in [_queue] was last updated, as of the last load. The
  /// list is ordered by these times, so that the triager's own changes do
  /// not move items until a refresh.
  Map<ItemRef, DateTime> _listedUpdatedAt = const {};

  /// Items opened by URL that are not in the queue.
  List<TriageItem> _opened = const [];

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
  GitHubItem? _pendingOpen;

  final Set<ItemRef> _changedOnGitHub = {};
  final Map<ItemRef, SuggestionDraft> _drafts = {};
  final Map<ItemRef, ApplyResult> _results = {};
  final Set<ItemRef> _applying = {};

  /// The items in the **New** group, in the order the list shows them.
  List<TriageItem> get newItems =>
      _sorted(_queue.where((i) => !_teamInput.contains(i.ref)));

  /// The items in the **Needs team input** group, in the order the list
  /// shows them.
  List<TriageItem> get teamInputItems =>
      _sorted(_queue.where((i) => _teamInput.contains(i.ref)));

  /// The items opened by URL that are not in the queue, in the order the
  /// triager opened them.
  List<TriageItem> get opened => _opened;

  /// All items, in the order the list shows them.
  List<TriageItem> get orderedItems => [
    ...newItems,
    ...teamInputItems,
    ..._opened,
  ];

  /// How many items in the queue the triager neither applied a suggestion
  /// to nor sent to the team.
  int get remaining => _queue.where((i) => !session.isHandled(i.ref)).length;

  TriageItem? get selected => _selected == null ? null : item(_selected!);

  var _revealCount = 0;

  /// Grows each time the controller selects an item on its own, such as an
  /// item opened by URL or the next item after an apply, so that the list
  /// shows the selected item even if it is in a collapsed group or
  /// scrolled out of view.
  int get revealCount => _revealCount;

  /// The loaded item that [ref] refers to, or null.
  TriageItem? item(ItemRef ref) {
    for (final TriageItem i in [..._queue, ..._opened]) {
      if (i.ref == ref) return i;
    }
    return null;
  }

  /// The items in the queue that [item] is linked to and that need triage
  /// or team input.
  List<TriageItem> relatedInQueue(TriageItem item) => [
    for (final TriageItem i in _queue)
      if (i.repository == item.repository &&
          item.linkedItems.contains(i.number) &&
          (i.needsTriage || i.needsTeamInput))
        i,
  ];

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

  /// The draft for [item], which starts as [initial], or as the item's
  /// suggestion if [initial] is null.
  SuggestionDraft draftFor(TriageItem item, [TriageSuggestion? initial]) =>
      _drafts.putIfAbsent(
        item.ref,
        () => SuggestionDraft(
          initial ?? item.suggestion?.suggestion ?? const TriageSuggestion(),
        ),
      );

  /// Undoes the triager's changes to the drafts of [items].
  void revert(List<TriageItem> items) {
    for (final i in items) {
      draftFor(i).revert();
    }
  }

  /// The session report.
  String report() => session.report(stillNeedTriage: remaining);

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

  void select(ItemRef item) {
    _selected = item;
    notifyListeners();
  }

  /// Selects nothing.
  void deselect() {
    _selected = null;
    notifyListeners();
  }

  /// Applies the draft for [item] to it on GitHub.
  ///
  /// If the item has `status: needs-team-input` and the draft does not add
  /// it, also removes the label, since the item is triaged.
  ///
  /// On success, records the item in the session and, if it is selected,
  /// selects the next item that is not handled yet.
  Future<void> apply(TriageItem item) => applyAll([item]);

  /// Applies the drafts of [items], one after another, skipping the drafts
  /// that change nothing. An item whose apply fails does not stop the
  /// others.
  ///
  /// If every apply succeeds and one of [items] is selected, selects the
  /// next item that is not handled yet.
  Future<void> applyAll(List<TriageItem> items) async {
    final List<TriageItem> order = orderedItems;
    var succeeded = true;
    for (final i in items) {
      if (!draftFor(i).hasChanges) continue;
      if (!await _applyOne(i)) succeeded = false;
    }
    if (succeeded) _selectNextAfterGroup(items, order);
    notifyListeners();
  }

  /// Applies the draft for [item], and returns whether it succeeded.
  Future<bool> _applyOne(TriageItem item) async {
    final ItemRef n = item.ref;
    final TriageSuggestion suggestion = _withoutTeamInput(
      item,
      _drafts[n]!.toSuggestion(),
    );
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
    if (result.succeeded) {
      session.recordApplied(item, suggestion, milestone: milestone);
      if (suggestion.addedLabels.contains(needsTeamInputLabel)) {
        _moveToTeamInput(item);
      }
    }
    await _finish(n);
    return result.succeeded;
  }

  /// Sends [item] to the team: adds `status: needs-team-input` and posts
  /// [comment], if the triager wrote one. Does not apply the draft.
  ///
  /// On success, records the item in the session, moves it to the
  /// **Needs team input** group and, if it is selected, selects the next
  /// item that is not handled yet.
  Future<void> sendToTeam(TriageItem item, {String? comment}) =>
      sendAllToTeam([item], comment: comment);

  /// Sends those of [items] that do not have `status: needs-team-input` to
  /// the team, each with [comment], as [sendToTeam] does.
  Future<void> sendAllToTeam(List<TriageItem> items, {String? comment}) async {
    final List<TriageItem> order = orderedItems;
    var succeeded = true;
    for (final i in items) {
      if (i.needsTeamInput) continue;
      if (!await _sendOne(i, comment: comment)) succeeded = false;
    }
    if (succeeded) _selectNextAfterGroup(items, order);
    notifyListeners();
  }

  /// Sends [item] to the team, and returns whether it succeeded.
  Future<bool> _sendOne(TriageItem item, {String? comment}) async {
    final ItemRef n = item.ref;
    _applying.add(n);
    _results.remove(n);
    _error = null;
    notifyListeners();

    try {
      await _service!.addLabels(n, const [needsTeamInputLabel]);
    } on GitHubException catch (e) {
      _error =
          'Could not add "$needsTeamInputLabel" to ${item.name}: '
          '${e.message}';
      await _finish(n);
      return false;
    }
    var commented = comment != null;
    if (comment != null) {
      try {
        await _service!.postComment(n, comment);
      } on GitHubException catch (e) {
        commented = false;
        _error =
            'Added "$needsTeamInputLabel" to ${item.name}, but could not '
            'post the comment: ${e.message}';
      }
    }
    session.recordSentToTeam(item, comment: commented ? comment : null);
    _moveToTeamInput(item);
    await _finish(n);
    return true;
  }

  /// Adds `status: needs-team-input` to the labels that [suggestion]
  /// removes, if [item] has the label and [suggestion] does not add it.
  static TriageSuggestion _withoutTeamInput(
    TriageItem item,
    TriageSuggestion suggestion,
  ) {
    if (!item.needsTeamInput ||
        suggestion.addedLabels.contains(needsTeamInputLabel) ||
        suggestion.removedLabels.contains(needsTeamInputLabel)) {
      return suggestion;
    }
    return TriageSuggestion(
      summary: suggestion.summary,
      reason: suggestion.reason,
      suggestion: suggestion.suggestion,
      reply: suggestion.reply,
      closeAs: suggestion.closeAs,
      duplicateOf: suggestion.duplicateOf,
      addedLabels: suggestion.addedLabels,
      removedLabels: [...suggestion.removedLabels, needsTeamInputLabel],
      newAssignees: suggestion.newAssignees,
      removedAssignees: suggestion.removedAssignees,
      relatedIssues: suggestion.relatedIssues,
      relatedPrs: suggestion.relatedPrs,
    );
  }

  /// Moves [item] to the **Needs team input** group, from the queue or from
  /// the items opened by URL.
  void _moveToTeamInput(TriageItem item) {
    final ItemRef n = item.ref;
    if (this.item(n) != null && !_queue.any((i) => i.ref == n)) {
      _opened = [
        for (final i in _opened)
          if (i.ref != n) i,
      ];
      _queue = [..._queue, item];
    }
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
    _teamInput = {
      for (final i in queue)
        if (i.needsTeamInput) i.ref,
    };
    _listedUpdatedAt = {for (final i in queue) i.ref: i.updatedAt};
  }

  /// If one of [items] is selected, selects the next item after them that
  /// is not handled yet, in [order]: the list as it was before the items
  /// changed, since a change can move an item to another group.
  void _selectNextAfterGroup(List<TriageItem> items, List<TriageItem> order) {
    if (items.any((i) => i.ref == _selected)) {
      _selectNextAfter(items.first.ref, order);
    }
  }

  void _selectNextAfter(ItemRef item, List<TriageItem> items) {
    final int index = items.indexWhere((i) => i.ref == item);
    final Iterable<TriageItem> candidates = [
      ...items.skip(index + 1),
      ...items.take(index),
    ];
    for (final i in candidates) {
      if (!session.isHandled(i.ref)) {
        _selected = i.ref;
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
