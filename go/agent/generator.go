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

package agent

import (
	"context"
	"errors"
	"iter"

	"github.com/a2ui-project/a2ui/go/core"
)

// GeneratorOptions configures an agent-level Generator.
type GeneratorOptions struct {
	Examples               [][]core.AgentToRendererMessage
	InferenceFormatFactory InferenceFormatFactory
	AcceptsInlineCatalogs  bool
}

// CreateProcessorOptions configures Generator.CreateProcessor for a single request.
type CreateProcessorOptions struct {
	InferenceFormatFactory InferenceFormatFactory
	State                  *RendererState
}

// Generator holds an agent's supported CatalogConfig entries and negotiates a RequestProcessor per request.
// A constructed Generator is safe for concurrent use by multiple goroutines.
type Generator struct {
	catalogs              []*CatalogConfig
	examples              [][]core.AgentToRendererMessage
	factory               InferenceFormatFactory
	acceptsInlineCatalogs bool
}

// NewGenerator constructs a Generator, defaulting to ExpressFormatFactory when opts or InferenceFormatFactory is nil.
func NewGenerator(catalogs []*CatalogConfig, opts *GeneratorOptions) *Generator {
	var resolved GeneratorOptions
	if opts != nil {
		resolved = *opts
	}
	factory := resolved.InferenceFormatFactory
	if factory == nil {
		factory = NewExpressFormatFactory(nil)
	}
	return &Generator{
		catalogs:              append([]*CatalogConfig(nil), catalogs...),
		examples:              cloneExampleTurns(resolved.Examples),
		factory:               factory,
		acceptsInlineCatalogs: resolved.AcceptsInlineCatalogs,
	}
}

// Catalogs returns a copy of the generator's registered CatalogConfig list.
func (g *Generator) Catalogs() []*CatalogConfig {
	return append([]*CatalogConfig(nil), g.catalogs...)
}

// CreateProcessor negotiates active catalogs against rendererCapabilities and returns a RequestProcessor.
func (g *Generator) CreateProcessor(rendererCapabilities core.RendererCapabilities, opts *CreateProcessorOptions) (*RequestProcessor, error) {
	if rendererCapabilities == nil {
		return nil, core.NewCatalogError("renderer capabilities are required to create a request processor")
	}
	active, err := ResolveCatalogs(g.catalogs, rendererCapabilities, g.acceptsInlineCatalogs)
	if err != nil {
		return nil, err
	}
	var reqOpts RequestProcessorOptions
	reqOpts.Examples = g.examples
	reqOpts.FormatFactory = g.factory
	if opts != nil {
		if opts.InferenceFormatFactory != nil {
			reqOpts.FormatFactory = opts.InferenceFormatFactory
		}
		reqOpts.State = opts.State
	}
	return NewRequestProcessor(active, &reqOpts)
}

// RequestProcessorOptions configures NewRequestProcessor.
type RequestProcessorOptions struct {
	Examples      [][]core.AgentToRendererMessage
	FormatFactory InferenceFormatFactory
	State         *RendererState
}

// RequestProcessor unifies negotiated catalogs, system prompt generation, and response parsing/streaming for one request.
//
// A stateless RequestProcessor (State() == nil) is safe for concurrent use by multiple goroutines:
// each ParseResponse, OpenStream, or Stream call creates its own RendererState unless one is passed in.
// A stateful RequestProcessor (State() != nil) mutates its bound RendererState and is not safe for concurrent use without external synchronization.
type RequestProcessor struct {
	activeCatalogs []*core.Catalog
	examples       [][]core.AgentToRendererMessage
	format         InferenceFormat
	parser         Parser
	state          *RendererState
}

// NewRequestProcessor constructs a RequestProcessor bound to catalogs.
func NewRequestProcessor(catalogs []*core.Catalog, opts *RequestProcessorOptions) (*RequestProcessor, error) {
	if len(catalogs) == 0 {
		return nil, core.NewCatalogError("at least one active catalog is required")
	}
	var resolved RequestProcessorOptions
	if opts != nil {
		resolved = *opts
	}
	factory := resolved.FormatFactory
	if factory == nil {
		factory = NewExpressFormatFactory(nil)
	}
	for _, turn := range resolved.Examples {
		if err := ValidatePayload(catalogs, turn); err != nil {
			return nil, err
		}
	}
	fmtInst, err := factory.CreateFormat(catalogs, resolved.Examples)
	if err != nil {
		return nil, err
	}
	rp := &RequestProcessor{
		activeCatalogs: append([]*core.Catalog(nil), catalogs...),
		examples:       cloneExampleTurns(resolved.Examples),
		format:         fmtInst,
		// Parsers hold no per-response state, so one parser serves every request and
		// goroutine that shares this processor.
		parser: fmtInst.CreateParser(),
	}
	if err := rp.checkState(resolved.State); err != nil {
		return nil, err
	}
	rp.state = resolved.State
	return rp, nil
}

// ActiveCatalogs returns a copy of the processor's negotiated catalogs.
func (p *RequestProcessor) ActiveCatalogs() []*core.Catalog {
	return append([]*core.Catalog(nil), p.activeCatalogs...)
}

// Examples returns a copy of the processor's configured few-shot example turns.
func (p *RequestProcessor) Examples() [][]core.AgentToRendererMessage {
	return cloneExampleTurns(p.examples)
}

// Format returns the InferenceFormat bound to this processor.
func (p *RequestProcessor) Format() InferenceFormat { return p.format }

// State returns the conversation RendererState bound to this processor, if any.
func (p *RequestProcessor) State() *RendererState { return p.state }

// PromptSnippet renders the format-specific system prompt instructions for the active catalogs.
func (p *RequestProcessor) PromptSnippet() (string, error) {
	return p.format.PromptGenerator().Generate()
}

// Parser returns the reusable stateless Parser for this processor's format.
func (p *RequestProcessor) Parser() Parser {
	return p.parser
}

// CreateState creates a fresh empty RendererState holding the processor's active catalogs.
func (p *RequestProcessor) CreateState() (*RendererState, error) {
	return NewRendererState(p.activeCatalogs)
}

// AcceptsState reports whether state holds identical catalogs in the same order as this processor.
func (p *RequestProcessor) AcceptsState(state *RendererState) bool {
	if state == nil {
		return false
	}
	sc := state.Catalogs()
	if len(sc) != len(p.activeCatalogs) {
		return false
	}
	for i := range sc {
		if sc[i].CatalogID() != p.activeCatalogs[i].CatalogID() || sc[i].ProtocolVersion() != p.activeCatalogs[i].ProtocolVersion() {
			return false
		}
	}
	return true
}

func (p *RequestProcessor) checkState(state *RendererState) error {
	if state == nil || p.AcceptsState(state) {
		return nil
	}
	return core.NewCatalogError("the renderer state holds different catalogs than the request processor's active catalogs")
}

func (p *RequestProcessor) resolveParseOptions(opts *ParseOptions) (*ParseOptions, error) {
	var resolved ParseOptions
	if opts != nil {
		resolved = *opts
	}
	if resolved.State == nil {
		resolved.State = p.state
	} else if err := p.checkState(resolved.State); err != nil {
		return nil, err
	}
	return &resolved, nil
}

func (p *RequestProcessor) resolveStreamOptions(opts *StreamOptions) (*StreamOptions, error) {
	var resolved StreamOptions
	if opts != nil {
		resolved = *opts
	}
	if resolved.State == nil {
		resolved.State = p.state
	} else if err := p.checkState(resolved.State); err != nil {
		return nil, err
	}
	return &resolved, nil
}

// ParseResponse parses and validates a complete LLM response string.
func (p *RequestProcessor) ParseResponse(content string, opts *ParseOptions) ([]ResponsePart, error) {
	resolved, err := p.resolveParseOptions(opts)
	if err != nil {
		return nil, err
	}
	return p.Parser().ParseResponse(content, resolved)
}

// OpenStream opens an incremental ResponseStream for chunk-by-chunk LLM output processing.
func (p *RequestProcessor) OpenStream(opts *StreamOptions) (ResponseStream, error) {
	resolved, err := p.resolveStreamOptions(opts)
	if err != nil {
		return nil, err
	}
	return p.Parser().OpenStream(resolved)
}

// Stream consumes a Go iter.Seq2[string, error] token stream and yields validated StreamParts.
func (p *RequestProcessor) Stream(ctx context.Context, chunks iter.Seq2[string, error], opts *StreamOptions) iter.Seq2[StreamPart, error] {
	return func(yield func(StreamPart, error) bool) {
		st, err := p.OpenStream(opts)
		if err != nil {
			yield(StreamPart{}, err)
			return
		}
		for part, partErr := range StreamChunks(ctx, st, chunks) {
			if !yield(part, partErr) {
				return
			}
		}
	}
}

// StreamedAnswer feeds a continuing ResponseStream directly into a core.MessageProcessor
// and maintains ordered text, live SurfaceModel, and error parts.
// A StreamedAnswer is not safe for concurrent use by multiple goroutines.
type StreamedAnswer struct {
	renderer *core.MessageProcessor
	stream   ResponseStream
	parts    []AnswerPart
	inText   bool
}

// NewStreamedAnswer opens a StreamedAnswer applying validated messages from processor directly into renderer.
func NewStreamedAnswer(processor *RequestProcessor, renderer *core.MessageProcessor) (*StreamedAnswer, error) {
	if processor == nil {
		return nil, core.NewCatalogError("request processor must not be nil")
	}
	state, err := RendererStateOf(renderer)
	if err != nil {
		return nil, err
	}
	if !processor.AcceptsState(state) {
		return nil, core.NewCatalogError("renderer catalogs do not match request processor active catalogs")
	}
	stream, err := processor.OpenStream(&StreamOptions{
		State:              state,
		AfterRejectedBlock: AfterRejectedContinue,
	})
	if err != nil {
		return nil, err
	}
	return &StreamedAnswer{
		renderer: renderer,
		stream:   stream,
	}, nil
}

// Renderer returns the underlying core.MessageProcessor bound to this answer.
func (a *StreamedAnswer) Renderer() *core.MessageProcessor { return a.renderer }

// Parts returns the accumulated answer parts in emission order.
func (a *StreamedAnswer) Parts() []AnswerPart {
	return append([]AnswerPart(nil), a.parts...)
}

// IsInBlock reports whether the streamed answer currently ends inside an open A2UI block.
func (a *StreamedAnswer) IsInBlock() bool {
	return a.stream.IsInBlock()
}

// Feed processes the next chunk of the LLM response.
func (a *StreamedAnswer) Feed(chunk string) error {
	parts, err := a.stream.Feed(chunk)
	a.show(parts)
	return err
}

// Close finalizes the streamed answer, flushing any trailing text or incomplete block errors.
func (a *StreamedAnswer) Close() error {
	parts, err := a.stream.Close()
	a.show(parts)
	return err
}

func (a *StreamedAnswer) show(streamParts []StreamPart) {
	if len(streamParts) == 0 {
		return
	}
	next := append([]AnswerPart(nil), a.parts...)
	for _, part := range streamParts {
		if part.IsText() {
			if a.inText && len(next) > 0 && next[len(next)-1].IsText() {
				next[len(next)-1] = NewAnswerTextPart(next[len(next)-1].Text + part.Text)
			} else {
				next = append(next, NewAnswerTextPart(part.Text))
			}
			a.inText = true
			continue
		}
		a.inText = false
		if part.IsError() {
			next = append(next, NewAnswerErrorPart(part.Error))
			continue
		}
		for _, msg := range part.A2UI {
			for _, createKey := range createActions {
				if createdID, ok := actionSurfaceID(msg, createKey); ok {
					if surf := a.renderer.Model.Surface(createdID); surf != nil {
						next = append(next, NewAnswerSurfacePart(surf))
					}
				}
			}
			if deletedID, ok := actionSurfaceID(msg, "deleteSurface"); ok {
				for idx := range next {
					if next[idx].Surface != nil && next[idx].Surface.ID == deletedID {
						next = append(next[:idx], next[idx+1:]...)
						break
					}
				}
			}
		}
	}
	a.parts = next
}

func actionSurfaceID(msg core.AgentToRendererMessage, action string) (string, bool) {
	body, ok := msg[action].(map[string]any)
	if !ok {
		return "", false
	}
	sid, ok := body["surfaceId"].(string)
	return sid, ok
}

// ExecuteParseResponse runs the canonical atomic whole-response parsing flow for p:
// unwrapping (when opts.Wrapped is nil or true), compiling each block, applying messages
// inside a RendererState transaction, validating topology on complete surfaces, and attaching
// PartialResults on failure.
func ExecuteParseResponse(p Parser, content string, opts *ParseOptions) ([]ResponsePart, error) {
	var resolved ParseOptions
	if opts != nil {
		resolved = *opts
	}
	target := resolved.State
	if target == nil {
		var err error
		target, err = NewRendererState(p.Catalogs())
		if err != nil {
			return nil, err
		}
	}

	wrapped := !resolved.Unwrapped
	var responseParts []ResponsePart
	var touchedOrder []string
	touchedSeen := make(map[string]bool)
	incomplete := make(map[string]bool)

	txErr := target.Transaction(func() error {
		var rawParts []RawResponsePart
		if wrapped {
			rawParts = p.Unwrap(content)
		} else {
			rawParts = []RawResponsePart{NewRawA2UIPart(content, true)}
		}
		for _, rawPart := range rawParts {
			if rawPart.IsText() {
				responseParts = append(responseParts, NewTextPart(rawPart.Text))
				continue
			}
			messages, err := p.Compile(rawPart.A2UIRaw, rawPart.IsFinal)
			if err != nil {
				return attachPartialResults(err, responseParts, rawPart.A2UIRaw)
			}
			blockTouched, err := target.Apply(messages)
			if err != nil {
				return attachPartialResults(err, responseParts, rawPart.A2UIRaw)
			}
			responseParts = append(responseParts, NewA2UIPart(messages))
			for _, sid := range blockTouched {
				if !touchedSeen[sid] {
					touchedSeen[sid] = true
					touchedOrder = append(touchedOrder, sid)
				}
				if !rawPart.IsFinal {
					incomplete[sid] = true
				}
			}
		}

		var complete []string
		for _, sid := range touchedOrder {
			if !incomplete[sid] {
				complete = append(complete, sid)
			}
		}
		if len(complete) > 0 {
			if err := target.CheckTopology(complete); err != nil {
				var textOnly []ResponsePart
				for _, rp := range responseParts {
					if rp.IsText() {
						textOnly = append(textOnly, rp)
					}
				}
				return attachPartialResults(err, textOnly, "")
			}
		}

		if len(incomplete) > 0 {
			incList := make([]string, 0, len(incomplete))
			for sid := range incomplete {
				incList = append(incList, sid)
			}
			target.MarkChecked(incList)
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	return responseParts, nil
}

type partialErrorWrapper struct {
	cause    error
	partials []ResponsePart
}

func (e *partialErrorWrapper) Error() string                  { return e.cause.Error() }
func (e *partialErrorWrapper) Unwrap() error                  { return e.cause }
func (e *partialErrorWrapper) PartialResults() []ResponsePart { return e.partials }
func (e *partialErrorWrapper) ErrorCategory() core.ErrorCategory {
	var catErr core.CategorizedError
	if errors.As(e.cause, &catErr) {
		return catErr.ErrorCategory()
	}
	return core.CategoryValidation
}

func attachPartialResults(err error, partials []ResponsePart, rawContent string) error {
	if err == nil {
		return nil
	}
	copied := append([]ResponsePart(nil), partials...)
	var compErr *CompilationError
	if errors.As(err, &compErr) {
		compErr.Partials = copied
		return err
	}
	var catErr core.CategorizedError
	if errors.As(err, &catErr) {
		return &partialErrorWrapper{cause: err, partials: copied}
	}
	ce := NewCompilationError(err.Error(), rawContent)
	ce.Cause = err
	ce.Partials = copied
	return ce
}

func cloneExampleTurns(examples [][]core.AgentToRendererMessage) [][]core.AgentToRendererMessage {
	if examples == nil {
		return nil
	}
	out := make([][]core.AgentToRendererMessage, len(examples))
	for i, turn := range examples {
		clonedTurn := make([]core.AgentToRendererMessage, len(turn))
		for j, msg := range turn {
			clonedTurn[j] = msg.Clone()
		}
		out[i] = clonedTurn
	}
	return out
}
