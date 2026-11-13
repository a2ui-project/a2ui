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
	"context"
	"log/slog"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// This file exposes internals to the external adk_test package only.

// ActiveStreamCount returns the number of responses that are still streaming.
func (c *EventConverter) ActiveStreamCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.streams)
}

// SetToolPayloadValidator replaces the validator that t uses for stateless calls.
func SetToolPayloadValidator(t *SendA2UIToClientTool, validate func([]*core.Catalog, []core.AgentToRendererMessage) error) {
	t.validatePayload = validate
}

// ToolInstruction returns the system instruction section that ts's tool appends to requests.
func ToolInstruction(ts *SendA2UIToClientToolset) string {
	return ts.uiTool.toolInstruction()
}

// ProcessNonCallRPCMessage exposes processNonCallRPCMessage for unit testing.
func ProcessNonCallRPCMessage(
	ctx context.Context,
	proc *agent.RendererToAgentMessageProcessor,
	calls *agent.RendererFunctionCalls,
	message map[string]any,
	logger *slog.Logger,
) (bool, error) {
	return processNonCallRPCMessage(ctx, proc, calls, message, logger)
}
