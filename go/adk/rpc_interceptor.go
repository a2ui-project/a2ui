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

package adk

import (
	"slices"
	"sync"

	"github.com/a2aproject/a2a-go/a2a"

	"github.com/a2ui-project/a2ui/go/a2aext"
)

const maxTrackedRPCTasks = 1024

// RPCInterceptor tracks A2A tasks whose inbound request carries only A2UI RPC messages
// (callAgentFunction or rendererFunctionResponse) and upgrades an empty final "working"
// status event to "completed".
type RPCInterceptor struct {
	mu      sync.Mutex
	order   []a2a.TaskID
	tracked map[a2a.TaskID]bool
}

// NewRPCInterceptor constructs an RPCInterceptor for an A2A agent executor.
func NewRPCInterceptor() *RPCInterceptor {
	return &RPCInterceptor{
		tracked: make(map[a2a.TaskID]bool),
	}
}

// BeforeAgent records taskID when message holds exclusively A2UI renderer RPC parts.
func (i *RPCInterceptor) BeforeAgent(taskID a2a.TaskID, message *a2a.Message) {
	if taskID == "" {
		return
	}
	i.mu.Lock()
	defer i.mu.Unlock()

	i.removeLocked(taskID)
	if message != nil && isRendererRPCOnly(message.Parts) {
		i.tracked[taskID] = true
		i.order = append(i.order, taskID)
		for len(i.order) > maxTrackedRPCTasks {
			oldest := i.order[0]
			i.order = i.order[1:]
			delete(i.tracked, oldest)
		}
	}
}

// AfterAgent upgrades finalEvent.Status.State from TaskStateWorking to TaskStateCompleted
// when finalEvent belongs to a tracked RPC-only task and carries no outbound message parts.
func (i *RPCInterceptor) AfterAgent(finalEvent *a2a.TaskStatusUpdateEvent) *a2a.TaskStatusUpdateEvent {
	if finalEvent == nil {
		return nil
	}
	i.mu.Lock()
	wasRPC := i.tracked[finalEvent.TaskID]
	if wasRPC {
		i.removeLocked(finalEvent.TaskID)
	}
	i.mu.Unlock()

	if !wasRPC {
		return finalEvent
	}
	if finalEvent.Status.State != a2a.TaskStateWorking {
		return finalEvent
	}
	if finalEvent.Status.Message != nil && len(finalEvent.Status.Message.Parts) > 0 {
		return finalEvent
	}
	finalEvent.Status.State = a2a.TaskStateCompleted
	return finalEvent
}

func (i *RPCInterceptor) removeLocked(taskID a2a.TaskID) {
	if !i.tracked[taskID] {
		return
	}
	delete(i.tracked, taskID)
	if idx := slices.Index(i.order, taskID); idx >= 0 {
		i.order = slices.Delete(i.order, idx, idx+1)
	}
}

func isRendererRPCOnly(parts []a2a.Part) bool {
	if len(parts) == 0 {
		return false
	}
	msgs := a2aext.A2UIMessages(parts)
	if len(msgs) == 0 || len(msgs) != len(parts) {
		return false
	}
	for _, m := range msgs {
		kind := rpcMessageKind(m)
		if kind != kindCallAgentFunction && kind != kindRendererFunctionResponse {
			return false
		}
	}
	return true
}
