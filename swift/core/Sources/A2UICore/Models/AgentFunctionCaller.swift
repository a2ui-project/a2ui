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

import OrderedJSON

/// Sends a function call to the agent and returns the agent's result.
///
/// ``MessageProcessor`` installs one on each v1.0 surface while it has an `outboundListener`; it
/// dispatches `callAgentFunction` through the processor's ``RPCHandler`` and throws when the agent
/// answers with an error or the call times out.
public typealias AgentFunctionCaller =
  @MainActor @Sendable (AgentFunctionCall) async throws -> JSONValue
