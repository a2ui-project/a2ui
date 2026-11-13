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
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"slices"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent/internal/blocklexer"
	"github.com/a2ui-project/a2ui/go/agent/internal/directjson"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	// SchemaBlockStart marks the beginning of an A2UI JSON Schema prompt section.
	SchemaBlockStart = "---BEGIN A2UI JSON SCHEMA---"
	// SchemaBlockEnd marks the end of an A2UI JSON Schema prompt section.
	SchemaBlockEnd = "---END A2UI JSON SCHEMA---"

	// DefaultWorkflowRules contains the standard Direct JSON output instructions.
	DefaultWorkflowRules = "\nThe generated response MUST follow these rules:\n" +
		"- The response can contain one or more A2UI JSON blocks.\n" +
		"- Each A2UI JSON block MUST be wrapped in literal `<a2ui-json>` and `</a2ui-json>` tags (always include both the opening and closing tags; do NOT wrap the tags in backticks or replace the opening tag with a markdown code fence such as ```json).\n" +
		"- Between or around these blocks, you can provide conversational text.\n" +
		"- The JSON part MUST be a JSON array of A2UI messages, each following the provided A2UI JSON SCHEMA.\n" +
		"- Top-Down Component Ordering: Within the `components` list of a message:\n" +
		"    - The 'root' component MUST be the FIRST element.\n" +
		"    - Parent components MUST appear before their child components.\n" +
		"    This specific ordering allows the streaming parser to yield and render the UI incrementally as it arrives.\n"
)

var (
	streamLeadingFenceFullRE  = regexp.MustCompile(`\A\s*(?:` + "```" + `[a-zA-Z-]*\s*|` + "`+" + `\s*)?\z`)
	streamTrailingFenceFullRE = regexp.MustCompile(`\A\s*(?:` + "```" + `[a-zA-Z-]*|` + "`+" + `)?\s*\z`)
	streamTrailingTicksRE     = regexp.MustCompile("`+\\z")

	growingFields = map[string]string{
		"updateComponents": "components",
		"surfaceUpdate":    "components",
		"updateDataModel":  "value",
		"dataModelUpdate":  "contents",
	}

	growingFieldOrder = []string{
		"updateComponents",
		"surfaceUpdate",
		"updateDataModel",
		"dataModelUpdate",
	}

	directJSONBlockLexer = blocklexer.JSONBlockLexer()
)

// DefaultDirectJSONProgressiveKeys returns the default string keys eligible for progressive streaming healing when opted in.
func DefaultDirectJSONProgressiveKeys() []string {
	return []string{
		"literalString",
		"valueString",
		"label",
		"hint",
		"caption",
		"altText",
		"text",
	}
}

// DirectJSONFormatOptions configures DirectJSONFormat and DirectJSONFormatFactory.
// The zero value of each field is the default.
type DirectJSONFormatOptions struct {
	// AllowedMessages restricts the message envelopes taught by the prompt when non-empty; empty allows all messages.
	AllowedMessages            []string
	ProgressiveKeys            []string
	DisableProgressiveHealing  bool
	BufferIncompleteComponents bool
}

func normalizeDirectJSONFormatOptions(opts *DirectJSONFormatOptions) DirectJSONFormatOptions {
	var resolved DirectJSONFormatOptions
	if opts != nil {
		resolved = *opts
		if len(opts.AllowedMessages) > 0 {
			resolved.AllowedMessages = append([]string(nil), opts.AllowedMessages...)
		} else {
			resolved.AllowedMessages = nil
		}
		if resolved.DisableProgressiveHealing || len(opts.ProgressiveKeys) == 0 {
			resolved.ProgressiveKeys = nil
		} else {
			resolved.ProgressiveKeys = append([]string(nil), opts.ProgressiveKeys...)
		}
	}
	return resolved
}

// DirectJSONFormat implements InferenceFormat for standard <a2ui-json> JSON envelopes.
type DirectJSONFormat struct {
	catalogs []*core.Catalog
	examples [][]core.AgentToRendererMessage
	opts     DirectJSONFormatOptions
	prompt   *DirectJSONPromptGenerator
}

// NewDirectJSONFormat constructs a DirectJSONFormat for catalogs and examples.
func NewDirectJSONFormat(catalogs []*core.Catalog, examples [][]core.AgentToRendererMessage, opts *DirectJSONFormatOptions) (*DirectJSONFormat, error) {
	checked, err := CheckCatalogs(catalogs)
	if err != nil {
		return nil, err
	}
	resolved := normalizeDirectJSONFormatOptions(opts)
	return &DirectJSONFormat{
		catalogs: checked,
		examples: cloneExampleTurns(examples),
		opts:     resolved,
		prompt: &DirectJSONPromptGenerator{
			catalogs:        checked,
			examples:        cloneExampleTurns(examples),
			allowedMessages: resolved.AllowedMessages,
		},
	}, nil
}

// Catalogs returns a copy of the format's active catalogs.
func (f *DirectJSONFormat) Catalogs() []*core.Catalog {
	return append([]*core.Catalog(nil), f.catalogs...)
}

// SupportsStreaming reports that DirectJSONFormat supports incremental chunk streaming.
func (f *DirectJSONFormat) SupportsStreaming() bool { return true }

// PromptGenerator returns the DirectJSONPromptGenerator configured for this format.
func (f *DirectJSONFormat) PromptGenerator() PromptGenerator {
	return f.prompt
}

// CreateParser returns a fresh stateless DirectJSONParser.
func (f *DirectJSONFormat) CreateParser() Parser {
	progSet := make(map[string]bool, len(f.opts.ProgressiveKeys))
	for _, k := range f.opts.ProgressiveKeys {
		progSet[k] = true
	}
	return &DirectJSONParser{
		catalogs:                   append([]*core.Catalog(nil), f.catalogs...),
		progressiveKeys:            progSet,
		bufferIncompleteComponents: f.opts.BufferIncompleteComponents,
		decompiler:                 &DirectJSONDecompiler{catalogs: f.catalogs},
	}
}

// DirectJSONFormatFactory implements InferenceFormatFactory for Direct JSON.
type DirectJSONFormatFactory struct {
	opts DirectJSONFormatOptions
}

// NewDirectJSONFormatFactory constructs a DirectJSONFormatFactory.
func NewDirectJSONFormatFactory(opts *DirectJSONFormatOptions) *DirectJSONFormatFactory {
	return &DirectJSONFormatFactory{opts: normalizeDirectJSONFormatOptions(opts)}
}

// CreateFormat binds catalogs and examples to a new DirectJSONFormat.
func (f *DirectJSONFormatFactory) CreateFormat(catalogs []*core.Catalog, examples [][]core.AgentToRendererMessage) (InferenceFormat, error) {
	return NewDirectJSONFormat(catalogs, examples, &f.opts)
}

// DirectJSONDecompiler serializes A2UI wire messages as pretty-printed 2-space indented JSON.
type DirectJSONDecompiler struct {
	catalogs []*core.Catalog
}

// NewDirectJSONDecompiler constructs a DirectJSONDecompiler with optional catalog metadata for property ordering.
func NewDirectJSONDecompiler(catalogs []*core.Catalog) *DirectJSONDecompiler {
	return &DirectJSONDecompiler{catalogs: append([]*core.Catalog(nil), catalogs...)}
}

// Decompile converts payload into a 2-space indented JSON array string.
func (d *DirectJSONDecompiler) Decompile(payload []core.AgentToRendererMessage) (string, error) {
	var cats []*core.Catalog
	if d != nil {
		cats = d.catalogs
	}
	return directjson.MarshalMessagesIndented(payload, cats)
}

// WrapDecompiledBlocks encloses decompiled JSON strings in <a2ui-json> sentinel tags.
func (d *DirectJSONDecompiler) WrapDecompiledBlocks(blocks []string) string {
	return JSONOpenTag + "\n" + strings.Join(blocks, "\n") + "\n" + JSONCloseTag
}

// DirectJSONPromptGenerator renders JSON Schema system prompts for Direct JSON.
type DirectJSONPromptGenerator struct {
	catalogs        []*core.Catalog
	examples        [][]core.AgentToRendererMessage
	allowedMessages []string
}

// Catalogs returns a copy of the catalogs described by this prompt generator.
func (g *DirectJSONPromptGenerator) Catalogs() []*core.Catalog {
	return append([]*core.Catalog(nil), g.catalogs...)
}

// Generate renders the full Direct JSON system prompt snippet for all configured catalogs.
func (g *DirectJSONPromptGenerator) Generate() (string, error) {
	return AssembleInstructions(g, nil)
}

// GenerateBaseRules renders workflow rules and the protocol schema block (agent-to-renderer + pruned common types).
func (g *DirectJSONPromptGenerator) GenerateBaseRules(allowedMessages []string) string {
	if len(g.catalogs) == 0 {
		return ""
	}
	effectiveAllowed := g.allowedMessages
	if len(allowedMessages) > 0 {
		effectiveAllowed = allowedMessages
	}
	hasAllowed := len(effectiveAllowed) > 0

	pv := g.catalogs[0].ProtocolVersion()
	rawA2R, err := core.AgentToRendererSchemaJSON(pv)
	if err != nil {
		return DefaultWorkflowRules
	}
	a2rMap, a2rOrder, err := directjson.PruneMessagesSchema(rawA2R, pv, effectiveAllowed, hasAllowed)
	if err != nil {
		return DefaultWorkflowRules
	}
	a2rStr := "{}"
	if len(a2rMap) > 0 {
		if s, mErr := directjson.MarshalOrderedCompact(a2rMap, a2rOrder); mErr == nil {
			a2rStr = s
		}
	}
	sections := []string{"### Agent to Renderer Schema:\n" + a2rStr}

	if rawCommon, cErr := core.CommonTypesSchemaJSON(pv); cErr == nil && len(rawCommon) > 0 {
		refSchemas := make([]map[string]any, 0, len(g.catalogs)+1)
		for _, cat := range g.catalogs {
			refSchemas = append(refSchemas, cat.ToJSON())
		}
		refSchemas = append(refSchemas, a2rMap)
		commonMap, commonOrder, pErr := directjson.PruneCommonTypesSchema(rawCommon, refSchemas...)
		if pErr == nil {
			if defs, ok := commonMap["$defs"].(map[string]any); ok && len(defs) > 0 {
				if commonStr, mErr := directjson.MarshalOrderedCompact(commonMap, commonOrder); mErr == nil {
					sections = append(sections, "### Common Types Schema:\n"+commonStr)
				}
			}
		}
	}

	return DefaultWorkflowRules + "\n\n" + wrapSchemaBlock(sections)
}

// GenerateCatalogInstructions renders one compact catalog schema block per catalog.
func (g *DirectJSONPromptGenerator) GenerateCatalogInstructions(includeSchema bool, catalog *core.Catalog) string {
	if !includeSchema {
		return ""
	}
	targets := g.catalogs
	if catalog != nil {
		targets = []*core.Catalog{catalog}
	}
	blocks := make([]string, 0, len(targets))
	for _, cat := range targets {
		if cat == nil {
			continue
		}
		catStr, err := directjson.MarshalCatalogCompact(cat)
		if err != nil {
			continue
		}
		blocks = append(blocks, wrapSchemaBlock([]string{"### Catalog Schema:\n" + catStr}))
	}
	return strings.Join(blocks, "\n\n")
}

// GenerateExamples formats configured few-shot example turns inside <a2ui-json> tags.
func (g *DirectJSONPromptGenerator) GenerateExamples(catalog *core.Catalog, validate bool) (string, error) {
	if len(g.examples) == 0 {
		return "", nil
	}
	cats := append([]*core.Catalog(nil), g.catalogs...)
	if catalog != nil {
		reordered := []*core.Catalog{catalog}
		for _, c := range cats {
			if c != catalog {
				reordered = append(reordered, c)
			}
		}
		cats = reordered
	}
	decomp := NewDirectJSONDecompiler(cats)
	blocks := make([]string, 0, len(g.examples))
	for _, turn := range g.examples {
		if validate {
			if err := ValidatePayload(cats, turn); err != nil {
				return "", err
			}
		}
		s, err := decomp.Decompile(turn)
		if err != nil {
			return "", err
		}
		blocks = append(blocks, JSONOpenTag+"\n"+s+"\n"+JSONCloseTag)
	}
	return strings.Join(blocks, "\n\n"), nil
}

func wrapSchemaBlock(sections []string) string {
	all := make([]string, 0, len(sections)+2)
	all = append(all, SchemaBlockStart)
	all = append(all, sections...)
	all = append(all, SchemaBlockEnd)
	return strings.Join(all, "\n\n")
}

// DirectJSONParser parses and streams <a2ui-json> blocks.
// A constructed DirectJSONParser is safe for concurrent use by multiple goroutines.
type DirectJSONParser struct {
	catalogs                   []*core.Catalog
	progressiveKeys            map[string]bool
	bufferIncompleteComponents bool
	decompiler                 *DirectJSONDecompiler
}

// NewDirectJSONParser constructs a standalone DirectJSONParser for catalogs.
func NewDirectJSONParser(catalogs []*core.Catalog, opts *DirectJSONFormatOptions) (*DirectJSONParser, error) {
	fmtInst, err := NewDirectJSONFormat(catalogs, nil, opts)
	if err != nil {
		return nil, err
	}
	return fmtInst.CreateParser().(*DirectJSONParser), nil
}

// Catalogs returns a copy of the parser's active catalogs.
func (p *DirectJSONParser) Catalogs() []*core.Catalog {
	return append([]*core.Catalog(nil), p.catalogs...)
}

// SupportsStreaming reports that DirectJSONParser supports incremental streaming.
func (p *DirectJSONParser) SupportsStreaming() bool { return true }

// HasFormatContent reports whether content contains at least one <a2ui-json> block (or recovered block).
func (p *DirectJSONParser) HasFormatContent(content string, complete bool) bool {
	for _, part := range p.Unwrap(content) {
		if part.IsA2UI() && (!complete || part.IsFinal) {
			return true
		}
	}
	return false
}

// Wrap joins text and raw A2UI blocks into an LLM-formatted string.
func (p *DirectJSONParser) Wrap(blocks []RawResponsePart) string {
	pieces := make([]string, 0, len(blocks))
	for _, b := range blocks {
		if b.IsText() {
			pieces = append(pieces, b.Text)
		} else {
			pieces = append(pieces, JSONOpenTag+"\n"+b.A2UIRaw+"\n"+JSONCloseTag)
		}
	}
	return strings.Join(pieces, "\n")
}

// Unwrap splits raw LLM response content into conversational text and raw <a2ui-json> blocks.
func (p *DirectJSONParser) Unwrap(content string) []RawResponsePart {
	tokens := directJSONBlockLexer.Tokenize(content)
	out := make([]RawResponsePart, len(tokens))
	for i, tok := range tokens {
		if tok.IsText {
			out[i] = NewRawTextPart(tok.Text)
		} else {
			out[i] = NewRawA2UIPart(tok.A2UIRaw, tok.IsFinal)
		}
	}
	return out
}

// Compile reads a single raw Direct JSON block into A2UI message envelopes.
func (p *DirectJSONParser) Compile(raw string, isFinal bool) ([]core.AgentToRendererMessage, error) {
	if !isFinal {
		return nil, core.NewParseErrorf("The response ended inside an unclosed %s block.", JSONOpenTag)
	}
	cleaned := blocklexer.CleanRaw(raw)
	if cleaned == "" {
		return nil, core.NewParseError("The direct JSON block is empty.")
	}
	decoded, err := directjson.ReadJSON(cleaned)
	if err != nil {
		parseErr := core.NewParseErrorf("The direct JSON block is not JSON: %v", err)
		parseErr.Cause = err
		return nil, parseErr
	}
	var items []any
	if arr, isArr := decoded.([]any); isArr {
		items = arr
	} else {
		items = []any{decoded}
	}
	return toValidatedMessageEnvelopes(items)
}

func toValidatedMessageEnvelopes(items []any) ([]core.AgentToRendererMessage, error) {
	out := make([]core.AgentToRendererMessage, len(items))
	for i, item := range items {
		m, ok := item.(map[string]any)
		if !ok || m == nil {
			return nil, core.NewValidationErrorf("Invalid A2UI message payload at index %d: expected JSON object.", i)
		}
		if !hasKnownEnvelopeKey(m) {
			return nil, core.NewValidationErrorf("Invalid A2UI message payload at index %d: unknown message envelope.", i)
		}
		cloned, _ := core.CloneJSONValue(m).(map[string]any)
		out[i] = core.AgentToRendererMessage(cloned)
	}
	return out, nil
}

func hasKnownEnvelopeKey(m map[string]any) bool {
	known := []string{
		"createSurface",
		"updateComponents",
		"updateDataModel",
		"deleteSurface",
		"callRendererFunction",
		"agentFunctionResponse",
		"beginRendering",
		"surfaceUpdate",
		"dataModelUpdate",
	}
	count := 0
	for _, k := range known {
		if body, ok := m[k]; ok {
			if _, isMap := body.(map[string]any); !isMap {
				return false
			}
			count++
		}
	}
	if count != 1 {
		return false
	}
	for k := range m {
		if k == "version" {
			continue
		}
		isKnown := false
		for _, ak := range known {
			if k == ak {
				isKnown = true
				break
			}
		}
		if !isKnown {
			return false
		}
	}
	return true
}

// Decompile converts A2UI messages into 2-space indented JSON.
func (p *DirectJSONParser) Decompile(payload []core.AgentToRendererMessage) (string, error) {
	decomp := p.decompiler
	if decomp == nil {
		decomp = NewDirectJSONDecompiler(p.catalogs)
	}
	return decomp.Decompile(payload)
}

// WrapDecompiledBlocks wraps decompiled JSON blocks inside <a2ui-json> sentinel tags.
func (p *DirectJSONParser) WrapDecompiledBlocks(blocks []string) string {
	decomp := p.decompiler
	if decomp == nil {
		decomp = NewDirectJSONDecompiler(p.catalogs)
	}
	return decomp.WrapDecompiledBlocks(blocks)
}

// ExtractRawDirectJSONParts splits content into conversational text and A2UI JSON message parts
// using the standard <a2ui-json> lexer (with case-insensitive tags, missing-open-tag recovery,
// markdown fence stripping, and quote/comma/newline healing) without requiring a catalog or
// validating against protocol schemas.
func ExtractRawDirectJSONParts(content string) ([]ResponsePart, error) {
	tokens := directJSONBlockLexer.Tokenize(content)
	var out []ResponsePart
	for _, tok := range tokens {
		if tok.IsText {
			out = append(out, NewTextPart(tok.Text))
			continue
		}
		if !tok.IsFinal {
			err := core.NewParseErrorf("The response ended inside an unclosed %s block.", JSONOpenTag)
			return nil, attachPartialResults(err, out, tok.A2UIRaw)
		}
		cleaned := blocklexer.CleanRaw(tok.A2UIRaw)
		if cleaned == "" {
			err := core.NewParseError("The direct JSON block is empty.")
			return nil, attachPartialResults(err, out, tok.A2UIRaw)
		}
		decoded, err := directjson.ReadJSON(cleaned)
		if err != nil {
			parseErr := core.NewParseErrorf("The direct JSON block is not JSON: %v", err)
			parseErr.Cause = err
			return nil, attachPartialResults(parseErr, out, tok.A2UIRaw)
		}
		msgs, err := toRawMessageObjects(decoded)
		if err != nil {
			return nil, attachPartialResults(err, out, tok.A2UIRaw)
		}
		out = append(out, NewA2UIPart(msgs))
	}
	return out, nil
}

func toRawMessageObjects(decoded any) ([]core.AgentToRendererMessage, error) {
	switch v := decoded.(type) {
	case map[string]any:
		if v == nil {
			return nil, core.NewValidationError("Invalid A2UI message payload: expected JSON object.")
		}
		cloned, _ := core.CloneJSONValue(v).(map[string]any)
		return []core.AgentToRendererMessage{core.AgentToRendererMessage(cloned)}, nil
	case []any:
		out := make([]core.AgentToRendererMessage, len(v))
		for i, item := range v {
			m, ok := item.(map[string]any)
			if !ok || m == nil {
				return nil, core.NewValidationErrorf("Invalid A2UI message payload at index %d: expected JSON object.", i)
			}
			cloned, _ := core.CloneJSONValue(m).(map[string]any)
			out[i] = core.AgentToRendererMessage(cloned)
		}
		return out, nil
	default:
		return nil, core.NewValidationError("Invalid A2UI message payload: expected JSON object or array of JSON objects.")
	}
}

// ParseResponse parses and validates a complete LLM response string.
func (p *DirectJSONParser) ParseResponse(content string, opts *ParseOptions) ([]ResponsePart, error) {
	return ExecuteParseResponse(p, content, opts)
}

// OpenStream opens an incremental DirectJSONResponseStream for chunk-by-chunk LLM output processing.
func (p *DirectJSONParser) OpenStream(opts *StreamOptions) (ResponseStream, error) {
	var resolved StreamOptions
	if opts != nil {
		resolved = *opts
	}
	state := resolved.State
	if state == nil {
		var err error
		state, err = NewRendererState(p.catalogs)
		if err != nil {
			return nil, err
		}
	}
	wrapped := !resolved.Unwrapped
	continues := resolved.AfterRejectedBlock == AfterRejectedContinue

	buffersComps := p.bufferIncompleteComponents
	if len(p.catalogs) > 0 && core.IsAtLeastVersion(string(p.catalogs[0].ProtocolVersion()), core.Version1_0) {
		buffersComps = true
	}
	wholeItemKeys := map[string]bool{}
	if buffersComps {
		wholeItemKeys["components"] = true
	}

	s := &DirectJSONResponseStream{
		parser:            p,
		wrapped:           wrapped,
		state:             state,
		continues:         continues,
		buffersComponents: buffersComps,
		wholeItemKeys:     wholeItemKeys,
		inBlock:           !wrapped,
	}
	s.resetBlock()
	return s, nil
}

type growingMessage struct {
	key      string
	field    string
	restJSON string
	count    int
	lastJSON string
	hasLast  bool
	ids      map[string]bool
	lastID   string
	value    any
}

// DirectJSONResponseStream implements ResponseStream for Direct JSON.
// A DirectJSONResponseStream is not safe for concurrent use by multiple goroutines.
type DirectJSONResponseStream struct {
	parser              *DirectJSONParser
	wrapped             bool
	state               *RendererState
	continues           bool
	buffersComponents   bool
	wholeItemKeys       map[string]bool
	closed              bool
	held                string
	heldBackticks       string
	stripCloseBackticks bool
	textRun             blocklexer.TextRun
	inBlock             bool
	block               strings.Builder
	scanner             *directjson.BlockScanner
	readCache           *directjson.PartialReadCache
	readStart           int
	hasReadStart        bool
	done                int
	growing             *growingMessage
	stalled             bool
	rejected            bool
	touchedOrder        []string
	touchedSeen         map[string]bool
}

func (s *DirectJSONResponseStream) resetBlock() {
	s.block.Reset()
	s.scanner = directjson.NewBlockScanner(0)
	s.readCache = directjson.NewPartialReadCache()
	s.readStart = 0
	s.hasReadStart = false
	s.done = 0
	s.growing = nil
	s.stalled = false
	s.rejected = false
	s.touchedOrder = nil
	s.touchedSeen = make(map[string]bool)
}

// State returns the RendererState bound to this stream.
func (s *DirectJSONResponseStream) State() *RendererState { return s.state }

// IsInBlock reports whether the stream currently ends inside an open <a2ui-json> block.
func (s *DirectJSONResponseStream) IsInBlock() bool { return !s.closed && s.inBlock }

// Feed reads the next chunk of streamed LLM text and returns any newly ready StreamParts.
func (s *DirectJSONResponseStream) Feed(chunk string) ([]StreamPart, error) {
	if s.closed {
		return nil, ErrStreamClosed
	}
	var parts []StreamPart
	if err := s.feedInto(chunk, &parts); err != nil {
		return parts, s.failStream(err, parts)
	}
	return parts, nil
}

// Close ends the stream, flushing held trailing text or raising if an open block remains unclosed.
func (s *DirectJSONResponseStream) Close() ([]StreamPart, error) {
	if s.closed {
		return nil, nil
	}
	s.closed = true
	var parts []StreamPart
	if !s.wrapped {
		if !s.rejected {
			if err := s.readBlockStep(&parts, func() error {
				return s.finishBlock(&parts, s.block.Len())
			}); err != nil {
				return parts, s.failStream(err, parts)
			}
		}
		return parts, nil
	}
	if s.inBlock {
		if !s.rejected {
			if err := s.readBlockStep(&parts, func() error {
				return core.NewParseErrorf("The response ended inside an %s block, before its %s tag.", JSONOpenTag, JSONCloseTag)
			}); err != nil {
				return parts, s.failStream(err, parts)
			}
		}
		return parts, nil
	}
	if s.heldBackticks != "" {
		if txt, ok := s.textRun.Emit(s.heldBackticks); ok {
			parts = append(parts, NewStreamTextPart(txt))
		}
		s.heldBackticks = ""
	}
	if s.held != "" {
		if txt, ok := s.textRun.Emit(s.held); ok {
			parts = append(parts, NewStreamTextPart(txt))
		}
		s.held = ""
	}
	return parts, nil
}

func (s *DirectJSONResponseStream) failStream(err error, parts []StreamPart) error {
	s.closed = true
	s.state.MarkChecked(s.touchedOrder)
	var nonErrParts []ResponsePart
	for _, p := range parts {
		if rp, ok := p.ToResponsePart(); ok {
			nonErrParts = append(nonErrParts, rp)
		}
	}
	return attachPartialResults(err, nonErrParts, s.block.String())
}

func (s *DirectJSONResponseStream) readBlockStep(parts *[]StreamPart, step func() error) error {
	err := step()
	if err == nil {
		return nil
	}
	var catErr core.CategorizedError
	if !errors.As(err, &catErr) {
		return err
	}
	if !s.continues {
		return err
	}
	*parts = append(*parts, NewStreamErrorPart(err))
	s.state.MarkChecked(s.touchedOrder)
	s.rejected = true
	return nil
}

func (s *DirectJSONResponseStream) endBlock() {
	s.inBlock = !s.wrapped
	s.resetBlock()
}

func (s *DirectJSONResponseStream) feedInto(chunk string, parts *[]StreamPart) error {
	if !s.wrapped {
		s.block.WriteString(chunk)
		if !s.rejected {
			return s.readBlockStep(parts, func() error {
				return s.emitReady(parts, s.block.Len())
			})
		}
		return nil
	}

	inputStr := s.held + chunk
	s.held = ""
	if s.stripCloseBackticks {
		if strings.HasPrefix(inputStr, "`") {
			inputStr = strings.TrimLeft(inputStr, "`")
		}
		if inputStr != "" {
			s.stripCloseBackticks = false
		}
	}

	if !s.inBlock && s.heldBackticks != "" && inputStr != "" {
		openAnchored := directjson.OpenTagRE.FindStringIndex(inputStr)
		isOpenTag := (openAnchored != nil && openAnchored[0] == 0) ||
			directjson.OpenTagStartRE.MatchString(inputStr) ||
			(strings.HasPrefix(inputStr, "<") && strings.HasPrefix("<a2ui-json", strings.ToLower(inputStr)))
		if isOpenTag {
			s.heldBackticks = ""
		} else {
			inputStr = s.heldBackticks + inputStr
			s.heldBackticks = ""
		}
	}

	for inputStr != "" {
		if s.inBlock {
			s.block.WriteString(inputStr)
			inputStr = ""
			blockStr := s.block.String()
			closeStart, hasClose, readableEnd := s.scanner.Scan(blockStr)
			if !hasClose {
				if !s.rejected {
					if err := s.readBlockStep(parts, func() error {
						return s.emitReady(parts, readableEnd)
					}); err != nil {
						return err
					}
				}
				break
			}
			closeLoc := directjson.CloseTagAnchoredRE.FindStringIndex(blockStr[closeStart:])
			closeEnd := closeStart + closeLoc[1]
			inputStr = strings.Clone(blockStr[closeEnd:])
			if strings.HasPrefix(inputStr, "`") {
				inputStr = strings.TrimLeft(inputStr, "`")
			} else if inputStr == "" {
				s.stripCloseBackticks = true
			}
			if !s.rejected {
				end := closeStart
				if err := s.readBlockStep(parts, func() error {
					return s.finishBlock(parts, end)
				}); err != nil {
					return err
				}
			}
			s.endBlock()
			continue
		}

		if openLoc := directjson.OpenTagRE.FindStringIndex(inputStr); openLoc != nil {
			textBefore := inputStr[:openLoc[0]]
			if strings.HasSuffix(textBefore, "`") {
				textBefore = strings.TrimRight(textBefore, "`")
			}
			if txt, ok := s.textRun.Emit(textBefore); ok {
				*parts = append(*parts, NewStreamTextPart(txt))
			}
			s.textRun.Reset()
			s.heldBackticks = ""
			s.inBlock = true
			inputStr = inputStr[openLoc[1]:]
			continue
		}

		hold := blocklexer.PossibleTagStart(inputStr, JSONOpenTag, directjson.OpenTagStartRE)
		if hold < len(inputStr) {
			for hold > 0 && inputStr[hold-1] == '`' {
				hold--
			}
		}
		textToEmit := inputStr[:hold]
		s.held = inputStr[hold:]
		inputStr = ""
		if s.held == "" {
			if m := streamTrailingTicksRE.FindStringIndex(textToEmit); m != nil {
				s.heldBackticks = textToEmit[m[0]:]
				textToEmit = textToEmit[:m[0]]
			}
		}
		if s.held == "" && s.heldBackticks == "" {
			completeLen := blocklexer.CompleteUTF8PrefixLen(textToEmit)
			if completeLen < len(textToEmit) {
				s.held = textToEmit[completeLen:]
				textToEmit = textToEmit[:completeLen]
			}
		}
		if txt, ok := s.textRun.Emit(textToEmit); ok {
			*parts = append(*parts, NewStreamTextPart(txt))
		}
	}
	return nil
}

func (s *DirectJSONResponseStream) readItems(end int) (int, []directjson.MessageItem, bool) {
	blockStr := s.block.String()
	start, ok := blocklexer.PayloadStart(blockStr, end)
	if !ok {
		return 0, nil, false
	}
	if !s.hasReadStart || start != s.readStart {
		s.readStart = start
		s.hasReadStart = true
		s.readCache = directjson.NewPartialReadCache()
	}
	stop := blocklexer.TrailingFenceStart(blockStr, start, end)
	base, items := directjson.ReadPartialMessageItemsFrom(
		blockStr,
		s.parser.progressiveKeys,
		s.wholeItemKeys,
		s.readCache,
		start,
		stop,
		s.done,
	)
	return base, items, true
}

func (s *DirectJSONResponseStream) emitReady(parts *[]StreamPart, end int) error {
	base, envelopes, ok := s.readItems(end)
	if !ok || len(envelopes) == 0 {
		return nil
	}
	var ready []core.AgentToRendererMessage
	err := s.applyReady(base, envelopes, &ready)
	if len(ready) > 0 {
		*parts = append(*parts, NewStreamA2UIPart(ready))
	}
	return err
}

func (s *DirectJSONResponseStream) applyReady(base int, envelopes []directjson.MessageItem, ready *[]core.AgentToRendererMessage) error {
	startOffset := max(0, s.done-base)
	for offset := startOffset; offset < len(envelopes); offset++ {
		if s.stalled {
			break
		}
		index := base + offset
		item := envelopes[offset]
		envMap, ok := item.Envelope.(map[string]any)
		if !ok {
			break
		}
		if !item.Closed && !mayGrowEnvelope(envMap) {
			break
		}
		model, emitted, err := s.checkEnvelope(envMap, item.Closed)
		if err != nil {
			var catErr core.CategorizedError
			if errors.As(err, &catErr) {
				if s.buffersComponents && hasClosedComponents(envMap) {
					return err
				}
				s.stalled = item.Closed
				break
			}
			break
		}
		if emitted {
			*ready = append(*ready, model)
		}
		if !item.Closed {
			break
		}
		s.done = index + 1
		s.growing = nil
	}
	return nil
}

func (s *DirectJSONResponseStream) finishBlock(parts *[]StreamPart, end int) error {
	tailMessages, err := s.finalMessages(end)
	if err != nil {
		return err
	}
	var ready []core.AgentToRendererMessage
	txErr := s.state.Transaction(func() error {
		for _, env := range tailMessages {
			model, emitted, checkErr := s.checkEnvelope(env, true)
			if checkErr != nil {
				return checkErr
			}
			if emitted {
				ready = append(ready, model)
			}
			s.growing = nil
		}
		return s.state.CheckTopology(s.touchedOrder)
	})
	if txErr != nil {
		return txErr
	}
	if len(ready) > 0 {
		*parts = append(*parts, NewStreamA2UIPart(ready))
	}
	return nil
}

func (s *DirectJSONResponseStream) finalMessages(end int) ([]map[string]any, error) {
	block := s.block.String()
	if start, ok := blocklexer.PayloadStart(block, end); ok {
		stop := blocklexer.TrailingFenceStart(block, start, end)
		if streamLeadingFenceFullRE.MatchString(block[:start]) && streamTrailingFenceFullRE.MatchString(block[stop:end]) {
			base, envelopes, readOK := s.readItems(end)
			if readOK && base+len(envelopes) > 0 && s.readCache.Complete {
				allClosed := true
				startOffset := max(0, s.done-base)
				out := make([]map[string]any, 0, max(0, len(envelopes)-startOffset))
				for offset, item := range envelopes {
					if !item.Closed {
						allClosed = false
						break
					}
					m, isMap := item.Envelope.(map[string]any)
					if !isMap || !hasKnownEnvelopeKey(m) {
						allClosed = false
						break
					}
					if offset >= startOffset {
						out = append(out, m)
					}
				}
				if allClosed {
					return out, nil
				}
			}
		}
	}
	compiled, err := s.parser.Compile(block[:end], true)
	if err != nil {
		return nil, err
	}
	if s.done >= len(compiled) {
		return nil, nil
	}
	rem := compiled[s.done:]
	out := make([]map[string]any, len(rem))
	for i, m := range rem {
		out[i] = map[string]any(m)
	}
	return out, nil
}

func (s *DirectJSONResponseStream) checkEnvelope(envelope map[string]any, closed bool) (core.AgentToRendererMessage, bool, error) {
	if s.growing != nil {
		rest, hasRest := envelopeRestJSON(envelope, s.growing.key, s.growing.field)
		if hasRest && rest == s.growing.restJSON {
			if s.growing.field == "components" {
				return s.checkAddedComponents(s.growing, envelope)
			}
			return s.checkGrownData(s.growing, envelope, closed)
		}
	}

	if !hasKnownEnvelopeKey(envelope) {
		return nil, false, core.NewValidationError("Invalid A2UI message payload: unknown message envelope.")
	}
	model := shallowCloneEnvelope(envelope)
	if err := s.applySingle(model); err != nil {
		return nil, false, err
	}

	s.growing = nil
	if !closed {
		if gKey, hasGKey := growingKeyOf(envelope); hasGKey {
			field := growingFields[gKey]
			if rest, hasRest := envelopeRestJSON(envelope, gKey, field); hasRest {
				body, _ := envelope[gKey].(map[string]any)
				gm := &growingMessage{
					key:      gKey,
					field:    field,
					restJSON: rest,
					ids:      make(map[string]bool),
				}
				if field == "components" {
					if comps, ok := body[field].([]any); ok {
						gm.count = len(comps)
						if len(comps) > 0 {
							gm.lastJSON = canonicalSortedJSON(comps[len(comps)-1])
							gm.hasLast = true
							gm.lastID = componentIDOf(comps[len(comps)-1])
						}
						for _, c := range comps {
							if cid := componentIDOf(c); cid != "" {
								gm.ids[cid] = true
							}
						}
					}
				} else {
					gm.value = body[field]
				}
				s.growing = gm
			}
		}
	}
	return model, true, nil
}

func shallowCloneEnvelope(envelope map[string]any) core.AgentToRendererMessage {
	out := make(map[string]any, len(envelope))
	for k, v := range envelope {
		if body, ok := v.(map[string]any); ok {
			bodyCopy := make(map[string]any, len(body))
			for bk, bv := range body {
				if arr, isArr := bv.([]any); isArr {
					// slices.Clone keeps an empty list empty; append([]any(nil), arr...)
					// would turn "value": [] into "value": null, which deletes the path.
					bodyCopy[bk] = slices.Clone(arr)
				} else {
					bodyCopy[bk] = bv
				}
			}
			out[k] = bodyCopy
		} else {
			out[k] = v
		}
	}
	return core.AgentToRendererMessage(out)
}

func (s *DirectJSONResponseStream) checkAddedComponents(gm *growingMessage, envelope map[string]any) (core.AgentToRendererMessage, bool, error) {
	body, _ := envelope[gm.key].(map[string]any)
	comps, _ := body["components"].([]any)
	kept := gm.count
	if len(comps) < kept {
		kept = 0
	}
	if kept > 0 && (!gm.hasLast || canonicalSortedJSON(comps[kept-1]) != gm.lastJSON) {
		kept--
	}
	if kept == len(comps) {
		return nil, false, nil
	}
	added := comps[kept:]
	rereadLast := kept == gm.count-1
	seen := make(map[string]bool, len(added))
	for _, comp := range added {
		cid := componentIDOf(comp)
		if cid == "" {
			continue
		}
		isEarlier := kept > 0 && gm.ids[cid] && !(rereadLast && cid == gm.lastID)
		if isEarlier || seen[cid] {
			return nil, false, core.NewIntegrityErrorf("Duplicate component ID '%s' in update payload.", cid)
		}
		seen[cid] = true
	}

	deltaBody := make(map[string]any, len(body))
	for k, v := range body {
		deltaBody[k] = v
	}
	deltaBody["components"] = added
	deltaEnv := make(map[string]any, len(envelope))
	for k, v := range envelope {
		deltaEnv[k] = v
	}
	deltaEnv[gm.key] = deltaBody

	if err := s.applySingle(core.AgentToRendererMessage(deltaEnv)); err != nil {
		return nil, false, err
	}

	if kept == 0 {
		gm.ids = make(map[string]bool, len(seen))
	} else if rereadLast && gm.lastID != "" {
		delete(gm.ids, gm.lastID)
	}
	for cid := range seen {
		gm.ids[cid] = true
	}
	gm.count = len(comps)
	gm.lastJSON = canonicalSortedJSON(comps[len(comps)-1])
	gm.hasLast = true
	gm.lastID = componentIDOf(comps[len(comps)-1])
	return shallowCloneEnvelope(envelope), true, nil
}

const dataModelValueDepth = 2

func (s *DirectJSONResponseStream) checkGrownData(gm *growingMessage, envelope map[string]any, closed bool) (core.AgentToRendererMessage, bool, error) {
	body, _ := envelope[gm.key].(map[string]any)
	val := body[gm.field]
	changed := !sameGrownValue(val, gm.value)
	if closed {
		if err := s.applySingle(shallowCloneEnvelope(envelope)); err != nil {
			return nil, false, err
		}
	} else if changed {
		if err := checkGainedData(val, gm.value, dataModelValueDepth); err != nil {
			return nil, false, err
		}
		gm.value = val
	}
	if !changed {
		return nil, false, nil
	}
	return shallowCloneEnvelope(envelope), true, nil
}

func checkGainedData(val, prev any, depth int) error {
	if sameContainerIdentity(val, prev) {
		return nil
	}
	if valSlice, isValSlice := val.([]any); isValSlice {
		if prevSlice, isPrevSlice := prev.([]any); isPrevSlice {
			// In a growing JSON array, elements before the previously last item were
			// already followed by ',' and cannot change or gain content on later chunks.
			start := 0
			if len(prevSlice) > 1 && len(valSlice) >= len(prevSlice) {
				start = len(prevSlice) - 1
			}
			for i := start; i < len(valSlice); i++ {
				var prevItem any
				if i < len(prevSlice) {
					prevItem = prevSlice[i]
				}
				if err := checkGainedData(valSlice[i], prevItem, depth+1); err != nil {
					return err
				}
			}
			return nil
		}
	}
	if valMap, isValMap := val.(map[string]any); isValMap {
		if prevMap, isPrevMap := prev.(map[string]any); isPrevMap {
			var paths map[string]any
			for _, pk := range []string{"path", "@path"} {
				v, hasV := valMap[pk]
				pv, hasPV := prevMap[pk]
				if hasV && (!hasPV || !sameJSONValue(v, pv)) {
					if paths == nil {
						paths = make(map[string]any, 2)
					}
					paths[pk] = v
				}
			}
			if len(paths) > 0 {
				if err := validateDataAtDepth(paths, depth); err != nil {
					return err
				}
			}
			for k, v := range valMap {
				if k == "path" || k == "@path" {
					continue
				}
				if err := checkGainedData(v, prevMap[k], depth+1); err != nil {
					return err
				}
			}
			return nil
		}
	}
	return validateDataAtDepth(val, depth)
}

func validateDataAtDepth(val any, depth int) error {
	wrapped := val
	for i := 0; i < depth; i++ {
		wrapped = []any{wrapped}
	}
	return core.ValidateRecursionAndPaths(wrapped)
}

func (s *DirectJSONResponseStream) applySingle(msg core.AgentToRendererMessage) error {
	touched, err := s.state.Apply([]core.AgentToRendererMessage{msg})
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

func growingKeyOf(envelope map[string]any) (string, bool) {
	for _, k := range growingFieldOrder {
		if _, ok := envelope[k]; ok {
			return k, true
		}
	}
	return "", false
}

func mayGrowEnvelope(envelope map[string]any) bool {
	key, ok := growingKeyOf(envelope)
	if !ok {
		return false
	}
	body, isMap := envelope[key].(map[string]any)
	if !isMap {
		return false
	}
	field := growingFields[key]
	val, hasField := body[field]
	if !hasField {
		return false
	}
	if field == "components" {
		arr, isArr := val.([]any)
		return isArr && len(arr) > 0
	}
	return true
}

func envelopeRestJSON(envelope map[string]any, key, field string) (string, bool) {
	body, ok := envelope[key].(map[string]any)
	if !ok {
		return "", false
	}
	val, hasField := body[field]
	if !hasField {
		return "", false
	}
	if field == "components" {
		if _, isArr := val.([]any); !isArr {
			return "", false
		}
	}
	strippedBody := make(map[string]any, len(body))
	for k, v := range body {
		if k != field {
			strippedBody[k] = v
		}
	}
	strippedEnv := make(map[string]any, len(envelope))
	for k, v := range envelope {
		if k == key {
			strippedEnv[k] = strippedBody
		} else {
			strippedEnv[k] = v
		}
	}
	return canonicalSortedJSON(strippedEnv), true
}

func canonicalSortedJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%#v", v)
	}
	return string(b)
}

func componentIDOf(v any) string {
	if m, ok := v.(map[string]any); ok {
		if id, isStr := m["id"].(string); isStr {
			return id
		}
	}
	return ""
}

func sameContainerIdentity(a, b any) bool {
	if aMap, ok := a.(map[string]any); ok {
		if bMap, ok := b.(map[string]any); ok {
			return aMap != nil && bMap != nil && reflect.ValueOf(aMap).Pointer() == reflect.ValueOf(bMap).Pointer()
		}
		return false
	}
	if aSlice, ok := a.([]any); ok {
		if bSlice, ok := b.([]any); ok {
			return len(aSlice) > 0 && len(aSlice) == len(bSlice) && &aSlice[0] == &bSlice[0]
		}
		return false
	}
	return false
}

// sameGrownValue compares a newly read partial JSON value against its previous
// read from the same growing stream block. Closed prefix items of a JSON array
// cannot mutate after a comma closes them, so equal-length arrays only need to
// compare their final (potentially open) element.
func sameGrownValue(a, b any) bool {
	if sameContainerIdentity(a, b) {
		return true
	}
	if aSlice, ok := a.([]any); ok {
		bSlice, okB := b.([]any)
		if !okB || len(aSlice) != len(bSlice) {
			return false
		}
		if len(aSlice) == 0 {
			return true
		}
		return sameGrownValue(aSlice[len(aSlice)-1], bSlice[len(bSlice)-1])
	}
	if aMap, ok := a.(map[string]any); ok {
		bMap, okB := b.(map[string]any)
		if !okB || len(aMap) != len(bMap) {
			return false
		}
		for k, av := range aMap {
			bv, exists := bMap[k]
			if !exists || !sameGrownValue(av, bv) {
				return false
			}
		}
		return true
	}
	return reflect.DeepEqual(a, b)
}

func sameJSONValue(a, b any) bool {
	if sameContainerIdentity(a, b) {
		return true
	}
	if aSlice, ok := a.([]any); ok {
		bSlice, okB := b.([]any)
		if !okB || len(aSlice) != len(bSlice) {
			return false
		}
		for i := len(aSlice) - 1; i >= 0; i-- {
			if !sameJSONValue(aSlice[i], bSlice[i]) {
				return false
			}
		}
		return true
	}
	if aMap, ok := a.(map[string]any); ok {
		bMap, okB := b.(map[string]any)
		if !okB || len(aMap) != len(bMap) {
			return false
		}
		for k, av := range aMap {
			bv, exists := bMap[k]
			if !exists || !sameJSONValue(av, bv) {
				return false
			}
		}
		return true
	}
	return reflect.DeepEqual(a, b)
}

func hasClosedComponents(envelope map[string]any) bool {
	if _, ok := envelope["version"].(string); !ok {
		return false
	}
	body, ok := envelope["updateComponents"].(map[string]any)
	if !ok {
		return false
	}
	if _, ok := body["surfaceId"].(string); !ok {
		return false
	}
	comps, ok := body["components"].([]any)
	return ok && len(comps) > 0
}
