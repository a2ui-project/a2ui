package a2uiadk

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2uischema"
	"github.com/a2ui-project/a2ui/agent_sdks/go/a2uistream"
)

const (
	ToolName         = "send_a2ui_json_to_client"
	ValidatedJSONKey = "validated_a2ui_json"
	ToolErrorKey     = "error"
	A2UIJSONArgName  = "a2ui_json"
)

// ToolDeclaration describes the A2UI tool for adapters that expose tools to an LLM.
type ToolDeclaration struct {
	Name        string
	Description string
	Parameters  map[string]any
	Required    []string
}

// ToolContext carries mutable execution state for the tool call.
type ToolContext struct {
	SkipSummarization bool
}

// SendA2UIJSONToClientTool validates A2UI JSON supplied by an LLM tool call.
type SendA2UIJSONToClientTool struct {
	Validator *a2uischema.Validator
}

// NewSendA2UIJSONToClientTool returns a tool that validates against validator.
func NewSendA2UIJSONToClientTool(validator *a2uischema.Validator) SendA2UIJSONToClientTool {
	return SendA2UIJSONToClientTool{Validator: validator}
}

// Declaration returns a transport-neutral function declaration for this tool.
func (t SendA2UIJSONToClientTool) Declaration() ToolDeclaration {
	return ToolDeclaration{
		Name:        ToolName,
		Description: "Sends A2UI JSON to the client to render rich UI natively. Always prefer this over returning raw JSON.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				A2UIJSONArgName: map[string]any{
					"type":        "string",
					"description": "The A2UI JSON payload to send to the client.",
				},
			},
		},
		Required: []string{A2UIJSONArgName},
	}
}

// ProcessInstructions returns schema and examples text to append to LLM instructions.
func ProcessInstructions(catalog *a2uischema.Catalog, examples string) ([]string, error) {
	if catalog == nil {
		return nil, fmt.Errorf("a2uiadk: nil catalog")
	}
	instructions, err := catalog.RenderAsLLMInstructions()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(examples) == "" {
		return []string{instructions}, nil
	}
	return []string{instructions, examples}, nil
}

// Run validates the a2ui_json argument and returns a result map.
func (t SendA2UIJSONToClientTool) Run(args map[string]any, ctx *ToolContext) map[string]any {
	payload, ok := args[A2UIJSONArgName].(string)
	if !ok || payload == "" {
		return toolError(fmt.Errorf("missing required arg %s", A2UIJSONArgName))
	}
	if t.Validator == nil {
		return toolError(fmt.Errorf("nil validator"))
	}
	objects, err := a2uistream.FixPayload(payload)
	if err != nil {
		return toolError(err)
	}
	data, err := json.Marshal(objects)
	if err != nil {
		return toolError(err)
	}
	if err := t.Validator.ValidateJSON(data); err != nil {
		return toolError(err)
	}
	if ctx != nil {
		ctx.SkipSummarization = true
	}
	return map[string]any{ValidatedJSONKey: objects}
}

func toolError(err error) map[string]any {
	return map[string]any{
		ToolErrorKey: fmt.Sprintf("Failed to call A2UI tool %s: %v", ToolName, err),
	}
}
