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

package v1

import (
	"github.com/a2ui-project/a2ui/go/agent/builder"
	"github.com/a2ui-project/a2ui/go/core"
)

// CreateSurfaceOptions configures a v1.0 createSurface message envelope.
type CreateSurfaceOptions struct {
	SurfaceID     string
	CatalogID     string
	SendDataModel *bool
	Components    []map[string]any
	DataModel     map[string]any
	Extensions    Extensions
}

func componentsToAnySlice(components []map[string]any) []any {
	out := make([]any, len(components))
	for i, comp := range components {
		out[i] = core.CloneJSONValue(comp)
	}
	return out
}

// CreateSurface constructs a v1.0 createSurface message envelope, validating UAX #31 extension keys.
func CreateSurface(opts CreateSurfaceOptions) (core.AgentToRendererMessage, error) {
	if opts.SurfaceID == "" {
		return nil, core.NewValidationError("createSurface surfaceId must not be empty")
	}
	body := map[string]any{
		"surfaceId": opts.SurfaceID,
	}
	if opts.CatalogID != "" {
		body["catalogId"] = opts.CatalogID
	}
	if opts.SendDataModel != nil {
		body["sendDataModel"] = *opts.SendDataModel
	}
	if len(opts.Components) > 0 {
		body["components"] = componentsToAnySlice(opts.Components)
	}
	if opts.DataModel != nil {
		body["dataModel"] = core.CloneJSONValue(opts.DataModel)
	}
	if len(opts.Extensions) > 0 {
		if err := opts.Extensions.Validate(); err != nil {
			return nil, err
		}
		extCopy, _ := core.CloneJSONValue(map[string]any(opts.Extensions)).(map[string]any)
		body["metadata"] = map[string]any{"extensions": extCopy}
	}
	return core.AgentToRendererMessage{
		"version":       core.Version1_0.WireVersion(),
		"createSurface": body,
	}, nil
}

// UpdateComponents constructs a v1.0 updateComponents message envelope.
func UpdateComponents(surfaceID string, components []map[string]any) core.AgentToRendererMessage {
	return core.AgentToRendererMessage{
		"version": core.Version1_0.WireVersion(),
		"updateComponents": map[string]any{
			"surfaceId":  surfaceID,
			"components": componentsToAnySlice(components),
		},
	}
}

// UpdateComponentsFromTree flattens root and packages it into a v1.0 updateComponents message envelope.
func UpdateComponentsFromTree(surfaceID string, root builder.Node, rootID string) (core.AgentToRendererMessage, error) {
	flat, err := builder.FlattenComponentTree(root, rootID)
	if err != nil {
		return nil, err
	}
	return UpdateComponents(surfaceID, flat), nil
}

// UpdateDataModel constructs a v1.0 updateDataModel message envelope.
// Note that in v1.0 an explicit nil value deletes the entry at path.
func UpdateDataModel(surfaceID, path string, value any) core.AgentToRendererMessage {
	body := map[string]any{
		"surfaceId": surfaceID,
		"value":     core.CloneJSONValue(value),
	}
	if path != "" {
		body["path"] = path
	}
	return core.AgentToRendererMessage{
		"version":         core.Version1_0.WireVersion(),
		"updateDataModel": body,
	}
}

// DeleteSurface constructs a v1.0 deleteSurface message envelope.
func DeleteSurface(surfaceID string) core.AgentToRendererMessage {
	return core.AgentToRendererMessage{
		"version": core.Version1_0.WireVersion(),
		"deleteSurface": map[string]any{
			"surfaceId": surfaceID,
		},
	}
}

// SetSurfaceExtensions attaches or clears metadata.extensions on matching createSurface envelopes.
// If surfaceID is empty, all createSurface envelopes in messages are updated; otherwise only
// envelopes whose createSurface.surfaceId equals surfaceID are modified.
func SetSurfaceExtensions(
	messages []core.AgentToRendererMessage,
	surfaceID string,
	extensions Extensions,
) ([]core.AgentToRendererMessage, error) {
	if len(extensions) > 0 {
		if err := extensions.Validate(); err != nil {
			return nil, err
		}
	}
	out := make([]core.AgentToRendererMessage, 0, len(messages))
	for _, msg := range messages {
		cs, ok := msg["createSurface"].(map[string]any)
		if !ok {
			out = append(out, msg.Clone())
			continue
		}
		msgSID, _ := cs["surfaceId"].(string)
		if surfaceID != "" && msgSID != surfaceID {
			out = append(out, msg.Clone())
			continue
		}
		clonedMsg := msg.Clone()
		clonedCS, _ := clonedMsg["createSurface"].(map[string]any)
		if len(extensions) > 0 {
			extCopy, _ := core.CloneJSONValue(map[string]any(extensions)).(map[string]any)
			clonedCS["metadata"] = map[string]any{"extensions": extCopy}
		} else {
			delete(clonedCS, "metadata")
		}
		out = append(out, clonedMsg)
	}
	return out, nil
}
