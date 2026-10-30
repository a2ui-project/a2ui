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

import Combine
import OrderedCollections
import OrderedJSON

/// The state of the calls a surface routed to the agent from its bindings, checks and actions.
///
/// ``SurfaceViewModel`` owns one, shared by every ``DataContext`` that evaluates against the
/// surface and by its ``NodeResolver``: a call is sent once, and every evaluation of the same call
/// reads its result once the agent answers. It keeps at most ``maximumEntryCount`` settled calls,
/// dropping the oldest first; a pending call is never dropped.
@MainActor
final class AgentCallCache {
  /// The state of one call.
  enum State {
    /// The call awaits the agent's response.
    ///
    /// `settlement` finishes once the call has settled into the cache, with whether the agent
    /// answered it. `isRequestedDirectly` tells whether an evaluation outside a node resolution
    /// pass, such as an action or a direct ``DataContext`` caller, asked for the call.
    case pending(settlement: Task<Bool, Never>, isRequestedDirectly: Bool)
    /// The agent answered the call with a value.
    case answered(JSONValue)
    /// The agent answered the call with an error, or it timed out. The error has been reported.
    case failed
  }

  /// The maximum number of settled calls kept.
  static let maximumEntryCount = 256

  private var states: OrderedDictionary<AgentFunctionCall, State> = [:]

  /// Publishes each call the agent answers with a value, after the cache holds the value.
  let answeredCallSubject = PassthroughSubject<AgentFunctionCall, Never>()

  /// The state of `call`, or `nil` if the cache knows nothing about it.
  subscript(call: AgentFunctionCall) -> State? {
    states[call]
  }

  /// Records that `call` was sent to the agent.
  ///
  /// - Parameters:
  ///   - call: The call sent.
  ///   - settlement: A task that finishes once the call has settled into this cache.
  ///   - isRequestedDirectly: Whether an evaluation outside a node resolution pass sent it.
  func markPending(
    _ call: AgentFunctionCall,
    settlement: Task<Bool, Never>,
    isRequestedDirectly: Bool
  ) {
    states.removeValue(forKey: call)
    evictIfFull()
    states[call] = .pending(settlement: settlement, isRequestedDirectly: isRequestedDirectly)
  }

  /// Records that an evaluation outside a node resolution pass asked for the pending `call`.
  func markRequestedDirectly(_ call: AgentFunctionCall) {
    guard case .pending(let settlement, false) = states[call] else { return }
    states[call] = .pending(settlement: settlement, isRequestedDirectly: true)
  }

  /// Records the agent's value for `call` and publishes it on ``answeredCallSubject``.
  func answer(_ call: AgentFunctionCall, with value: JSONValue) {
    states.removeValue(forKey: call)
    evictIfFull()
    states[call] = .answered(value)
    answeredCallSubject.send(call)
  }

  /// Records that `call` failed.
  func fail(_ call: AgentFunctionCall) {
    states.removeValue(forKey: call)
    evictIfFull()
    states[call] = .failed
  }

  /// Forgets that `call` failed, so that it is sent again the next time it is made.
  func forgetFailure(_ call: AgentFunctionCall) {
    guard case .failed = states[call] else { return }
    states.removeValue(forKey: call)
  }

  /// Removes `call` from the cache so that the next evaluation sends it again.
  func forget(_ call: AgentFunctionCall) {
    states.removeValue(forKey: call)
  }

  /// Waits until `call` has settled in this cache.
  ///
  /// - Returns: Whether the agent answered the call with a value; `false` after a failure or if
  ///   the call was never sent.
  func awaitSettlement(of call: AgentFunctionCall) async -> Bool {
    switch states[call] {
    case .pending(let settlement, _):
      return await settlement.value
    case .answered:
      return true
    case .failed, nil:
      return false
    }
  }

  /// Forgets every call. Calls still pending settle into nothing.
  func removeAll() {
    states.removeAll()
  }

  /// Drops the oldest settled call when the cache is full.
  private func evictIfFull() {
    guard states.count >= Self.maximumEntryCount else { return }
    let oldestSettled = states.elements.firstIndex { element in
      if case .pending = element.value { return false }
      return true
    }
    if let oldestSettled {
      states.remove(at: oldestSettled)
    }
  }
}
