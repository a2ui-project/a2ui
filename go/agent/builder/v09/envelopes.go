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

package v09

import (
	"github.com/a2ui-project/a2ui/go/agent/builder"
	"github.com/a2ui-project/a2ui/go/core"
)

func resolveWireVersion(ver core.ProtocolVersion) string {
	if ver == core.Version0_9_1 {
		return core.Version0_9_1.WireVersion()
	}
	return core.Version0_9.WireVersion()
}

// CreateSurfaceOptions configures a v0.9 / v0.9.1 createSurface message envelope.
type CreateSurfaceOptions struct {
	SurfaceID     string
	CatalogID     string
	Theme         map[string]any
	SendDataModel *bool
	Version       core.ProtocolVersion
}

// CreateSurface constructs a v0.9 / v0.9.1 createSurface message envelope.
func CreateSurface(opts CreateSurfaceOptions) (core.AgentToRendererMessage, error) {
	if opts.SurfaceID == "" {
		return nil, core.NewValidationError("createSurface surfaceId must not be empty")
	}
	if opts.CatalogID == "" {
		return nil, core.NewValidationError("v0.9 createSurface catalogId must not be empty")
	}
	body := map[string]any{
		"surfaceId": opts.SurfaceID,
		"catalogId": opts.CatalogID,
	}
	if opts.Theme != nil {
		body["theme"] = core.CloneJSONValue(opts.Theme)
	}
	if opts.SendDataModel != nil {
		body["sendDataModel"] = *opts.SendDataModel
	}
	return core.AgentToRendererMessage{
		"version":       resolveWireVersion(opts.Version),
		"createSurface": body,
	}, nil
}

func componentsToAnySlice(components []map[string]any) []any {
	out := make([]any, len(components))
	for i, comp := range components {
		out[i] = core.CloneJSONValue(comp)
	}
	return out
}

// UpdateComponents constructs a v0.9 updateComponents message envelope.
func UpdateComponents(surfaceID string, components []map[string]any) core.AgentToRendererMessage {
	return core.AgentToRendererMessage{
		"version": core.Version0_9.WireVersion(),
		"updateComponents": map[string]any{
			"surfaceId":  surfaceID,
			"components": componentsToAnySlice(components),
		},
	}
}

// UpdateComponentsFromTree flattens root and packages it into a v0.9 updateComponents message envelope.
func UpdateComponentsFromTree(surfaceID string, root builder.Node, rootID string) (core.AgentToRendererMessage, error) {
	flat, err := builder.FlattenComponentTree(root, rootID)
	if err != nil {
		return nil, err
	}
	return UpdateComponents(surfaceID, flat), nil
}

// UpdateDataModel constructs a v0.9 updateDataModel message envelope.
func UpdateDataModel(surfaceID, path string, value any) core.AgentToRendererMessage {
	body := map[string]any{
		"surfaceId": surfaceID,
	}
	if path != "" {
		body["path"] = path
	}
	if value != nil {
		body["value"] = core.CloneJSONValue(value)
	}
	return core.AgentToRendererMessage{
		"version":         core.Version0_9.WireVersion(),
		"updateDataModel": body,
	}
}

// DeleteSurface constructs a v0.9 deleteSurface message envelope.
func DeleteSurface(surfaceID string) core.AgentToRendererMessage {
	return core.AgentToRendererMessage{
		"version": core.Version0_9.WireVersion(),
		"deleteSurface": map[string]any{
			"surfaceId": surfaceID,
		},
	}
}
