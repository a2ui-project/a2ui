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

import 'package:flutter/foundation.dart';
import 'package:triage/triage.dart';

import '../github/github_client.dart';
import '../github/triage_service.dart';
import '../github_item.dart';
import 'applier.dart';
import 'genui_pull_request.dart';
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

  /// The items with `status: needs-triage` or `status: needs-team-input`.
  List<TriageItem> _queue = const [];

  /// The items in [_queue] that the list shows under **Needs team input**:
  /// the ones that had `status: needs-team-input` when they were loaded, and
  /// the ones that the triager sent to the team since. An item stays in its
  /// group until a refresh, even if the triager removes the label.
  Set<int> _teamInput = const {};

  /// When each item in [_queue] was last updated, as of the last load. The
  /// list is ordered by these times, so that the triager's own changes do
  /// not move items until a refresh.
  Map<int, DateTime> _listedUpdatedAt = const {};

  /// Items opened by URL that are not in the queue.
  List<TriageItem> _opened = const [];

  List<GenuiPullRequest> _genuiPullRequests = const [];

  /// The open pull requests in `flutter/genui` that need triage, least
  /// recently updated first. The tool shows them, but does not triage them.
  List<GenuiPullRequest> get genuiPullRequests => _genuiPullRequests;

  RepositoryInfo _repositoryInfo = const RepositoryInfo();
  RepositoryInfo get repositoryInfo => _repositoryInfo;

  bool _loading = false;

  /// Whether the items are being loaded.
  bool get loading => _loading;

  String? _error;

  /// The last error, until [dismissError].
  String? get error => _error;

  /// Whether the controller reached GitHub and loaded the items once.
  bool get isConnected => _service != null;

  int? _selected;

  /// The number of the selected pull request in `flutter/genui`. At most
  /// one of [_selected] and [_selectedGenui] is set.
  int? _selectedGenui;
  GitHubItem? _pendingOpen;

  final Set<int> _changedOnGitHub = {};
  final Map<int, SuggestionDraft> _drafts = {};
  final Map<int, ApplyResult> _results = {};
  final Set<int> _applying = {};

  /// The items in the **New** group, in the order the list shows them.
  List<TriageItem> get newItems =>
      _sorted(_queue.where((i) => !_teamInput.contains(i.number)));

  /// The items in the **Needs team input** group, in the order the list
  /// shows them.
  List<TriageItem> get teamInputItems =>
      _sorted(_queue.where((i) => _teamInput.contains(i.number)));

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
  int get remaining => _queue.where((i) => !session.isHandled(i.number)).length;

  TriageItem? get selected => _selected == null ? null : item(_selected!);

  /// The selected pull request in `flutter/genui`, or null.
  GenuiPullRequest? get selectedGenuiPullRequest {
    for (final GenuiPullRequest pr in _genuiPullRequests) {
      if (pr.number == _selectedGenui) return pr;
    }
    return null;
  }

  var _revealCount = 0;

  /// Grows each time the controller selects an item on its own, such as an
  /// item opened by URL or the next item after an apply, so that the list
  /// shows the selected item even if it is in a collapsed group or
  /// scrolled out of view.
  int get revealCount => _revealCount;

  /// The loaded item with [number], or null.
  TriageItem? item(int number) {
    for (final TriageItem i in [..._queue, ..._opened]) {
      if (i.number == number) return i;
    }
    return null;
  }

  /// The items in the queue that [item] is linked to and that need triage
  /// or team input.
  List<TriageItem> relatedInQueue(TriageItem item) => [
    for (final TriageItem i in _queue)
      if (item.linkedItems.contains(i.number) &&
          (i.needsTriage || i.needsTeamInput))
        i,
  ];

  /// Whether a refresh found that [number] changed on GitHub, which reset
  /// its draft.
  bool changedOnGitHub(int number) => _changedOnGitHub.contains(number);

  bool isApplying(int number) => _applying.contains(number);

  ApplyResult? lastResult(int number) => _results[number];

  /// The draft for [item], which starts as [initial].
  SuggestionDraft draftFor(TriageItem item, TriageSuggestion initial) =>
      _drafts.putIfAbsent(item.number, () => SuggestionDraft(initial));

  /// The session report.
  String report() => session.report(stillNeedTriage: remaining);

  void dismissError() {
    _error = null;
    notifyListeners();
  }

  /// Connects to GitHub and loads the items.
  Future<void> start() => _load(() async {
    final TriageService service = await _connect();
    final (
      RepositoryInfo info,
      List<TriageItem> queue,
      List<GenuiPullRequest> genui,
    ) = await (
      service.fetchRepositoryInfo(),
      service.fetchQueue(),
      service.fetchGenuiPullRequests(),
    ).wait;
    _service = service;
    _repositoryInfo = info;
    _setQueue(queue);
    _setGenuiPullRequests(genui);
  }, then: _openPending);

  /// Loads the queue again, the items opened by URL and the pull requests in
  /// `flutter/genui`.
  ///
  /// Resets the drafts of the items that changed on GitHub, so that the
  /// triager sees their current state.
  Future<void> refresh() => _load(() async {
    final TriageService service = _service!;
    final (List<TriageItem> queue, List<GenuiPullRequest> genui) = await (
      service.fetchQueue(),
      service.fetchGenuiPullRequests(),
    ).wait;
    final Set<int> inQueue = {for (final i in queue) i.number};
    final opened = <TriageItem>[];
    for (final TriageItem i in _opened) {
      if (inQueue.contains(i.number)) continue;
      final TriageItem? fresh = await service.fetchItem(i.number);
      if (fresh != null) opened.add(fresh);
    }

    final Map<int, TriageItem> old = {
      for (final i in [..._queue, ..._opened]) i.number: i,
    };
    _changedOnGitHub.clear();
    for (final i in [...queue, ...opened]) {
      final TriageItem? before = old[i.number];
      if (before != null && before.updatedAt != i.updatedAt) {
        _changedOnGitHub.add(i.number);
        _drafts.remove(i.number)?.dispose();
        _results.remove(i.number);
      }
    }
    _setQueue(queue);
    _opened = opened;
    _setGenuiPullRequests(genui);
  });

  /// Selects [item], loading it first if it is not loaded.
  Future<void> open(GitHubItem item) async {
    if (!isConnected) {
      // Opened when the items are loaded.
      _pendingOpen = item;
      return;
    }
    if (this.item(item.number) == null) {
      await _load(() async {
        final TriageItem? fetched = await _service!.fetchItem(item.number);
        if (fetched == null) {
          throw GitHubException('${item.url} does not exist.');
        }
        _opened = [..._opened, fetched];
      });
    }
    if (this.item(item.number) != null) {
      _revealCount++;
      select(item.number);
    }
  }

  void select(int number) {
    _selected = number;
    _selectedGenui = null;
    notifyListeners();
  }

  /// Selects the pull request in `flutter/genui` with [number].
  void selectGenuiPullRequest(int number) {
    _selected = null;
    _selectedGenui = number;
    notifyListeners();
  }

  /// Selects nothing.
  void deselect() {
    _selected = null;
    _selectedGenui = null;
    notifyListeners();
  }

  /// Applies the draft for [item] to it on GitHub.
  ///
  /// If the item has `status: needs-team-input` and the draft does not add
  /// it, also removes the label, since the item is triaged.
  ///
  /// On success, records the item in the session and, if it is selected,
  /// selects the next item that is not handled yet.
  Future<void> apply(TriageItem item) async {
    final int n = item.number;
    final TriageSuggestion suggestion = _withoutTeamInput(
      item,
      _drafts[n]!.toSuggestion(),
    );
    _applying.add(n);
    _results.remove(n);
    notifyListeners();

    final ApplyResult result = await applySuggestion(
      _service!,
      item,
      suggestion,
      replyPosted: session.hasReplied(n),
      onReplyPosted: () => session.recordReplied(n),
      milestones: _repositoryInfo.milestones,
    );
    _results[n] = result;
    if (result.succeeded) {
      session.recordApplied(item, suggestion);
      if (_selected == n) _selectNextAfter(n);
      if (suggestion.addedLabels.contains(needsTeamInputLabel)) {
        _moveToTeamInput(item);
      }
    }
    await _finish(n);
  }

  /// Sends [item] to the team: adds `status: needs-team-input` and posts
  /// [comment], if the triager wrote one. Does not apply the draft.
  ///
  /// On success, records the item in the session, moves it to the
  /// **Needs team input** group and, if it is selected, selects the next
  /// item that is not handled yet.
  Future<void> sendToTeam(TriageItem item, {String? comment}) async {
    final int n = item.number;
    _applying.add(n);
    _results.remove(n);
    _error = null;
    notifyListeners();

    try {
      await _service!.addLabels(n, const [needsTeamInputLabel]);
    } on GitHubException catch (e) {
      _error = 'Could not add "$needsTeamInputLabel" to #$n: ${e.message}';
      await _finish(n);
      return;
    }
    var commented = comment != null;
    if (comment != null) {
      try {
        await _service!.postComment(n, comment);
      } on GitHubException catch (e) {
        commented = false;
        _error =
            'Added "$needsTeamInputLabel" to #$n, but could not post the '
            'comment: ${e.message}';
      }
    }
    session.recordSentToTeam(item, comment: commented ? comment : null);
    if (_selected == n) _selectNextAfter(n);
    _moveToTeamInput(item);
    await _finish(n);
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
      suggestion: suggestion.suggestion,
      reply: suggestion.reply,
      closeAs: suggestion.closeAs,
      duplicateOf: suggestion.duplicateOf,
      addedLabels: suggestion.addedLabels,
      removedLabels: [...suggestion.removedLabels, needsTeamInputLabel],
      newAssignees: suggestion.newAssignees,
      removedAssignees: suggestion.removedAssignees,
      newMilestone: suggestion.newMilestone,
      removedMilestone: suggestion.removedMilestone,
      relatedIssues: suggestion.relatedIssues,
      relatedPrs: suggestion.relatedPrs,
    );
  }

  /// Moves [item] to the **Needs team input** group, from the queue or from
  /// the items opened by URL.
  void _moveToTeamInput(TriageItem item) {
    final int n = item.number;
    if (this.item(n) != null && !_queue.any((i) => i.number == n)) {
      _opened = [
        for (final i in _opened)
          if (i.number != n) i,
      ];
      _queue = [..._queue, item];
    }
    _teamInput = {..._teamInput, n};
    _listedUpdatedAt = {n: item.updatedAt, ..._listedUpdatedAt};
  }

  /// Loads the item with [number] again, and ends its apply.
  Future<void> _finish(int number) async {
    // Show the item as it is now, so that a refresh does not take the
    // triager's own changes for someone else's.
    try {
      final TriageItem? fresh = await _service!.fetchItem(number);
      if (fresh != null) _replace(fresh);
    } on GitHubException {
      // The item keeps its old state until the next refresh.
    }
    _applying.remove(number);
    notifyListeners();
  }

  void _setQueue(List<TriageItem> queue) {
    _queue = queue;
    _teamInput = {
      for (final i in queue)
        if (i.needsTeamInput) i.number,
    };
    _listedUpdatedAt = {for (final i in queue) i.number: i.updatedAt};
  }

  void _setGenuiPullRequests(List<GenuiPullRequest> pullRequests) {
    _genuiPullRequests = pullRequests.toList()
      ..sort((a, b) => a.updatedAt.compareTo(b.updatedAt));
  }

  void _selectNextAfter(int number) {
    final List<TriageItem> items = orderedItems;
    final int index = items.indexWhere((i) => i.number == number);
    final Iterable<TriageItem> candidates = [
      ...items.skip(index + 1),
      ...items.take(index),
    ];
    for (final i in candidates) {
      if (!session.isHandled(i.number)) {
        _selected = i.number;
        _selectedGenui = null;
        _revealCount++;
        return;
      }
    }
  }

  void _replace(TriageItem fresh) {
    List<TriageItem> replaced(List<TriageItem> items) => [
      for (final i in items) i.number == fresh.number ? fresh : i,
    ];
    _queue = replaced(_queue);
    _opened = replaced(_opened);
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
    DateTime updatedAt(TriageItem i) =>
        _listedUpdatedAt[i.number] ?? i.updatedAt;
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
