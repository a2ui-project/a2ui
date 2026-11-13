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
	"fmt"
	"log/slog"
	"maps"
	"strings"

	adkagent "google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/model"
	"google.golang.org/adk/v2/tool"
	"google.golang.org/genai"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// ToolsetConfig configures SendA2UIToClientToolset. The zero value of each field is the default.
type ToolsetConfig struct {
	// Disabled turns the tool off for every context.
	Disabled bool
	// EnabledProvider decides per context whether the tool is offered (for example,
	// ProcessorStore.IsEnabled). When nil, the tool is offered unless Disabled is set.
	EnabledProvider EnabledProvider
	// ProcessorProvider resolves the context's RequestProcessor (for example, ProcessorStore.Get).
	ProcessorProvider ProcessorProvider
	// Logger receives operational errors and debug diagnostics. When nil, slog.Default() is used.
	Logger *slog.Logger
}

// SendA2UIToClientToolset implements google.golang.org/adk/v2/tool.Toolset. It offers the
// send_a2ui_json_to_client tool to an ADK LLMAgent and strips A2UI RPC parts from prompts.
type SendA2UIToClientToolset struct {
	disabled        bool
	enabledProvider EnabledProvider
	uiTool          *SendA2UIToClientTool
}

// NewSendA2UIToClientToolset constructs a SendA2UIToClientToolset from cfg.
func NewSendA2UIToClientToolset(cfg ToolsetConfig) *SendA2UIToClientToolset {
	return &SendA2UIToClientToolset{
		disabled:        cfg.Disabled,
		enabledProvider: cfg.EnabledProvider,
		uiTool: &SendA2UIToClientTool{
			processorProvider: cfg.ProcessorProvider,
			validatePayload:   agent.ValidatePayload,
			logger:            loggerOrDefault(cfg.Logger),
		},
	}
}

// Name returns the toolset identifier.
func (ts *SendA2UIToClientToolset) Name() string {
	return "a2ui_toolset"
}

// Tool returns the underlying SendA2UIToClientTool instance.
func (ts *SendA2UIToClientToolset) Tool() *SendA2UIToClientTool {
	return ts.uiTool
}

// Tools returns the send_a2ui_json_to_client tool when A2UI is enabled for ctx, or an empty slice otherwise.
func (ts *SendA2UIToClientToolset) Tools(ctx adkagent.ReadonlyContext) ([]tool.Tool, error) {
	if ctx == nil {
		return []tool.Tool{}, nil
	}
	useUI, err := enabled(ts.disabled, ts.enabledProvider, ctx)
	if err != nil {
		return nil, err
	}
	if !useUI {
		return []tool.Tool{}, nil
	}
	return []tool.Tool{ts.uiTool}, nil
}

// PartConverter returns a PartConverter configured with the session's resolved RequestProcessor.
func (ts *SendA2UIToClientToolset) PartConverter(ctx adkagent.ReadonlyContext, opts *PartConverterOptions) (*PartConverter, error) {
	proc, err := ts.uiTool.resolveProcessor(ctx)
	if err != nil {
		return nil, err
	}
	return NewPartConverter(proc, opts), nil
}

// ProcessRequest removes A2UI agent-function RPC parts from req.Contents before each LLM call,
// regardless of whether A2UI generation is enabled for the turn.
func (ts *SendA2UIToClientToolset) ProcessRequest(_ adkagent.Context, req *model.LLMRequest) error {
	StripA2UIRPCParts(req)
	return nil
}

// SendA2UIToClientTool implements google.golang.org/adk/v2/tool.Tool, together with the
// function-tool and request-processor methods that ADK's LLM flow looks for, for the
// send_a2ui_json_to_client tool.
type SendA2UIToClientTool struct {
	processorProvider ProcessorProvider
	// validatePayload replaces agent.ValidatePayload for stateless calls; only tests set it.
	validatePayload func(catalogs []*core.Catalog, payload []core.AgentToRendererMessage) error
	logger          *slog.Logger
}

// NewSendA2UIToClientTool constructs a standalone SendA2UIToClientTool that resolves each
// context's RequestProcessor with provider.
func NewSendA2UIToClientTool(provider ProcessorProvider) *SendA2UIToClientTool {
	return &SendA2UIToClientTool{
		processorProvider: provider,
		validatePayload:   agent.ValidatePayload,
		logger:            slog.Default(),
	}
}

// Name returns A2UIToolName ("send_a2ui_json_to_client").
func (t *SendA2UIToClientTool) Name() string {
	return A2UIToolName
}

// Description returns the human- and model-readable tool description.
func (t *SendA2UIToClientTool) Description() string {
	return fmt.Sprintf(
		"Sends A2UI to the client to render rich UI for the user. This tool can be called multiple times "+
			"in the same turn to render multiple UI surfaces. Args: %s: The A2UI block to send, written "+
			"in the A2UI format and with the components that the system instructions describe.",
		A2UIPayloadArgName,
	)
}

// IsLongRunning reports false; UI validation executes synchronously on the agent server.
func (t *SendA2UIToClientTool) IsLongRunning() bool {
	return false
}

// Declaration returns the Gemini FunctionDeclaration for send_a2ui_json_to_client.
func (t *SendA2UIToClientTool) Declaration() *genai.FunctionDeclaration {
	return &genai.FunctionDeclaration{
		Name:        t.Name(),
		Description: t.Description(),
		Parameters: &genai.Schema{
			Type: genai.TypeObject,
			Properties: map[string]*genai.Schema{
				A2UIPayloadArgName: {
					Type:        genai.TypeString,
					Description: "The A2UI block to send to the client, in the A2UI format that the system instructions describe.",
				},
			},
			Required: []string{A2UIPayloadArgName},
		},
	}
}

func (t *SendA2UIToClientTool) toolInstruction() string {
	return fmt.Sprintf(
		"To show A2UI to the user, call the `%s` tool and pass the A2UI block in its `%s` argument instead of writing the block in your reply.",
		A2UIToolName, A2UIPayloadArgName,
	)
}

func (t *SendA2UIToClientTool) resolveProcessor(ctx adkagent.ReadonlyContext) (*agent.RequestProcessor, error) {
	return resolveProcessor(t.processorProvider, ctx, "Tool "+A2UIToolName)
}

// ProcessRequest registers the tool declaration on req and appends non-duplicate A2UI prompt sections
// to req.Config.SystemInstruction.
func (t *SendA2UIToClientTool) ProcessRequest(ctx adkagent.Context, req *model.LLMRequest) error {
	if err := packADKTool(req, t); err != nil {
		return err
	}

	proc, err := t.resolveProcessor(ctx)
	if err != nil {
		return err
	}
	pg := proc.Format().PromptGenerator()
	existing := extractSystemInstructionText(req)
	toolInst := t.toolInstruction()

	type section struct {
		key  string
		text string
	}
	var sections []section

	snippet := ""
	if existing != "" {
		var snipErr error
		snippet, snipErr = proc.PromptSnippet()
		if snipErr != nil {
			return snipErr
		}
	}
	if snippet == "" || !strings.Contains(existing, snippet) {
		if rules := pg.GenerateBaseRules(nil); rules != "" {
			sections = append(sections, section{key: rules, text: "## Workflow Description:\n" + rules})
		}
		if catInst := pg.GenerateCatalogInstructions(true, nil); catInst != "" {
			sections = append(sections, section{key: catInst, text: catInst})
		}
		examples, exErr := pg.GenerateExamples(nil, false)
		if exErr != nil {
			return exErr
		}
		if examples != "" {
			sections = append(sections, section{key: examples, text: agent.ExamplesHeading + "\n" + examples})
		}
	}
	sections = append(sections, section{key: toolInst, text: toolInst})

	var toAppend []string
	for _, sec := range sections {
		if !strings.Contains(existing, sec.key) {
			toAppend = append(toAppend, sec.text)
		}
	}
	if len(toAppend) > 0 {
		appendADKSystemInstructions(req, toAppend)
	}
	return nil
}

// Run compiles and validates args["a2ui_payload"] with the session's RequestProcessor.
// On success it sets SkipSummarization = true and returns {"validated_a2ui_json": messages}.
// On validation failure it returns {"error": detail} so the LLM can self-correct on the next step.
func (t *SendA2UIToClientTool) Run(ctx adkagent.Context, args any) (map[string]any, error) {
	result, err := t.execute(ctx, args)
	if err != nil {
		loggerOrDefault(t.logger).Error("Failed to call A2UI tool", "tool", A2UIToolName, "errorType", fmt.Sprintf("%T", err))
		loggerOrDefault(t.logger).Debug("A2UI tool failure detail", "tool", A2UIToolName, "err", err)
		return map[string]any{
			A2UIToolErrorKey: fmt.Sprintf("Failed to call A2UI tool %s: %v", A2UIToolName, err),
		}, nil
	}
	if ctx != nil && ctx.Actions() != nil {
		ctx.Actions().SkipSummarization = true
	}
	return map[string]any{
		ValidatedA2UIJSONKey: result,
	}, nil
}

func (t *SendA2UIToClientTool) execute(ctx adkagent.Context, args any) ([]map[string]any, error) {
	argMap, _ := args.(map[string]any)
	var payload string
	if argMap != nil {
		payload, _ = argMap[A2UIPayloadArgName].(string)
	}
	if payload == "" {
		return nil, core.NewValidationErrorf(
			"Failed to call tool %s because missing required arg %s",
			A2UIToolName, A2UIPayloadArgName,
		)
	}

	proc, err := t.resolveProcessor(ctx)
	if err != nil {
		return nil, err
	}
	return parseToolPayload(proc, payload, t.validatePayload)
}

func parseToolPayload(
	proc *agent.RequestProcessor,
	payload string,
	validator func(catalogs []*core.Catalog, payload []core.AgentToRendererMessage) error,
) ([]map[string]any, error) {
	parser := proc.Parser()
	var blocks []string
	if parser.HasFormatContent(payload, false) {
		for _, raw := range parser.Unwrap(payload) {
			if raw.IsA2UI() {
				blocks = append(blocks, raw.A2UIRaw)
			}
		}
	} else {
		blocks = []string{payload}
	}

	if proc.State() != nil {
		rawParts := make([]agent.RawResponsePart, len(blocks))
		for i, blk := range blocks {
			rawParts[i] = agent.NewRawA2UIPart(blk, true)
		}
		closed := parser.Wrap(rawParts)
		parts, err := proc.ParseResponse(closed, &agent.ParseOptions{State: proc.State()})
		if err != nil {
			return nil, err
		}
		var msgs []map[string]any
		for _, part := range parts {
			if part.IsA2UI() {
				for _, m := range part.A2UI {
					msgs = append(msgs, normalizeToolWireMessage(m))
				}
			}
		}
		if len(msgs) == 0 {
			return nil, core.NewParseError("The payload holds no A2UI messages.")
		}
		return msgs, nil
	}

	var compiled []core.AgentToRendererMessage
	for _, blk := range blocks {
		msgs, err := parser.Compile(blk, true)
		if err != nil {
			return nil, err
		}
		compiled = append(compiled, msgs...)
	}
	if len(compiled) == 0 {
		return nil, core.NewParseError("The payload holds no A2UI messages.")
	}
	if err := validator(proc.ActiveCatalogs(), compiled); err != nil {
		return nil, err
	}
	out := make([]map[string]any, len(compiled))
	for i, m := range compiled {
		out[i] = normalizeToolWireMessage(m)
	}
	return out, nil
}

func normalizeToolWireMessage(msg core.AgentToRendererMessage) map[string]any {
	cloned := maps.Clone(map[string]any(msg))
	if v, ok := cloned["version"].(string); ok && v == "v0.8" {
		delete(cloned, "version")
	}
	return cloned
}

func packADKTool(req *model.LLMRequest, t *SendA2UIToClientTool) error {
	if req == nil {
		return nil
	}
	if req.Tools == nil {
		req.Tools = make(map[string]any)
	}
	name := t.Name()
	if _, exists := req.Tools[name]; exists {
		return fmt.Errorf("duplicate tool: %q", name)
	}
	req.Tools[name] = t

	if req.Config == nil {
		req.Config = &genai.GenerateContentConfig{}
	}
	decl := t.Declaration()
	if decl == nil {
		return nil
	}
	for _, gt := range req.Config.Tools {
		if gt != nil && gt.FunctionDeclarations != nil {
			gt.FunctionDeclarations = append(gt.FunctionDeclarations, decl)
			return nil
		}
	}
	req.Config.Tools = append(req.Config.Tools, &genai.Tool{
		FunctionDeclarations: []*genai.FunctionDeclaration{decl},
	})
	return nil
}

func extractSystemInstructionText(req *model.LLMRequest) string {
	if req == nil || req.Config == nil || req.Config.SystemInstruction == nil {
		return ""
	}
	var texts []string
	for _, p := range req.Config.SystemInstruction.Parts {
		if p != nil && p.Text != "" {
			texts = append(texts, p.Text)
		}
	}
	return strings.Join(texts, "\n\n")
}

func appendADKSystemInstructions(req *model.LLMRequest, instructions []string) {
	if req == nil || len(instructions) == 0 {
		return
	}
	joined := strings.Join(instructions, "\n\n")
	if req.Config == nil {
		req.Config = &genai.GenerateContentConfig{}
	}
	if req.Config.SystemInstruction == nil {
		req.Config.SystemInstruction = genai.NewContentFromText(joined, genai.RoleUser)
		return
	}
	parts := req.Config.SystemInstruction.Parts
	if len(parts) > 0 && parts[len(parts)-1] != nil && parts[len(parts)-1].Text != "" {
		parts[len(parts)-1].Text += "\n\n" + joined
		return
	}
	req.Config.SystemInstruction.Parts = append(parts, genai.NewPartFromText(joined))
}
