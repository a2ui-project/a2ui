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
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	adkagent "google.golang.org/adk/v2/agent"
	"google.golang.org/genai"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	kindCallAgentFunction        = "callAgentFunction"
	kindAgentFunctionResponse    = "agentFunctionResponse"
	kindRendererFunctionResponse = "rendererFunctionResponse"
)

// CatalogsProvider returns the active catalogs for ctx, or nil when A2UI is inactive.
type CatalogsProvider func(ctx adkagent.ReadonlyContext) ([]*core.Catalog, error)

// RendererFunctionCallsProvider returns the session's RendererFunctionCalls manager for ctx.
type RendererFunctionCallsProvider func(ctx adkagent.ReadonlyContext) (*agent.RendererFunctionCalls, error)

// RPCCallbackConfig configures RPCCallback.
type RPCCallbackConfig struct {
	// Catalogs is a fixed list of catalogs whose AgentFunctions answer callAgentFunction messages.
	Catalogs []*core.Catalog
	// CatalogsProvider resolves the active catalogs per context and replaces Catalogs when set.
	// A provider that returns nil leaves callAgentFunction messages to the agent.
	CatalogsProvider CatalogsProvider
	// RendererCallsProvider resolves the session's RendererFunctionCalls (for example, RendererCallsStore.Get).
	RendererCallsProvider RendererFunctionCallsProvider
	// AgentFunctionTimeout limits how long an AgentFunction handler may run (0 means no timeout).
	AgentFunctionTimeout time.Duration
	// Logger receives operational warnings and debug diagnostics. When nil, slog.Default() is used.
	Logger *slog.Logger
}

// RPCCallback returns an adkagent.BeforeAgentCallback that deterministically handles v1.0
// callAgentFunction and pending rendererFunctionResponse messages without running the LLM turn.
func RPCCallback(cfg RPCCallbackConfig) (adkagent.BeforeAgentCallback, error) {
	hasCatalogs := len(cfg.Catalogs) > 0 || cfg.CatalogsProvider != nil
	if !hasCatalogs && cfg.RendererCallsProvider == nil {
		return nil, errors.New("RPCCallback needs Catalogs, CatalogsProvider, or RendererCallsProvider")
	}
	if cfg.AgentFunctionTimeout < 0 {
		return nil, fmt.Errorf("RPCCallback got a negative AgentFunctionTimeout: %v", cfg.AgentFunctionTimeout)
	}
	fixedCatalogs := slices.Clone(cfg.Catalogs)
	logger := loggerOrDefault(cfg.Logger)

	return func(cbCtx adkagent.Context) (*genai.Content, error) {
		if cbCtx == nil {
			return nil, nil
		}
		userContent := cbCtx.UserContent()
		if userContent == nil || len(userContent.Parts) == 0 {
			return nil, nil
		}

		perPart := make([][]map[string]any, len(userContent.Parts))
		var allMessages []map[string]any
		hasRendererResp := false
		for i, part := range userContent.Parts {
			msgs := DecodeGenAIPartA2UIMessages(part)
			perPart[i] = msgs
			for _, m := range msgs {
				allMessages = append(allMessages, m)
				if rpcMessageKind(m) == kindRendererFunctionResponse {
					hasRendererResp = true
				}
			}
		}
		if len(allMessages) == 0 {
			return nil, nil
		}

		callsProc, err := agent.NewRendererToAgentMessageProcessor(nil, nil)
		if err != nil {
			return nil, err
		}
		var calls *agent.RendererFunctionCalls
		if cfg.RendererCallsProvider != nil && hasRendererResp {
			calls, err = cfg.RendererCallsProvider(cbCtx)
			if err != nil {
				return nil, err
			}
			if calls != nil {
				callsProc, err = agent.NewRendererToAgentMessageProcessor(nil, &agent.RendererToAgentOptions{
					OnRendererFunctionResponse: func(_ context.Context, msg *core.RendererToAgentMessage) (bool, error) {
						return calls.Resolve(msg.RendererFunctionResponse), nil
					},
				})
				if err != nil {
					return nil, err
				}
			}
		}

		allOtherHandled := true
		var agentCalls []map[string]any
		for _, m := range allMessages {
			if rpcMessageKind(m) == kindCallAgentFunction {
				agentCalls = append(agentCalls, m)
				continue
			}
			handled, err := processNonCallRPCMessage(cbCtx, callsProc, calls, m, logger)
			if err != nil {
				return nil, err
			}
			if !handled {
				allOtherHandled = false
			}
		}

		allPartsAreA2UI := true
		for _, pMsgs := range perPart {
			if len(pMsgs) == 0 {
				allPartsAreA2UI = false
				break
			}
		}
		if !allOtherHandled || !allPartsAreA2UI {
			return nil, nil
		}

		var replies []core.AgentToRendererMessage
		if len(agentCalls) > 0 {
			var resolved []*core.Catalog
			switch {
			case cfg.CatalogsProvider != nil:
				resolved, err = cfg.CatalogsProvider(cbCtx)
				if err != nil {
					return nil, err
				}
				if resolved == nil {
					return nil, nil
				}
			case hasCatalogs:
				resolved = fixedCatalogs
			default:
				return nil, nil
			}

			proc, err := agent.NewRendererToAgentMessageProcessor(resolved, &agent.RendererToAgentOptions{
				AgentFunctionTimeout: cfg.AgentFunctionTimeout,
			})
			if err != nil {
				return nil, err
			}
			for _, m := range agentCalls {
				callReplies, err := processAgentCallRPCMessage(cbCtx, proc, m, logger)
				if err != nil {
					return nil, err
				}
				replies = append(replies, callReplies...)
			}
		}

		a2aParts := a2aext.CreateA2UIParts(replies, "")
		genaiParts := make([]*genai.Part, 0, len(a2aParts))
		for _, ap := range a2aParts {
			gp, err := EncodeA2APartToGenAI(ap)
			if err != nil {
				return nil, err
			}
			if gp != nil {
				genaiParts = append(genaiParts, gp)
			}
		}
		return &genai.Content{
			Role:  genai.RoleModel,
			Parts: genaiParts,
		}, nil
	}, nil
}

func processNonCallRPCMessage(ctx context.Context, proc *agent.RendererToAgentMessageProcessor, calls *agent.RendererFunctionCalls, message map[string]any, logger *slog.Logger) (bool, error) {
	res, err := proc.ProcessMessageMap(ctx, message)
	if err == nil {
		return res.Handled, nil
	}
	var valErr *core.ValidationError
	if errors.As(err, &valErr) {
		if calls != nil && rpcMessageKind(message) == kindRendererFunctionResponse && calls.ResolveMessage(message) {
			return true, nil
		}
		logger.Warn("Passing an invalid A2UI message on to the agent", "errorType", fmt.Sprintf("%T", err))
		logger.Debug("Invalid A2UI message error", "err", err)
		return false, nil
	}
	return false, err
}

func processAgentCallRPCMessage(ctx context.Context, proc *agent.RendererToAgentMessageProcessor, message map[string]any, logger *slog.Logger) ([]core.AgentToRendererMessage, error) {
	res, err := proc.ProcessMessageMap(ctx, message)
	if err != nil {
		var valErr *core.ValidationError
		if errors.As(err, &valErr) {
			logger.Warn("Dropped an A2UI RPC message that can't be answered", "errorType", fmt.Sprintf("%T", err))
			logger.Debug("Dropped A2UI RPC message error", "err", err)
			return nil, nil
		}
		return nil, err
	}
	return res.Replies, nil
}

func rpcMessageKind(message map[string]any) string {
	kind := ""
	count := 0
	for k := range message {
		if k == "version" {
			continue
		}
		kind = k
		count++
	}
	if count == 1 {
		return kind
	}
	return ""
}
