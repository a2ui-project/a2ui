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

// Package adk connects the A2UI Go Agent SDK with Google's Agent Development
// Kit (ADK) for Go, providing toolsets, instruction providers, session stores,
// streaming event converters, RPC callbacks, and subagent surface ownership helpers.
package adk

import (
	"log/slog"
	"time"
)

const (
	// A2UIToolName is the canonical function declaration name for sending A2UI payloads via tool call.
	A2UIToolName = "send_a2ui_json_to_client"
	// A2UIPayloadArgName is the required string argument name of send_a2ui_json_to_client.
	A2UIPayloadArgName = "a2ui_payload"
	// ValidatedA2UIJSONKey is the map key returned on successful send_a2ui_json_to_client execution.
	ValidatedA2UIJSONKey = "validated_a2ui_json"
	// A2UIToolErrorKey is the map key returned when send_a2ui_json_to_client fails validation.
	A2UIToolErrorKey = "error"

	// SurfaceIDKeyPrefix prefixes session state keys recording subagent surface ownership.
	SurfaceIDKeyPrefix = "a2ui_surface_id_"

	// DefaultStreamIdleTimeout is the default inactivity duration after which an unclosed EventConverter stream is dropped.
	DefaultStreamIdleTimeout = 600 * time.Second
)

func loggerOrDefault(logger *slog.Logger) *slog.Logger {
	if logger != nil {
		return logger
	}
	return slog.Default()
}
