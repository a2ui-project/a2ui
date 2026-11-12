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

package core

import "encoding/json"

// AgentToRendererMessage represents an outbound A2UI protocol message envelope
// (createSurface, updateComponents, updateDataModel, deleteSurface,
// callRendererFunction, agentFunctionResponse, or v0.8 legacy messages).
type AgentToRendererMessage map[string]any

// Clone returns a deep JSON-value copy of the message envelope.
func (m AgentToRendererMessage) Clone() AgentToRendererMessage {
	if m == nil {
		return nil
	}
	cloned, _ := CloneJSONValue(map[string]any(m)).(map[string]any)
	return AgentToRendererMessage(cloned)
}

// RendererToAgentMessage represents a v1.0 inbound renderer-to-agent message envelope.
type RendererToAgentMessage struct {
	Version                  string                    `json:"version"`
	Action                   *ActionPayload            `json:"action,omitempty"`
	CallAgentFunction        *CallAgentFunctionPayload `json:"callAgentFunction,omitempty"`
	RendererFunctionResponse *FunctionResponsePayload  `json:"rendererFunctionResponse,omitempty"`
	Error                    *RendererErrorPayload     `json:"error,omitempty"`
}

// ActionPayload represents the body of a renderer-to-agent "action" message.
type ActionPayload struct {
	Name              string         `json:"name"`
	SurfaceID         string         `json:"surfaceId"`
	SourceComponentID string         `json:"sourceComponentId"`
	Timestamp         string         `json:"timestamp"`
	UserMessage       string         `json:"userMessage,omitempty"`
	Context           map[string]any `json:"context"`
	Metadata          map[string]any `json:"metadata,omitempty"`
}

// CallFunctionPayload represents a function invocation descriptor.
type CallFunctionPayload struct {
	Call      string         `json:"@call"`
	CatalogID string         `json:"catalogId,omitempty"`
	Args      map[string]any `json:"args,omitempty"`
}

// CallAgentFunctionPayload represents a renderer-to-agent remote function call.
type CallAgentFunctionPayload struct {
	SurfaceID      string              `json:"surfaceId"`
	FunctionCallID string              `json:"functionCallId"`
	CallFunction   CallFunctionPayload `json:"callFunction"`
}

// CallRendererFunctionPayload represents an agent-to-renderer remote function call.
type CallRendererFunctionPayload struct {
	SurfaceID      string              `json:"surfaceId,omitempty"`
	FunctionCallID string              `json:"functionCallId"`
	CallFunction   CallFunctionPayload `json:"callFunction"`
}

// FunctionResponseError describes a failed remote function call.
type FunctionResponseError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// FunctionResponsePayload represents the result or error of a remote function call.
type FunctionResponsePayload struct {
	FunctionCallID string                 `json:"functionCallId"`
	Value          any                    `json:"value,omitempty"`
	HasValue       bool                   `json:"-"`
	Error          *FunctionResponseError `json:"error,omitempty"`
}

// MarshalJSON preserves explicit null values when HasValue is true and Error is nil.
func (p FunctionResponsePayload) MarshalJSON() ([]byte, error) {
	out := map[string]any{
		"functionCallId": p.FunctionCallID,
	}
	if p.Error != nil {
		out["error"] = p.Error
	} else if p.HasValue || p.Value != nil {
		out["value"] = p.Value
	}
	return json.Marshal(out)
}

// UnmarshalJSON decodes a FunctionResponsePayload while recording whether the "value" key was present.
func (p *FunctionResponsePayload) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*p = FunctionResponsePayload{}
	if v, ok := raw["functionCallId"]; ok {
		if err := json.Unmarshal(v, &p.FunctionCallID); err != nil {
			return err
		}
	}
	if v, ok := raw["value"]; ok {
		p.HasValue = true
		val, err := ParseJSON(v)
		if err != nil {
			return err
		}
		p.Value = val
	}
	if v, ok := raw["error"]; ok && string(v) != "null" {
		var fnErr FunctionResponseError
		if err := json.Unmarshal(v, &fnErr); err != nil {
			return err
		}
		p.Error = &fnErr
	}
	return nil
}

// RendererErrorPayload represents the body of a renderer-to-agent "error" message.
type RendererErrorPayload struct {
	Code           string         `json:"code"`
	Message        string         `json:"message"`
	SurfaceID      string         `json:"surfaceId,omitempty"`
	FunctionCallID string         `json:"functionCallId,omitempty"`
	Path           string         `json:"path,omitempty"`
	Extra          map[string]any `json:"-"`
}

// MarshalJSON encodes RendererErrorPayload, merging any Extra fields alongside standard error fields.
func (p RendererErrorPayload) MarshalJSON() ([]byte, error) {
	out := make(map[string]any, 5+len(p.Extra))
	for k, v := range p.Extra {
		out[k] = v
	}
	out["code"] = p.Code
	out["message"] = p.Message
	if p.SurfaceID != "" {
		out["surfaceId"] = p.SurfaceID
	}
	if p.FunctionCallID != "" {
		out["functionCallId"] = p.FunctionCallID
	}
	if p.Path != "" {
		out["path"] = p.Path
	}
	return json.Marshal(out)
}

// UnmarshalJSON decodes RendererErrorPayload, preserving any non-standard properties in Extra.
func (p *RendererErrorPayload) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*p = RendererErrorPayload{}
	for k, v := range raw {
		switch k {
		case "code":
			if err := json.Unmarshal(v, &p.Code); err != nil {
				return err
			}
		case "message":
			if err := json.Unmarshal(v, &p.Message); err != nil {
				return err
			}
		case "surfaceId":
			if err := json.Unmarshal(v, &p.SurfaceID); err != nil {
				return err
			}
		case "functionCallId":
			if err := json.Unmarshal(v, &p.FunctionCallID); err != nil {
				return err
			}
		case "path":
			if err := json.Unmarshal(v, &p.Path); err != nil {
				return err
			}
		default:
			decoded, err := ParseJSON(v)
			if err != nil {
				return err
			}
			if p.Extra == nil {
				p.Extra = make(map[string]any)
			}
			p.Extra[k] = decoded
		}
	}
	return nil
}

// RendererCapabilityEntry holds supported catalog IDs and optional inline catalogs for one protocol version.
type RendererCapabilityEntry struct {
	SupportedCatalogIDs []string         `json:"supportedCatalogIds"`
	InlineCatalogs      []map[string]any `json:"inlineCatalogs,omitempty"`
}

// MarshalJSON encodes RendererCapabilityEntry with a non-null supportedCatalogIds JSON array.
func (e RendererCapabilityEntry) MarshalJSON() ([]byte, error) {
	type alias RendererCapabilityEntry
	a := alias(e)
	if a.SupportedCatalogIDs == nil {
		a.SupportedCatalogIDs = []string{}
	}
	return json.Marshal(a)
}

// RendererCapabilities maps canonical or wire version keys (such as "1.0" or "v0.9") to capability entries.
type RendererCapabilities map[string]RendererCapabilityEntry

// CloneJSONValue recursively copies JSON-compatible Go maps and slices.
func CloneJSONValue(v any) any {
	switch val := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(val))
		for k, item := range val {
			out[k] = CloneJSONValue(item)
		}
		return out
	case []any:
		out := make([]any, len(val))
		for i, item := range val {
			out[i] = CloneJSONValue(item)
		}
		return out
	default:
		return v
	}
}
