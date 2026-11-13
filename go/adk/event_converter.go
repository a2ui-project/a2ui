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
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/a2aproject/a2a-go/a2a"
	"google.golang.org/adk/v2/session"
	"google.golang.org/genai"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/agent"
)

type realClock struct{}

func (realClock) AfterFunc(d time.Duration, f func()) agent.TimerHandle {
	return time.AfterFunc(d, f)
}

// streamKey identifies one streamed response: the events of one invocation from one
// branch or author, so the sub-agents of a parallel agent each get their own stream.
type streamKey struct {
	invocationID   string
	branchOrAuthor string
}

// openStream is the stream of a response that is still streaming.
type openStream struct {
	// mu serializes Feed and Close on this response. It is held while parsing, so
	// it is never held together with EventConverter.mu.
	mu     sync.Mutex
	opened bool
	// stream is nil before the first chunk and after a chunk failed.
	stream agent.ResponseStream
	// idleTimer is guarded by EventConverter.mu.
	idleTimer agent.TimerHandle
}

// EventConverterConfig configures EventConverter. The zero value of each field is the default.
type EventConverterConfig struct {
	// BypassToolCheck converts the validated A2UI output of any tool response,
	// not just send_a2ui_json_to_client.
	BypassToolCheck bool
	// FallbackText is sent as a TextPart when an A2UI response can't be parsed.
	FallbackText string
	// ProcessorProvider resolves each session's RequestProcessor (for example,
	// ProcessorStore.ForSession). Events of a session without one are converted
	// without A2UI handling.
	ProcessorProvider SessionProcessorProvider
	// StreamIdleTimeout is how long a stream may go without events before it is
	// dropped, as when a run is cancelled before its final event. It defaults to
	// DefaultStreamIdleTimeout.
	StreamIdleTimeout time.Duration
	// Clock schedules stream idle-timeout timers. When nil, the system clock is used.
	Clock agent.Clock
	// Logger receives operational warnings and debug diagnostics. When nil, slog.Default() is used.
	Logger *slog.Logger
}

// EventConverter converts the ADK session events of a run into A2A events.
//
// When a session's processor format supports streaming and the run streams partial
// events, the converter opens one agent.ResponseStream per response, feeds it each
// partial event, and closes it on the final event, so A2UI messages reach the client
// as soon as they are complete.
//
// When building a custom a2asrv.AgentExecutor that iterates runner.Run directly, pass
// each yielded *session.Event to ConvertEvent. When using the A2A 0.3 executor of
// ADK for Go v2, google.golang.org/adk/v2/server/adka2a, instead:
//   - Register the session's RequestProcessor in ProcessorStore inside BeforeExecuteCallback.
//   - Note that adka2a.GenAIPartConverter is 1-to-1 (*genai.Part -> a2a.Part), whereas one
//     A2UI tool response or <a2ui> block expands into multiple A2A DataParts. Expand parts
//     1-to-N in AfterEventCallback with a PartConverter for the processor that
//     ProcessorStore.ForSession returns for execCtx.SessionID(), replacing
//     processed.Artifact.Parts, and attach RPCInterceptor.AfterAgent in AfterExecuteCallback.
//
// An EventConverter is safe for concurrent use. Responses stream independently: a
// slow parse in one session does not hold up another.
type EventConverter struct {
	bypassToolCheck   bool
	fallbackText      string
	processorProvider SessionProcessorProvider
	streamIdleTimeout time.Duration
	clock             agent.Clock
	logger            *slog.Logger

	mu      sync.Mutex
	streams map[streamKey]*openStream
}

// NewEventConverter constructs an EventConverter from cfg.
func NewEventConverter(cfg EventConverterConfig) *EventConverter {
	idleTimeout := cfg.StreamIdleTimeout
	if idleTimeout <= 0 {
		idleTimeout = DefaultStreamIdleTimeout
	}
	clk := cfg.Clock
	if clk == nil {
		clk = realClock{}
	}
	return &EventConverter{
		bypassToolCheck:   cfg.BypassToolCheck,
		fallbackText:      cfg.FallbackText,
		processorProvider: cfg.ProcessorProvider,
		streamIdleTimeout: idleTimeout,
		clock:             clk,
		logger:            loggerOrDefault(cfg.Logger),
		streams:           make(map[streamKey]*openStream),
	}
}

// ConvertEvent converts one ADK session event of sessionID into zero or more A2A events
// for the task identified by taskID and contextID.
//
// It is meant for code that iterates runner.Run: pass each event in order. An error
// event becomes a final FAILED status update; any other event with content becomes a
// WORKING status update whose message carries the converted parts.
func (c *EventConverter) ConvertEvent(ctx context.Context, sessionID string, event *session.Event, taskID a2a.TaskID, contextID string) ([]a2a.Event, error) {
	if event == nil {
		return nil, nil
	}

	var proc *agent.RequestProcessor
	if c.processorProvider != nil {
		var err error
		if proc, err = c.processorProvider(ctx, sessionID); err != nil {
			return nil, err
		}
	}

	branchOrAuthor := event.Branch
	if branchOrAuthor == "" {
		branchOrAuthor = event.Author
	}
	key := streamKey{invocationID: event.InvocationID, branchOrAuthor: branchOrAuthor}
	taskInfo := a2a.TaskInfo{TaskID: taskID, ContextID: contextID}

	if event.ErrorCode != "" || event.ErrorMessage != "" {
		c.closeStream(key)
		errMsg := event.ErrorMessage
		if errMsg == "" {
			errMsg = event.ErrorCode
		}
		msg := a2a.NewMessageForTask(a2a.MessageRoleAgent, taskInfo, a2a.TextPart{Text: errMsg})
		statusEvt := a2a.NewStatusUpdateEvent(taskInfo, a2a.TaskStateFailed, msg)
		statusEvt.Final = true
		return []a2a.Event{statusEvt}, nil
	}

	parts, err := c.convertParts(event, key, proc)
	if err != nil {
		return nil, err
	}
	if len(parts) == 0 {
		return nil, nil
	}
	msg := a2a.NewMessageForTask(a2a.MessageRoleAgent, taskInfo, parts...)
	return []a2a.Event{a2a.NewStatusUpdateEvent(taskInfo, a2a.TaskStateWorking, msg)}, nil
}

func (c *EventConverter) convertParts(event *session.Event, key streamKey, proc *agent.RequestProcessor) ([]a2a.Part, error) {
	var genaiParts []*genai.Part
	if event.Content != nil {
		genaiParts = event.Content.Parts
	}

	if proc == nil {
		var out []a2a.Part
		for _, gp := range genaiParts {
			aps, err := convertDefaultGenAIPartToA2AParts(gp)
			if err != nil {
				return nil, err
			}
			out = append(out, aps...)
		}
		return out, nil
	}

	pc := NewPartConverter(proc, &PartConverterOptions{
		BypassToolCheck: c.bypassToolCheck,
		FallbackText:    c.fallbackText,
		Logger:          c.logger,
	})
	if !proc.Format().SupportsStreaming() {
		var out []a2a.Part
		for _, gp := range genaiParts {
			ps, err := pc.Convert(gp)
			if err != nil {
				return nil, err
			}
			out = append(out, ps...)
		}
		return out, nil
	}

	var out []a2a.Part
	closedStream := false
	for _, gp := range genaiParts {
		if gp == nil {
			continue
		}
		ps, closed, err := c.convertStreamingPart(gp, event.Partial, closedStream, key, proc, pc)
		if err != nil {
			return nil, err
		}
		closedStream = closedStream || closed
		out = append(out, ps...)
	}
	if !event.Partial {
		out = append(out, c.closeStream(key)...)
	}
	return out, nil
}

func (c *EventConverter) convertStreamingPart(
	part *genai.Part,
	isPartial, alreadyClosed bool,
	key streamKey,
	proc *agent.RequestProcessor,
	pc *PartConverter,
) ([]a2a.Part, bool, error) {
	if part.Text == "" || part.Thought {
		parts, err := pc.Convert(part)
		if err != nil {
			return nil, false, err
		}
		if !part.Thought && !isPartial && c.hasStream(key) {
			return append(c.closeStream(key), parts...), true, nil
		}
		return parts, false, nil
	}

	if isPartial {
		return c.feed(key, proc, part.Text), false, nil
	}
	if c.hasStream(key) {
		return c.closeStream(key), true, nil
	}
	if alreadyClosed {
		return nil, false, nil
	}
	parts, err := pc.Convert(part)
	return parts, false, err
}

func (c *EventConverter) feed(key streamKey, proc *agent.RequestProcessor, chunk string) []a2a.Part {
	c.mu.Lock()
	entry, ok := c.streams[key]
	if !ok {
		entry = &openStream{}
		c.streams[key] = entry
	}
	c.resetIdleTimerLocked(key, entry)
	c.mu.Unlock()

	entry.mu.Lock()
	defer entry.mu.Unlock()
	if !entry.opened {
		entry.opened = true
		st, err := proc.OpenStream(&agent.StreamOptions{State: proc.State()})
		if err != nil {
			c.logger.Warn("Failed to open A2UI stream", "errorType", fmt.Sprintf("%T", err))
			c.logger.Debug("A2UI stream open error", "err", err)
			return nil
		}
		entry.stream = st
	}
	if entry.stream == nil {
		return nil
	}
	emitted, err := entry.stream.Feed(chunk)
	if err != nil {
		c.logger.Warn("Failed to stream A2UI chunk", "errorType", fmt.Sprintf("%T", err))
		c.logger.Debug("A2UI stream chunk error", "err", err)
		entry.stream = nil
		return nil
	}
	return a2aext.StreamPartsToA2AParts(emitted, "")
}

func (c *EventConverter) resetIdleTimerLocked(key streamKey, entry *openStream) {
	if entry.idleTimer != nil {
		entry.idleTimer.Stop()
	}
	entry.idleTimer = c.clock.AfterFunc(c.streamIdleTimeout, func() {
		c.expireStream(key, entry)
	})
}

func (c *EventConverter) expireStream(key streamKey, target *openStream) {
	c.mu.Lock()
	current, ok := c.streams[key]
	if !ok || current != target {
		c.mu.Unlock()
		return
	}
	delete(c.streams, key)
	c.mu.Unlock()
	c.logger.Warn("Dropped idle A2UI stream", "invocationID", key.invocationID, "timeout", c.streamIdleTimeout)
}

func (c *EventConverter) hasStream(key streamKey) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.streams[key]
	return ok
}

func (c *EventConverter) closeStream(key streamKey) []a2a.Part {
	c.mu.Lock()
	entry, ok := c.streams[key]
	if ok {
		delete(c.streams, key)
		if entry.idleTimer != nil {
			entry.idleTimer.Stop()
			entry.idleTimer = nil
		}
	}
	c.mu.Unlock()
	if !ok {
		return nil
	}

	entry.mu.Lock()
	defer entry.mu.Unlock()
	if entry.stream == nil {
		return c.fallbackParts()
	}
	finalParts, err := entry.stream.Close()
	entry.stream = nil
	if err != nil {
		c.logger.Warn("Failed to close A2UI stream", "errorType", fmt.Sprintf("%T", err))
		c.logger.Debug("A2UI stream close error", "err", err)
		return c.fallbackParts()
	}
	return a2aext.StreamPartsToA2AParts(finalParts, "")
}

func (c *EventConverter) fallbackParts() []a2a.Part {
	if c.fallbackText == "" {
		return nil
	}
	return []a2a.Part{a2a.TextPart{Text: c.fallbackText}}
}
