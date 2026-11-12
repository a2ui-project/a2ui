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
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/a2aproject/a2a-go/a2a"
	"google.golang.org/genai"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	adkDataPartStartTag = "<a2a_datapart_json>"
	adkDataPartEndTag   = "</a2a_datapart_json>"
	adkDataPartMIMEType = "text/plain"
	adkThoughtMetaKey   = "adk_thought"
	adkTypeMetaKey      = "adk_type"
)

var knownA2UIEnvelopeKeys = map[string]bool{
	"createSurface":            true,
	"updateComponents":         true,
	"updateDataModel":          true,
	"deleteSurface":            true,
	"callRendererFunction":     true,
	"agentFunctionResponse":    true,
	"callAgentFunction":        true,
	"rendererFunctionResponse": true,
	"action":                   true,
	"error":                    true,
	"beginRendering":           true,
	"surfaceUpdate":            true,
	"dataModelUpdate":          true,
	"userAction":               true,
}

// PartConverterOptions configures PartConverter.
type PartConverterOptions struct {
	// BypassToolCheck converts the validated A2UI output of any tool response,
	// not just send_a2ui_json_to_client.
	BypassToolCheck bool
	// FallbackText is sent as a TextPart when an A2UI response can't be parsed.
	FallbackText string
	// Logger receives operational warnings and debug diagnostics. When nil, slog.Default() is used.
	Logger *slog.Logger
}

// PartConverter converts GenAI parts (both send_a2ui_json_to_client tool responses
// and delimited text blocks) into validated A2A Parts using a RequestProcessor.
type PartConverter struct {
	processor *agent.RequestProcessor
	parser    agent.Parser
	state     *agent.RendererState
	opts      PartConverterOptions
	logger    *slog.Logger
}

// NewPartConverter creates a processor-aware PartConverter.
func NewPartConverter(processor *agent.RequestProcessor, opts *PartConverterOptions) *PartConverter {
	var resolved PartConverterOptions
	if opts != nil {
		resolved = *opts
	}
	var parser agent.Parser
	var state *agent.RendererState
	if processor != nil {
		parser = processor.Parser()
		state = processor.State()
	}
	return &PartConverter{
		processor: processor,
		parser:    parser,
		state:     state,
		opts:      resolved,
		logger:    loggerOrDefault(resolved.Logger),
	}
}

// Convert translates one GenAI Part into zero or more A2A Parts.
func (c *PartConverter) Convert(part *genai.Part) ([]a2a.Part, error) {
	if part == nil {
		return nil, nil
	}

	// 1. Handle Tool Responses (FunctionResponse).
	if fr := part.FunctionResponse; fr != nil {
		isSendTool := fr.Name == A2UIToolName
		if isSendTool || c.opts.BypassToolCheck {
			respMap := fr.Response
			if respMap != nil {
				if errVal, hasErr := respMap[A2UIToolErrorKey]; hasErr {
					c.logger.Warn("A2UI tool call failed")
					c.logger.Debug("A2UI tool error", "err", errVal)
					return []a2a.Part{}, nil
				}
				if rawValidated, hasValidated := respMap[ValidatedA2UIJSONKey]; hasValidated {
					msgs := coerceMessageMaps(rawValidated)
					if len(msgs) > 0 {
						out := make([]a2a.Part, len(msgs))
						for i, m := range msgs {
							out[i] = a2aext.CreateA2UIPart(m, "")
						}
						return out, nil
					}
				}
			}
			if isSendTool {
				return []a2a.Part{}, nil
			}
		}

		if fr.Response != nil && c.parser != nil {
			if resStr, ok := fr.Response["result"].(string); ok && c.parser.HasFormatContent(resStr, false) {
				return c.parseContent(resStr), nil
			}
		}
	}

	// 2. Skip sending internal send_a2ui_json_to_client FunctionCall parts to the client.
	if fc := part.FunctionCall; fc != nil && fc.Name == A2UIToolName {
		return []a2a.Part{}, nil
	}

	// 3. Handle Text-based A2UI (excluding model thoughts).
	if part.Text != "" && !part.Thought && c.parser != nil {
		if c.parser.HasFormatContent(part.Text, false) {
			return c.parseContent(part.Text), nil
		}
	}

	// 4. Default GenAI -> A2A conversion (preserving A2UI DataParts encoded by ADK).
	converted, err := convertDefaultGenAIPartToA2AParts(part)
	if err != nil {
		return nil, err
	}
	return converted, nil
}

// parseContent parses an A2UI response into A2A parts. A response that fails to
// parse is not an error for the event being converted: like the other SDKs, the
// converter logs the failure and sends the fallback text in its place.
func (c *PartConverter) parseContent(content string) []a2a.Part {
	parts, err := a2aext.ParseContentToParts(content, c.parser, &a2aext.ParseContentOptions{
		FallbackText: c.opts.FallbackText,
		State:        c.state,
	})
	if err != nil {
		// The error may quote the response, so its text is only logged at debug level.
		c.logger.Warn("Failed to parse A2UI response", "errorType", fmt.Sprintf("%T", err))
		c.logger.Debug("A2UI response parse error", "err", err)
	}
	return parts
}

// EncodeA2APartToGenAI encodes an A2A Part into a GenAI Part using ADK's <a2a_datapart_json> convention.
func EncodeA2APartToGenAI(part a2a.Part) (*genai.Part, error) {
	switch p := part.(type) {
	case a2a.TextPart:
		gp := genai.NewPartFromText(p.Text)
		if thought, ok := p.Metadata[adkThoughtMetaKey].(bool); ok {
			gp.Thought = thought
		}
		return gp, nil
	case *a2a.TextPart:
		if p == nil {
			return nil, nil
		}
		gp := genai.NewPartFromText(p.Text)
		if thought, ok := p.Metadata[adkThoughtMetaKey].(bool); ok {
			gp.Thought = thought
		}
		return gp, nil
	case a2a.DataPart:
		return encodeDataPartToGenAI(p)
	case *a2a.DataPart:
		if p == nil {
			return nil, nil
		}
		return encodeDataPartToGenAI(*p)
	default:
		return nil, nil
	}
}

func encodeDataPartToGenAI(dp a2a.DataPart) (*genai.Part, error) {
	raw, err := json.Marshal(dp.Data)
	if err != nil {
		return nil, err
	}
	buf := make([]byte, 0, len(adkDataPartStartTag)+len(raw)+len(adkDataPartEndTag))
	buf = append(buf, adkDataPartStartTag...)
	buf = append(buf, raw...)
	buf = append(buf, adkDataPartEndTag...)
	return &genai.Part{
		InlineData: &genai.Blob{
			MIMEType: adkDataPartMIMEType,
			Data:     buf,
		},
	}, nil
}

// DecodeGenAIPartA2UIMessages extracts A2UI messages from a GenAI Part carrying an ADK-tagged A2A DataPart.
// Both single JSON objects (wrapped DataPart maps or direct A2UI envelopes) and JSON arrays of A2UI messages
// are supported. Non-tagged parts (such as media blobs or plain text) and malformed JSON return nil without error.
func DecodeGenAIPartA2UIMessages(part *genai.Part) []map[string]any {
	rawJSON, ok := extractTaggedDataPartJSON(part)
	if !ok {
		return nil
	}
	var val any
	if err := json.Unmarshal(rawJSON, &val); err != nil || val == nil {
		return nil
	}
	return extractA2UIMessagesFromDecodedDataPart(val)
}

func extractA2UIMessagesFromDecodedDataPart(val any) []map[string]any {
	switch typed := val.(type) {
	case map[string]any:
		// Support both wrapped DataPart JSON ({"data": ..., "metadata": {"mimeType": ...}})
		// and ADK-Go's direct Data map JSON ({"version": "1.0", "callAgentFunction": ...}).
		if msgs, isWrapped := unwrapTaggedDataPartA2UI(typed); isWrapped {
			return msgs
		}
		if isA2UIEnvelopeMap(typed) {
			return []map[string]any{typed}
		}
		return nil
	case []any:
		if len(typed) == 0 {
			return nil
		}
		out := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			m, ok := item.(map[string]any)
			if !ok {
				return nil
			}
			if msgs, isWrapped := unwrapTaggedDataPartA2UI(m); isWrapped {
				if len(msgs) == 0 {
					return nil
				}
				out = append(out, msgs...)
				continue
			}
			if !isA2UIEnvelopeMap(m) {
				return nil
			}
			out = append(out, m)
		}
		return out
	default:
		return nil
	}
}

func unwrapTaggedDataPartA2UI(obj map[string]any) ([]map[string]any, bool) {
	meta, hasMeta := obj["metadata"].(map[string]any)
	data, hasData := obj["data"].(map[string]any)
	if !hasMeta || !hasData {
		return nil, false
	}
	dp := a2a.DataPart{Data: data, Metadata: meta}
	if a2aext.IsA2UIPart(dp) {
		return []map[string]any{data}, true
	}
	return nil, true
}

func extractTaggedDataPartJSON(part *genai.Part) ([]byte, bool) {
	if part == nil || part.InlineData == nil || len(part.InlineData.Data) == 0 {
		return nil, false
	}
	if part.InlineData.MIMEType != adkDataPartMIMEType {
		return nil, false
	}
	after, ok := bytes.CutPrefix(part.InlineData.Data, []byte(adkDataPartStartTag))
	if !ok {
		return nil, false
	}
	inner, ok := bytes.CutSuffix(after, []byte(adkDataPartEndTag))
	if !ok {
		return nil, false
	}
	return inner, true
}

func isA2UIEnvelopeMap(m map[string]any) bool {
	for k := range m {
		if k == "version" {
			continue
		}
		if knownA2UIEnvelopeKeys[k] {
			return true
		}
	}
	return false
}

func convertDefaultGenAIPartToA2AParts(part *genai.Part) ([]a2a.Part, error) {
	if part == nil {
		return []a2a.Part{}, nil
	}
	if part.Text != "" {
		tp := a2a.TextPart{Text: part.Text}
		if part.Thought {
			tp.Metadata = map[string]any{adkThoughtMetaKey: true}
		}
		return []a2a.Part{tp}, nil
	}
	if rawJSON, ok := extractTaggedDataPartJSON(part); ok {
		var val any
		if err := json.Unmarshal(rawJSON, &val); err != nil {
			return nil, err
		}
		switch typed := val.(type) {
		case map[string]any:
			if meta, ok := typed["metadata"].(map[string]any); ok {
				if data, ok := typed["data"].(map[string]any); ok {
					return []a2a.Part{a2a.DataPart{Data: data, Metadata: meta}}, nil
				}
			}
			if isA2UIEnvelopeMap(typed) {
				return []a2a.Part{a2aext.CreateA2UIPart(typed, "")}, nil
			}
			return []a2a.Part{a2a.DataPart{Data: typed}}, nil
		case []any:
			msgs := extractA2UIMessagesFromDecodedDataPart(typed)
			if len(msgs) == 0 {
				return nil, fmt.Errorf("adk: tagged DataPart JSON array does not contain A2UI message objects")
			}
			out := make([]a2a.Part, len(msgs))
			for i, m := range msgs {
				out[i] = a2aext.CreateA2UIPart(m, "")
			}
			return out, nil
		default:
			return nil, fmt.Errorf("adk: unsupported tagged DataPart JSON value %T", val)
		}
	}
	if part.FileData != nil {
		return []a2a.Part{a2a.FilePart{
			File: a2a.FileURI{
				URI: part.FileData.FileURI,
				FileMeta: a2a.FileMeta{
					MimeType: part.FileData.MIMEType,
					Name:     part.FileData.DisplayName,
				},
			},
		}}, nil
	}
	if part.InlineData != nil {
		return []a2a.Part{a2a.FilePart{
			File: a2a.FileBytes{
				Bytes: base64.StdEncoding.EncodeToString(part.InlineData.Data),
				FileMeta: a2a.FileMeta{
					MimeType: part.InlineData.MIMEType,
					Name:     part.InlineData.DisplayName,
				},
			},
		}}, nil
	}
	if part.FunctionCall != nil {
		data, err := structToMap(part.FunctionCall)
		if err != nil {
			return nil, err
		}
		return []a2a.Part{a2a.DataPart{
			Data:     data,
			Metadata: map[string]any{adkTypeMetaKey: "function_call"},
		}}, nil
	}
	if part.FunctionResponse != nil {
		data, err := structToMap(part.FunctionResponse)
		if err != nil {
			return nil, err
		}
		return []a2a.Part{a2a.DataPart{
			Data:     data,
			Metadata: map[string]any{adkTypeMetaKey: "function_response"},
		}}, nil
	}
	return []a2a.Part{}, nil
}

func structToMap(v any) (map[string]any, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func coerceMessageMaps(v any) []map[string]any {
	switch list := v.(type) {
	case []map[string]any:
		return list
	case []core.AgentToRendererMessage:
		out := make([]map[string]any, len(list))
		for i, m := range list {
			out[i] = map[string]any(m)
		}
		return out
	case []any:
		var out []map[string]any
		for _, item := range list {
			switch m := item.(type) {
			case map[string]any:
				out = append(out, m)
			case core.AgentToRendererMessage:
				out = append(out, map[string]any(m))
			}
		}
		return out
	default:
		return nil
	}
}
