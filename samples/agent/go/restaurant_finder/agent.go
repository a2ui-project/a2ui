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

package main

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/a2aproject/a2a-go/a2a"
	"github.com/a2aproject/a2a-go/a2asrv"
	"github.com/a2aproject/a2a-go/a2asrv/eventqueue"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

const maxAttempts = 2

// restaurantExecutor implements a2asrv.AgentExecutor for the multi-version, multi-format Restaurant Finder sample.
type restaurantExecutor struct {
	format     a2uiFormat
	backend    modelBackend
	agentCard  *a2a.AgentCard
	generators map[string]*agent.Generator
}

// newRestaurantExecutor builds one Generator per served protocol version with loaded example turns.
func newRestaurantExecutor(repoRoot string, format a2uiFormat, backend modelBackend, catalogs map[string]*core.Catalog, card *a2a.AgentCard) (*restaurantExecutor, error) {
	generators := make(map[string]*agent.Generator, len(servedVersions))
	for _, profile := range servedVersions {
		cat := catalogs[profile.Version]
		catCfg, err := agent.NewCatalogConfig(cat)
		if err != nil {
			return nil, err
		}
		exampleTurns, _, err := loadExampleTurns(repoRoot, profile)
		if err != nil {
			return nil, err
		}
		generators[profile.Version] = agent.NewGenerator([]*agent.CatalogConfig{catCfg}, &agent.GeneratorOptions{
			Examples:               exampleTurns,
			InferenceFormatFactory: formatFactoryFor(format),
		})
	}
	return &restaurantExecutor{
		format:     format,
		backend:    backend,
		agentCard:  card,
		generators: generators,
	}, nil
}

// Execute handles one incoming A2A message turn and publishes Task and TaskStatusUpdateEvent items to queue.
func (e *restaurantExecutor) Execute(ctx context.Context, reqCtx *a2asrv.RequestContext, queue eventqueue.Queue) error {
	var extCtx a2aext.ExtensionContext
	if exts, ok := a2asrv.ExtensionsFrom(ctx); ok {
		extCtx = exts
	}
	picked, pickErr := pickA2UI(reqCtx.Message, extCtx, e.agentCard)

	if reqCtx.StoredTask == nil {
		initialTask := a2a.NewSubmittedTask(reqCtx, reqCtx.Message)
		if err := queue.Write(ctx, initialTask); err != nil {
			return err
		}
	}

	err := pickErr
	if err == nil {
		err = e.runTurn(ctx, reqCtx, queue, picked)
	}
	if err != nil {
		slog.Error("Task execution failed", "taskID", reqCtx.TaskID, "err", err)
		errMsg := a2a.NewMessageForTask(
			a2a.MessageRoleAgent,
			reqCtx,
			a2a.TextPart{Text: fmt.Sprintf("The agent could not answer this request: %v", err)},
		)
		failEvt := a2a.NewStatusUpdateEvent(reqCtx, a2a.TaskStateFailed, errMsg)
		failEvt.Final = true
		return queue.Write(ctx, failEvt)
	}
	return nil
}

// Cancel acknowledges task cancellation requests.
func (e *restaurantExecutor) Cancel(ctx context.Context, reqCtx *a2asrv.RequestContext, queue eventqueue.Queue) error {
	cancelEvt := a2a.NewStatusUpdateEvent(reqCtx, a2a.TaskStateCanceled, nil)
	cancelEvt.Final = true
	return queue.Write(ctx, cancelEvt)
}

func (e *restaurantExecutor) runTurn(ctx context.Context, reqCtx *a2asrv.RequestContext, queue eventqueue.Queue, picked pickedA2UI) error {
	proc, err := e.createProcessor(picked.Profile, picked.CatalogIDs)
	if err != nil {
		return err
	}

	inbound := readInboundMessage(reqCtx.Message, picked.Profile.Version)
	uq := buildUserQuery(inbound)

	workingStart := a2a.NewStatusUpdateEvent(reqCtx, a2a.TaskStateWorking, nil)
	if err := queue.Write(ctx, workingStart); err != nil {
		return err
	}

	var publishFn func(parts []a2a.Part) error
	if uq.UseStreaming {
		publishFn = func(parts []a2a.Part) error {
			msg := a2a.NewMessageForTask(a2a.MessageRoleAgent, reqCtx, parts...)
			evt := a2a.NewStatusUpdateEvent(reqCtx, a2a.TaskStateWorking, msg)
			return queue.Write(ctx, evt)
		}
	}

	turn := turnInput{
		ContextID:    reqCtx.ContextID,
		Query:        uq.Query,
		ActionName:   uq.ActionName,
		Profile:      picked.Profile,
		Processor:    proc,
		UseStreaming: uq.UseStreaming,
	}
	parts, published, err := e.generateUI(ctx, turn, picked.CatalogIDs, publishFn)
	if err != nil {
		return err
	}

	finalState := a2a.TaskStateInputRequired
	if uq.ActionName == "submit_booking" {
		finalState = a2a.TaskStateCompleted
	}
	var finalMsg *a2a.Message
	if !published && len(parts) > 0 {
		finalMsg = a2a.NewMessageForTask(a2a.MessageRoleAgent, reqCtx, parts...)
	}
	finalEvt := a2a.NewStatusUpdateEvent(reqCtx, finalState, finalMsg)
	finalEvt.Final = true
	return queue.Write(ctx, finalEvt)
}

func (e *restaurantExecutor) generateUI(
	ctx context.Context,
	turn turnInput,
	catalogIDs []string,
	publish func(parts []a2a.Part) error,
) ([]a2a.Part, bool, error) {
	query := turn.Query
	for attempt := range maxAttempts {
		attemptTurn := turn
		attemptTurn.Query = query
		parts, streamed, err := e.answerAttempt(ctx, attemptTurn, catalogIDs, publish != nil)
		if err == nil && !containsA2UIDataPart(parts) {
			err = fmt.Errorf("the response contains no A2UI messages")
		}
		if err == nil {
			published := false
			if publish != nil && len(parts) > 0 {
				if streamed {
					for _, part := range parts {
						if pubErr := publish([]a2a.Part{part}); pubErr != nil {
							return nil, false, pubErr
						}
					}
				} else {
					if pubErr := publish(parts); pubErr != nil {
						return nil, false, pubErr
					}
				}
				published = true
			}
			return parts, published, nil
		}

		slog.Warn("A2UI attempt failed validation", "attempt", attempt+1, "err", err)
		query = retryQuery(e.format, err.Error(), turn.Query)
	}

	slog.Error("Max retries exhausted; sending fallback text")
	return []a2a.Part{a2a.TextPart{Text: fallbackText}}, false, nil
}

func (e *restaurantExecutor) answerAttempt(
	ctx context.Context,
	turn turnInput,
	catalogIDs []string,
	useStreaming bool,
) ([]a2a.Part, bool, error) {
	proc, err := e.createProcessor(turn.Profile, catalogIDs)
	if err != nil {
		return nil, false, err
	}
	turn.Processor = proc
	mimeVersion := sampleMIMEVersion(turn.Profile)

	if useStreaming && proc.Parser().SupportsStreaming() {
		stream, err := proc.OpenStream(nil)
		if err != nil {
			return nil, false, err
		}
		var allParts []a2a.Part
		for part, partErr := range a2aext.StreamResponseToParts(ctx, stream, e.backend.StreamTurn(ctx, turn), mimeVersion) {
			if partErr != nil {
				return nil, false, partErr
			}
			allParts = append(allParts, part)
		}
		return allParts, true, nil
	}

	var sb strings.Builder
	for chunk, chunkErr := range e.backend.StreamTurn(ctx, turn) {
		if chunkErr != nil {
			return nil, false, chunkErr
		}
		sb.WriteString(chunk)
	}
	parsed, err := proc.ParseResponse(sb.String(), nil)
	if err != nil {
		return nil, false, err
	}
	return a2aext.ToA2AParts(parsed, mimeVersion), false, nil
}

func (e *restaurantExecutor) createProcessor(profile versionProfile, catalogIDs []string) (*agent.RequestProcessor, error) {
	gen, ok := e.generators[profile.Version]
	if !ok {
		return nil, fmt.Errorf("unsupported version %q", profile.Version)
	}
	caps := core.RendererCapabilities{
		profile.Version: {
			SupportedCatalogIDs: catalogIDs,
		},
	}
	return gen.CreateProcessor(caps, &agent.CreateProcessorOptions{
		InferenceFormatFactory: formatFactoryFor(e.format),
	})
}

func formatFactoryFor(format a2uiFormat) agent.InferenceFormatFactory {
	if format == formatDirectJSON {
		return agent.NewDirectJSONFormatFactory(nil)
	}
	return agent.NewExpressFormatFactory(&agent.ExpressFormatOptions{SurfaceID: "default"})
}

func sampleMIMEVersion(profile versionProfile) core.ProtocolVersion {
	if profile.ProtocolVersion == core.Version0_9 {
		// Emit application/a2ui+json for sample web clients while keeping "version": "v0.9" on messages.
		return core.Version0_9_1
	}
	return profile.ProtocolVersion
}

func containsA2UIDataPart(parts []a2a.Part) bool {
	for _, p := range parts {
		if a2aext.IsA2UIPart(p) {
			return true
		}
	}
	return false
}
