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
	"errors"
	"maps"
	"slices"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent/internal/blocklexer"
	"github.com/a2ui-project/a2ui/go/agent/internal/express"
	"github.com/a2ui-project/a2ui/go/core"
)

var expressBlockLexer = blocklexer.MustNew(&blocklexer.Options{
	OpenTag:            InferenceOpenTag,
	CloseTag:           InferenceCloseTag,
	StringDelimiters:   []byte{'"'},
	SingleLineComments: []string{"#", "//", "--"},
	BlockComments:      []blocklexer.BlockCommentPair{{Open: "/*", Close: "*/"}},
})

// DefaultExpressProgressiveKeys returns the default progressive string keys ("text") healed during Express streaming.
func DefaultExpressProgressiveKeys() []string {
	return []string{"text"}
}

// ExpressFormatOptions configures ExpressFormat and ExpressFormatFactory.
// The zero value of each field is the default.
type ExpressFormatOptions struct {
	// AllowedMessages restricts the message envelopes taught by the prompt when non-empty; empty allows all messages.
	AllowedMessages []string
	SurfaceID       string
	Version         core.ProtocolVersion
	// ProgressiveKeys overrides DefaultExpressProgressiveKeys when non-empty.
	ProgressiveKeys []string
	// DisableProgressiveHealing disables progressive string healing during streaming when true.
	DisableProgressiveHealing bool
}

func normalizeExpressFormatOptions(opts *ExpressFormatOptions) ExpressFormatOptions {
	var resolved ExpressFormatOptions
	if opts != nil {
		resolved = *opts
		if len(opts.AllowedMessages) > 0 {
			resolved.AllowedMessages = slices.Clone(opts.AllowedMessages)
		} else {
			resolved.AllowedMessages = nil
		}
	}
	if resolved.SurfaceID == "" {
		resolved.SurfaceID = "main"
	}
	if resolved.DisableProgressiveHealing {
		resolved.ProgressiveKeys = nil
	} else if len(resolved.ProgressiveKeys) > 0 {
		resolved.ProgressiveKeys = slices.Clone(resolved.ProgressiveKeys)
	} else {
		resolved.ProgressiveKeys = DefaultExpressProgressiveKeys()
	}
	return resolved
}

// ExpressFormat implements InferenceFormat for the compact <a2ui> Express DSL.
type ExpressFormat struct {
	catalogs []*core.Catalog
	examples [][]core.AgentToRendererMessage
	opts     ExpressFormatOptions
	prompt   *ExpressPromptGenerator
	parser   *ExpressParser
}

// NewExpressFormat constructs an ExpressFormat for catalogs and examples.
func NewExpressFormat(catalogs []*core.Catalog, examples [][]core.AgentToRendererMessage, opts *ExpressFormatOptions) (*ExpressFormat, error) {
	checked, err := CheckMixedCatalogs(catalogs)
	if err != nil {
		return nil, err
	}
	resolved := normalizeExpressFormatOptions(opts)
	clonedExamples := cloneExampleTurns(examples)
	pg, err := newExpressPromptGenerator(checked, clonedExamples, &resolved)
	if err != nil {
		return nil, err
	}
	parser, err := NewExpressParser(checked, &resolved)
	if err != nil {
		return nil, err
	}
	return &ExpressFormat{
		catalogs: checked,
		examples: clonedExamples,
		opts:     resolved,
		prompt:   pg,
		parser:   parser,
	}, nil
}

// Catalogs returns a copy of the format's active catalogs.
func (f *ExpressFormat) Catalogs() []*core.Catalog {
	return slices.Clone(f.catalogs)
}

// SupportsStreaming reports that ExpressFormat supports incremental chunk streaming.
func (f *ExpressFormat) SupportsStreaming() bool { return true }

// PromptGenerator returns the ExpressPromptGenerator configured for this format.
func (f *ExpressFormat) PromptGenerator() PromptGenerator {
	return f.prompt
}

// CreateParser returns a new stateless ExpressParser for this format. Parsers share the
// format's immutable compiler and decompiler, so creating one is cheap.
func (f *ExpressFormat) CreateParser() Parser {
	clone := *f.parser
	return &clone
}

// ExpressFormatFactory implements InferenceFormatFactory for Express DSL (the SDK default).
type ExpressFormatFactory struct {
	opts ExpressFormatOptions
}

// NewExpressFormatFactory constructs an ExpressFormatFactory.
func NewExpressFormatFactory(opts *ExpressFormatOptions) *ExpressFormatFactory {
	return &ExpressFormatFactory{opts: normalizeExpressFormatOptions(opts)}
}

// CreateFormat binds catalogs and examples to a new ExpressFormat.
func (f *ExpressFormatFactory) CreateFormat(catalogs []*core.Catalog, examples [][]core.AgentToRendererMessage) (InferenceFormat, error) {
	return NewExpressFormat(catalogs, examples, &f.opts)
}

// ExpressDecompiler converts A2UI wire JSON envelopes back into A2UI Express DSL notation.
type ExpressDecompiler struct {
	inner *express.Decompiler
}

// NewExpressDecompiler constructs an ExpressDecompiler for catalogs and an optional protocol version override.
func NewExpressDecompiler(catalogs []*core.Catalog, version string) (*ExpressDecompiler, error) {
	checked, err := CheckMixedCatalogs(catalogs)
	if err != nil {
		return nil, err
	}
	dec, err := express.NewDecompiler(checked, version)
	if err != nil {
		return nil, err
	}
	return &ExpressDecompiler{inner: dec}, nil
}

// Catalogs returns a copy of the decompiler's active catalogs.
func (d *ExpressDecompiler) Catalogs() []*core.Catalog {
	return d.inner.Catalogs()
}

// Decompile converts A2UI messages into positional A2UI Express DSL statements.
func (d *ExpressDecompiler) Decompile(payload []core.AgentToRendererMessage) (string, error) {
	return d.inner.Decompile(payload, false)
}

// DecompileKeywordArgs converts A2UI messages into A2UI Express DSL statements that pass
// every component property as a keyword argument (param=value).
func (d *ExpressDecompiler) DecompileKeywordArgs(payload []core.AgentToRendererMessage) (string, error) {
	return d.inner.Decompile(payload, true)
}

// WrapDecompiledBlocks encloses decompiled Express blocks in <a2ui> sentinel tags.
func (d *ExpressDecompiler) WrapDecompiledBlocks(blocks []string) string {
	return d.inner.WrapDecompiledBlocks(blocks)
}

// ExpressPromptGenerator renders catalog-agnostic positional signatures and grammar rules for Express DSL.
type ExpressPromptGenerator struct {
	inner *express.PromptGenerator
}

// newExpressPromptGenerator constructs the ExpressPromptGenerator that ExpressFormat.PromptGenerator returns.
func newExpressPromptGenerator(
	catalogs []*core.Catalog,
	examples [][]core.AgentToRendererMessage,
	opts *ExpressFormatOptions,
) (*ExpressPromptGenerator, error) {
	pg, err := express.NewPromptGenerator(catalogs, express.PromptGeneratorOptions{
		Examples:        examples,
		AllowedMessages: opts.AllowedMessages,
		Version:         string(opts.Version),
		Validate:        ValidatePayload,
	})
	if err != nil {
		return nil, err
	}
	return &ExpressPromptGenerator{inner: pg}, nil
}

// Catalogs returns a copy of the prompt generator's active catalogs.
func (g *ExpressPromptGenerator) Catalogs() []*core.Catalog {
	return g.inner.Catalogs()
}

// Generate renders the complete Express system prompt contract, signatures, and examples.
func (g *ExpressPromptGenerator) Generate() (string, error) {
	return g.inner.Generate(express.GenerateOptions{IncludeSchema: true, IncludeExamples: true})
}

// GenerateBaseRules renders the Express syntax contract, multi-catalog rules, and system function signatures.
func (g *ExpressPromptGenerator) GenerateBaseRules(allowedMessages []string) string {
	return g.inner.GenerateBaseRules(allowedMessages)
}

// GenerateCatalogInstructions renders positional component and function signatures for one or all catalogs.
func (g *ExpressPromptGenerator) GenerateCatalogInstructions(includeSchema bool, catalog *core.Catalog) string {
	return g.inner.GenerateCatalogInstructions(includeSchema, catalog)
}

// GenerateExamples formats few-shot Express DSL example turns.
func (g *ExpressPromptGenerator) GenerateExamples(catalog *core.Catalog, validate bool) (string, error) {
	return g.inner.GenerateExamples(catalog, validate)
}

// TransformExamples converts ```json and ---BEGIN/END--- JSON blocks in markdown into Express DSL blocks.
func (g *ExpressPromptGenerator) TransformExamples(rawExamplesMarkdown string) string {
	return g.inner.TransformExamples(rawExamplesMarkdown)
}

// ExpressParser compiles, decompiles, and streams <a2ui> Express DSL responses.
// Construct it with NewExpressParser or ExpressFormat.CreateParser; it holds no
// per-response state and is safe for concurrent use.
type ExpressParser struct {
	catalogs        []*core.Catalog
	surfaceID       string
	version         string
	progressiveKeys map[string]bool
	compiler        *express.Compiler
	decompiler      *express.Decompiler
}

// NewExpressParser constructs a reusable stateless ExpressParser for catalogs.
func NewExpressParser(catalogs []*core.Catalog, opts *ExpressFormatOptions) (*ExpressParser, error) {
	checked, err := CheckMixedCatalogs(catalogs)
	if err != nil {
		return nil, err
	}
	resolved := normalizeExpressFormatOptions(opts)
	verStr := string(resolved.Version)
	compiler, err := express.NewCompiler(checked, verStr)
	if err != nil {
		return nil, err
	}
	decompiler, err := express.NewDecompiler(checked, verStr)
	if err != nil {
		return nil, err
	}
	progSet := make(map[string]bool, len(resolved.ProgressiveKeys))
	for _, k := range resolved.ProgressiveKeys {
		progSet[k] = true
	}
	return &ExpressParser{
		catalogs:        checked,
		surfaceID:       resolved.SurfaceID,
		version:         verStr,
		progressiveKeys: progSet,
		compiler:        compiler,
		decompiler:      decompiler,
	}, nil
}

// Catalogs returns a copy of the parser's active catalogs.
func (p *ExpressParser) Catalogs() []*core.Catalog {
	return slices.Clone(p.catalogs)
}

// SupportsStreaming reports that ExpressParser supports incremental chunk streaming.
func (p *ExpressParser) SupportsStreaming() bool { return true }

// HasFormatContent reports whether content contains an <a2ui> block (requiring a closing tag when complete is true).
func (p *ExpressParser) HasFormatContent(content string, complete bool) bool {
	for _, part := range p.Unwrap(content) {
		if part.IsA2UI() && (!complete || part.IsFinal) {
			return true
		}
	}
	return false
}

// Wrap joins text and raw A2UI blocks into a single LLM-formatted string.
func (p *ExpressParser) Wrap(blocks []RawResponsePart) string {
	out := make([]string, 0, len(blocks))
	for _, b := range blocks {
		if b.IsText() {
			out = append(out, b.Text)
		} else {
			out = append(out, InferenceOpenTag+"\n"+b.A2UIRaw+"\n"+InferenceCloseTag)
		}
	}
	return strings.Join(out, "\n")
}

// Unwrap tokenizes content into conversational text and raw Express DSL blocks.
func (p *ExpressParser) Unwrap(content string) []RawResponsePart {
	rawBlocks := expressBlockLexer.Tokenize(content)
	parts := make([]RawResponsePart, 0, len(rawBlocks))
	for _, rb := range rawBlocks {
		if rb.IsText {
			parts = append(parts, NewRawTextPart(rb.Text))
		} else {
			parts = append(parts, NewRawA2UIPart(rb.A2UIRaw, rb.IsFinal))
		}
	}
	return parts
}

// Compile compiles raw Express DSL statements into A2UI wire messages.
func (p *ExpressParser) Compile(raw string, isFinal bool) ([]core.AgentToRendererMessage, error) {
	msgs, err := p.compiler.Compile(raw, p.surfaceID, isFinal, p.version)
	if err != nil {
		return nil, wrapExpressCompilationError(err, raw)
	}
	return msgs, nil
}

// Decompile converts A2UI wire messages into Express DSL statements.
func (p *ExpressParser) Decompile(payload []core.AgentToRendererMessage) (string, error) {
	return p.decompiler.Decompile(payload, false)
}

// WrapDecompiledBlocks encloses decompiled Express blocks in <a2ui> sentinel tags.
func (p *ExpressParser) WrapDecompiledBlocks(blocks []string) string {
	return p.decompiler.WrapDecompiledBlocks(blocks)
}

// ParseResponse parses and validates a complete LLM response string.
func (p *ExpressParser) ParseResponse(content string, opts *ParseOptions) ([]ResponsePart, error) {
	return ExecuteParseResponse(p, content, opts)
}

// OpenStream opens an incremental ResponseStream that compiles Express DSL chunk by chunk.
func (p *ExpressParser) OpenStream(opts *StreamOptions) (ResponseStream, error) {
	var resolved StreamOptions
	if opts != nil {
		resolved = *opts
	}
	wrapped := !resolved.Unwrapped
	state := resolved.State
	if state == nil {
		var err error
		state, err = NewRendererState(p.catalogs)
		if err != nil {
			return nil, err
		}
	}
	continues := resolved.AfterRejectedBlock == AfterRejectedContinue

	progKeys := maps.Clone(p.progressiveKeys)
	if progKeys == nil {
		progKeys = make(map[string]bool)
	}

	st := &ExpressResponseStream{
		parser:          p,
		compiler:        p.compiler,
		wrapped:         wrapped,
		state:           state,
		continues:       continues,
		progressiveKeys: progKeys,
		inBlock:         !wrapped,
	}
	st.resetBlock()
	return st, nil
}

func wrapExpressCompilationError(err error, rawContent string) error {
	if err == nil {
		return nil
	}
	var compErr *CompilationError
	if errors.As(err, &compErr) {
		return err
	}
	var parseErr *express.ParseError
	if errors.As(err, &parseErr) {
		help := parseErr.HelpMessage
		if help == "" {
			help = "Please correct the syntax error in your Express DSL."
		}
		return NewCompilationParseError(parseErr.Message, rawContent, parseErr.Line, parseErr.Column, help)
	}
	var valErr *express.ValidationError
	if errors.As(err, &valErr) {
		help := valErr.HelpMessage
		if help == "" {
			help = "Please correct the syntax error in your Express DSL."
		}
		return NewCompilationValidationError(valErr.Message, rawContent, help, valErr.Details...)
	}
	var catErr core.CategorizedError
	if errors.As(err, &catErr) {
		return err
	}
	ce := NewCompilationError("Failed to compile A2UI block: "+err.Error(), rawContent)
	ce.Cause = err
	return ce
}

// ExpressResponseStream reads and compiles a streamed A2UI Express response chunk by chunk.
// A stream belongs to one response and is not safe for concurrent use; open one stream
// per response with ExpressParser.OpenStream.
type ExpressResponseStream struct {
	parser                  *ExpressParser
	compiler                *express.Compiler
	wrapped                 bool
	state                   *RendererState
	continues               bool
	progressiveKeys         map[string]bool
	closed                  bool
	held                    string
	text                    blocklexer.TextRun
	afterBlock              bool
	wrappedInInlineBacktick bool
	inBlock                 bool
	rejected                bool
	block                   strings.Builder
	scanPos                 int
	lastCompiledPrefix      string
	touchedOrder            []string
	touchedSeen             map[string]bool
	initialSurfaces         map[string]bool
	session                 *express.ScopeSession
}

func (s *ExpressResponseStream) newSession() *express.ScopeSession {
	return express.NewScopeSession(s.compiler, s.parser.surfaceID, s.parser.version)
}

func (s *ExpressResponseStream) resetBlock() {
	s.block.Reset()
	s.scanPos = 0
	s.rejected = false
	s.lastCompiledPrefix = ""
	s.touchedOrder = nil
	s.touchedSeen = make(map[string]bool)
	s.initialSurfaces = make(map[string]bool)
	for _, sid := range s.state.SurfaceIDs() {
		s.initialSurfaces[sid] = true
	}
	s.session = s.newSession()
}

// State returns the RendererState tracking surfaces across this stream.
func (s *ExpressResponseStream) State() *RendererState {
	return s.state
}

// IsInBlock reports whether the stream currently sits inside an open <a2ui> block.
func (s *ExpressResponseStream) IsInBlock() bool {
	return !s.closed && s.inBlock
}

// Feed ingests the next response text chunk and returns any ready StreamParts.
func (s *ExpressResponseStream) Feed(chunk string) ([]StreamPart, error) {
	if s.closed {
		return nil, ErrStreamClosed
	}
	var parts []StreamPart
	if err := s.feed(chunk, &parts); err != nil {
		return parts, s.fail(err, parts)
	}
	return parts, nil
}

// Close finalizes the response stream, flushing trailing text or rejecting an unclosed block.
func (s *ExpressResponseStream) Close() ([]StreamPart, error) {
	if s.closed {
		return nil, nil
	}
	s.closed = true
	var parts []StreamPart
	if !s.wrapped {
		if !s.rejected {
			if err := s.readBlock(&parts, func() error {
				return s.finishBlock(&parts, s.block.Len())
			}); err != nil {
				return parts, s.fail(err, parts)
			}
		}
		return parts, nil
	}
	if s.inBlock {
		if !s.rejected {
			if err := s.readBlock(&parts, raiseUnclosedExpressBlock); err != nil {
				return parts, s.fail(err, parts)
			}
		}
		s.state.MarkChecked(s.touchedOrder)
		return parts, nil
	}
	if s.held != "" {
		rest := s.held
		s.held = ""
		if s.afterBlock {
			rest = express.StripOuterLeadingFence(rest, s.wrappedInInlineBacktick)
			s.wrappedInInlineBacktick = false
		}
		cleaned := express.StripTrailingFenceClose(rest)
		s.emitText(&parts, cleaned)
	}
	return parts, nil
}

func raiseUnclosedExpressBlock() error {
	return core.NewParseErrorf(
		"The response ended inside an %s block, before its %s tag.",
		InferenceOpenTag,
		InferenceCloseTag,
	)
}

func (s *ExpressResponseStream) emitText(parts *[]StreamPart, text string) {
	if out, ok := s.text.Emit(text); ok {
		*parts = append(*parts, NewStreamTextPart(out))
	}
}

func (s *ExpressResponseStream) fail(err error, parts []StreamPart) error {
	s.closed = true
	s.state.MarkChecked(s.touchedOrder)
	var partials []ResponsePart
	for _, p := range parts {
		if rp, ok := p.ToResponsePart(); ok {
			partials = append(partials, rp)
		}
	}
	return attachPartialResults(err, partials, s.block.String())
}

func (s *ExpressResponseStream) readBlock(parts *[]StreamPart, step func() error) error {
	err := step()
	if err == nil {
		return nil
	}
	var catErr core.CategorizedError
	if errors.As(err, &catErr) {
		if !s.continues {
			return err
		}
		*parts = append(*parts, NewStreamErrorPart(err))
		s.state.MarkChecked(s.touchedOrder)
		s.rejected = true
		return nil
	}
	return err
}

func (s *ExpressResponseStream) feed(chunk string, parts *[]StreamPart) error {
	if !s.wrapped {
		s.block.WriteString(chunk)
		if !s.rejected {
			return s.readBlock(parts, func() error {
				return s.emitReady(parts, s.block.Len())
			})
		}
		return nil
	}

	inputStr := s.held + chunk
	s.held = ""
	for inputStr != "" {
		if s.inBlock {
			rem, err := s.consumeBlockText(parts, inputStr)
			if err != nil {
				return err
			}
			inputStr = rem
			continue
		}
		if s.afterBlock {
			complete := blocklexer.CompleteUTF8PrefixLen(inputStr)
			if express.MatchesOuterLeadingFencePrefix(inputStr[:complete], s.wrappedInInlineBacktick) {
				s.held = inputStr
				return nil
			}
			s.afterBlock = false
			inputStr = express.StripOuterLeadingFence(inputStr, s.wrappedInInlineBacktick)
			s.wrappedInInlineBacktick = false
			continue
		}
		inputStr = s.consumeOutsideText(parts, inputStr)
	}
	return nil
}

func (s *ExpressResponseStream) consumeBlockText(parts *[]StreamPart, inputStr string) (string, error) {
	s.block.WriteString(inputStr)
	blockStr := s.block.String()
	closeStart, hasClose, readableEnd, nextScanPos := express.ScanExpressBlockFrom(blockStr, s.scanPos)
	s.scanPos = nextScanPos
	if !hasClose {
		if !s.rejected {
			if err := s.readBlock(parts, func() error {
				return s.emitReady(parts, readableEnd)
			}); err != nil {
				return "", err
			}
		}
		return "", nil
	}
	loc := express.CloseTagRe.FindStringIndex(blockStr[closeStart:])
	closeEnd := closeStart + len(InferenceCloseTag)
	if loc != nil {
		closeEnd = closeStart + loc[1]
	}
	remaining := strings.Clone(blockStr[closeEnd:])
	if !s.rejected {
		if err := s.readBlock(parts, func() error {
			return s.finishBlock(parts, closeStart)
		}); err != nil {
			return "", err
		}
	}
	s.inBlock = false
	s.afterBlock = true
	s.resetBlock()
	return remaining, nil
}

func (s *ExpressResponseStream) consumeOutsideText(parts *[]StreamPart, inputStr string) string {
	if loc := express.OpenTagRe.FindStringIndex(inputStr); loc != nil {
		beforeOpen := inputStr[:loc[0]]
		s.wrappedInInlineBacktick = express.HasOuterInlineOpenBacktick(beforeOpen)
		textBefore := express.StripOuterTrailingFence(beforeOpen)
		s.emitText(parts, textBefore)
		s.text.Reset()
		s.inBlock = true
		s.resetBlock()
		return inputStr[loc[1]:]
	}

	tagStart := express.PossibleOpenTagStart(inputStr)
	hold := express.PossibleOuterFenceStart(inputStr[:tagStart])
	if hold == len(inputStr) {
		hold = blocklexer.CompleteUTF8PrefixLen(inputStr)
	}
	s.emitText(parts, inputStr[:hold])
	s.held = inputStr[hold:]
	return ""
}

func (s *ExpressResponseStream) emitReady(parts *[]StreamPart, end int) error {
	payload, ok := express.CleanExpressPayload(s.block.String(), end)
	if !ok || strings.TrimSpace(payload) == "" {
		return nil
	}
	var completePrefix, trailingFragment string
	if (strings.HasSuffix(s.lastCompiledPrefix, "\n") || strings.HasSuffix(s.lastCompiledPrefix, ";")) &&
		strings.HasPrefix(payload, s.lastCompiledPrefix) {
		tail := payload[len(s.lastCompiledPrefix):]
		tailComplete, tailFrag := express.SplitCompleteStatements(tail, false)
		if tailComplete == "" {
			completePrefix = s.lastCompiledPrefix
		} else if strings.HasPrefix(tail, tailComplete) {
			completePrefix = payload[:len(s.lastCompiledPrefix)+len(tailComplete)]
		} else {
			completePrefix = s.lastCompiledPrefix + tailComplete
		}
		trailingFragment = tailFrag
	} else {
		completePrefix, trailingFragment = express.SplitCompleteStatements(payload, false)
	}

	var prefixMsgs []core.AgentToRendererMessage
	if completePrefix != s.lastCompiledPrefix && strings.TrimSpace(completePrefix) != "" {
		snap := s.session.Snapshot()
		savedOrder := slices.Clone(s.touchedOrder)
		savedSeen := maps.Clone(s.touchedSeen)
		txErr := s.state.Transaction(func() error {
			msgs, err := s.compileStep(completePrefix, false, true)
			if err != nil {
				return err
			}
			prefixMsgs = msgs
			if len(prefixMsgs) > 0 {
				return s.apply(prefixMsgs)
			}
			return nil
		})
		if txErr != nil {
			s.session.Restore(snap)
			s.touchedOrder = savedOrder
			s.touchedSeen = savedSeen
			return txErr
		}
		s.lastCompiledPrefix = completePrefix
	}

	healedMsgs := s.tryCompileAndApplyHealed(completePrefix, trailingFragment)
	var allReady []core.AgentToRendererMessage
	allReady = append(allReady, prefixMsgs...)
	allReady = append(allReady, healedMsgs...)
	ready := express.MergeSameSurfaceUpdates(allReady)
	if len(ready) > 0 {
		*parts = append(*parts, NewStreamA2UIPart(ready))
	}
	return nil
}

func (s *ExpressResponseStream) tryCompileAndApplyHealed(completePrefix, trailingFragment string) []core.AgentToRendererMessage {
	healed, ok := express.HealProgressiveFragment(
		trailingFragment,
		s.compiler.Helpers,
		s.compiler.CatalogOrder,
		s.progressiveKeys,
	)
	if !ok {
		return nil
	}
	combined := healed
	if strings.TrimSpace(completePrefix) != "" {
		combined = completePrefix + "\n" + healed
	}
	snap := s.session.Snapshot()
	savedOrder := slices.Clone(s.touchedOrder)
	savedSeen := maps.Clone(s.touchedSeen)

	var msgs []core.AgentToRendererMessage
	txErr := s.state.Transaction(func() error {
		compiled, err := s.compileStep(combined, false, false)
		if err != nil {
			return err
		}
		msgs = compiled
		if len(msgs) > 0 {
			return s.apply(msgs)
		}
		return nil
	})
	if txErr != nil {
		s.session.Restore(snap)
		s.touchedOrder = savedOrder
		s.touchedSeen = savedSeen
		return nil
	}
	return msgs
}

func (s *ExpressResponseStream) finishBlock(parts *[]StreamPart, end int) error {
	payload, _ := express.CleanExpressPayload(s.block.String(), end)
	var models []core.AgentToRendererMessage
	txErr := s.state.Transaction(func() error {
		if !s.session.HasEmitted && len(s.initialSurfaces) == 0 {
			rawModels, err := s.parser.Compile(payload, true)
			if err != nil {
				return err
			}
			if err := s.apply(rawModels); err != nil {
				return err
			}
			models = rawModels
		} else {
			msgs, err := s.compileStep(payload, true, true)
			if err != nil {
				return err
			}
			if len(msgs) > 0 {
				if err := s.apply(msgs); err != nil {
					return err
				}
			}
			models = msgs
		}
		return s.state.CheckTopology(s.touchedOrder)
	})
	if txErr != nil {
		return txErr
	}
	if len(models) > 0 {
		*parts = append(*parts, NewStreamA2UIPart(models))
	}
	return nil
}

func (s *ExpressResponseStream) compileStep(source string, isFinal, cachePrefix bool) ([]core.AgentToRendererMessage, error) {
	msgs, err := s.session.CompileStep(source, isFinal, s.initialSurfaces, cachePrefix)
	if err != nil {
		return nil, wrapExpressCompilationError(err, source)
	}
	return msgs, nil
}

func (s *ExpressResponseStream) apply(messages []core.AgentToRendererMessage) error {
	for _, sup := range s.session.SupersededComponents {
		s.state.DropProvisionalComponent(sup.SurfaceID, sup.ComponentID)
	}
	s.session.SupersededComponents = nil
	touched, err := s.state.Apply(messages)
	if err != nil {
		return err
	}
	for _, sid := range touched {
		if !s.touchedSeen[sid] {
			s.touchedSeen[sid] = true
			s.touchedOrder = append(s.touchedOrder, sid)
		}
	}
	return nil
}
