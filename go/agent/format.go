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
	"iter"
	"strings"

	"github.com/a2ui-project/a2ui/go/core"
)

// AfterRejectedBlock controls how a ResponseStream behaves when an A2UI block fails compilation or validation.
type AfterRejectedBlock string

const (
	// AfterRejectedEnd fails and closes the stream on the first rejected block (default).
	AfterRejectedEnd AfterRejectedBlock = "end"
	// AfterRejectedContinue emits an error StreamPart for the rejected block and continues reading.
	AfterRejectedContinue AfterRejectedBlock = "continue"
)

// ParseOptions configures Parser.ParseResponse and RequestProcessor.ParseResponse.
// The zero value of each field is the default.
type ParseOptions struct {
	// Unwrapped parses the entire input as raw format content without sentinel tags when true.
	Unwrapped bool
	// State is the optional RendererState to validate against and mutate atomically.
	State *RendererState
}

// StreamOptions configures Parser.OpenStream and RequestProcessor.OpenStream.
// The zero value of each field is the default.
type StreamOptions struct {
	// Unwrapped streams the input as raw format content without sentinel tags when true.
	Unwrapped bool
	// State is the optional RendererState to validate against and mutate incrementally.
	State *RendererState
	// AfterRejectedBlock defaults to AfterRejectedEnd when empty.
	AfterRejectedBlock AfterRejectedBlock
}

// ResponseStream incrementally parses and validates streamed LLM text chunks.
type ResponseStream interface {
	Feed(chunk string) ([]StreamPart, error)
	Close() ([]StreamPart, error)
	State() *RendererState
	IsInBlock() bool
}

// Parser translates between an inference format's notation and validated A2UI messages.
// Implementations must hold no mutable per-response state so a single Parser can be reused across turns.
type Parser interface {
	Catalogs() []*core.Catalog
	SupportsStreaming() bool
	HasFormatContent(content string, complete bool) bool
	Wrap(blocks []RawResponsePart) string
	Unwrap(content string) []RawResponsePart
	Compile(formatContent string, isFinal bool) ([]core.AgentToRendererMessage, error)
	Decompile(payload []core.AgentToRendererMessage) (string, error)
	WrapDecompiledBlocks(blocks []string) string
	ParseResponse(content string, opts *ParseOptions) ([]ResponsePart, error)
	OpenStream(opts *StreamOptions) (ResponseStream, error)
}

// PromptGenerator renders system prompt instructions and examples for an InferenceFormat.
type PromptGenerator interface {
	Catalogs() []*core.Catalog
	Generate() (string, error)
	GenerateBaseRules(allowedMessages []string) string
	GenerateCatalogInstructions(includeSchema bool, catalog *core.Catalog) string
	GenerateExamples(catalog *core.Catalog, validate bool) (string, error)
}

// AssembleInstructions joins a PromptGenerator's base rules, catalog instructions, and examples.
func AssembleInstructions(pg PromptGenerator, catalogs []*core.Catalog) (string, error) {
	ownCatalogs := pg.Catalogs()
	targets := ownCatalogs
	isOwn := true
	if catalogs != nil {
		targets = catalogs
		isOwn = sameCatalogSlice(targets, ownCatalogs)
	}

	var parts []string
	if base := pg.GenerateBaseRules(nil); base != "" {
		parts = append(parts, base)
	}

	var exampleBlocks []string
	if isOwn {
		if inst := pg.GenerateCatalogInstructions(true, nil); inst != "" {
			parts = append(parts, inst)
		}
		ex, err := pg.GenerateExamples(nil, false)
		if err != nil {
			return "", err
		}
		if ex != "" {
			exampleBlocks = append(exampleBlocks, ex)
		}
	} else {
		seenExamples := make(map[string]bool)
		for _, cat := range targets {
			if inst := pg.GenerateCatalogInstructions(true, cat); inst != "" {
				parts = append(parts, inst)
			}
			ex, err := pg.GenerateExamples(cat, false)
			if err != nil {
				return "", err
			}
			if ex != "" && !seenExamples[ex] {
				seenExamples[ex] = true
				exampleBlocks = append(exampleBlocks, ex)
			}
		}
	}
	if len(exampleBlocks) > 0 {
		parts = append(parts, ExamplesHeading+"\n\n"+strings.Join(exampleBlocks, "\n\n"))
	}
	return strings.Join(parts, "\n\n"), nil
}

func sameCatalogSlice(a, b []*core.Catalog) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// InferenceFormat binds negotiated catalogs and examples to a PromptGenerator and Parser factory.
type InferenceFormat interface {
	Catalogs() []*core.Catalog
	PromptGenerator() PromptGenerator
	CreateParser() Parser
	SupportsStreaming() bool
}

// InferenceFormatFactory creates InferenceFormat instances for negotiated catalogs and examples.
type InferenceFormatFactory interface {
	CreateFormat(catalogs []*core.Catalog, examples [][]core.AgentToRendererMessage) (InferenceFormat, error)
}

// StreamChunks adapts a Go iter.Seq2[string, error] chunk stream into an iter.Seq2[StreamPart, error].
func StreamChunks(ctx context.Context, stream ResponseStream, chunks iter.Seq2[string, error]) iter.Seq2[StreamPart, error] {
	return func(yield func(StreamPart, error) bool) {
		for chunk, err := range chunks {
			if ctxErr := ctx.Err(); ctxErr != nil {
				yield(StreamPart{}, ctxErr)
				return
			}
			if err != nil {
				yield(StreamPart{}, err)
				return
			}
			parts, feedErr := stream.Feed(chunk)
			for _, p := range parts {
				if !yield(p, nil) {
					return
				}
			}
			if feedErr != nil {
				yield(StreamPart{}, feedErr)
				return
			}
		}
		if ctxErr := ctx.Err(); ctxErr != nil {
			yield(StreamPart{}, ctxErr)
			return
		}
		finalParts, closeErr := stream.Close()
		for _, p := range finalParts {
			if !yield(p, nil) {
				return
			}
		}
		if closeErr != nil {
			yield(StreamPart{}, closeErr)
		}
	}
}
