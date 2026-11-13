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

package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// defaultPort is the default HTTP port served by the Restaurant Finder sample agent.
const defaultPort = 10002

// defaultModelName is the default Gemini model used when MODEL_NAME is unset.
const defaultModelName = "gemini-3.8-flash"

// defaultVertexLocation is the default Vertex AI location (required for gemini-3.8-flash).
const defaultVertexLocation = "global"

// a2uiFormat identifies the inference format written by the model.
type a2uiFormat string

const (
	// formatExpress instructs the model to write A2UI Express DSL inside <a2ui> tags (default).
	formatExpress a2uiFormat = "express"
	// formatDirectJSON instructs the model to write A2UI JSON inside <a2ui-json> tags.
	formatDirectJSON a2uiFormat = "direct_json"
)

// llmMode selects between deterministic canned responses and live Gemini/Vertex AI inference.
type llmMode string

const (
	// modeStub serves 4-chunk canned responses without calling a model.
	modeStub llmMode = "stub"
	// modeLive invokes Gemini via Google ADK-Go (using GEMINI_API_KEY or Vertex AI).
	modeLive llmMode = "live"
)

// sampleConfig holds resolved configuration for creating and running the sample server.
type sampleConfig struct {
	Port          int
	Format        a2uiFormat
	Mode          llmMode
	ModelName     string
	GeminiAPIKey  string
	UseVertexAI   bool
	VertexProject string
	VertexLoc     string
}

// envMapFromOS converts os.Environ() into a key-value map for ResolveSampleConfig.
func envMapFromOS() map[string]string {
	out := make(map[string]string)
	for _, entry := range os.Environ() {
		if k, v, ok := strings.Cut(entry, "="); ok {
			out[k] = v
		}
	}
	return out
}

// resolveSampleConfig parses and validates environment variables for the sample server.
func resolveSampleConfig(env map[string]string, portOverride int) (sampleConfig, error) {
	if env == nil {
		env = envMapFromOS()
	}

	port := defaultPort
	if portOverride >= 0 && portOverride != 0 {
		port = portOverride
	} else if rawPort := strings.TrimSpace(env["PORT"]); rawPort != "" {
		parsed, err := strconv.Atoi(rawPort)
		if err != nil || parsed < 0 || parsed > 65535 {
			return sampleConfig{}, fmt.Errorf("PORT must be a valid TCP port number, got %q", env["PORT"])
		}
		port = parsed
	}
	if portOverride == 0 && env["PORT"] == "0" {
		port = 0
	}

	format := formatExpress
	if rawFmt, hasFmt := env["A2UI_FORMAT"]; hasFmt && strings.TrimSpace(rawFmt) != "" {
		trimmed := strings.TrimSpace(rawFmt)
		switch a2uiFormat(trimmed) {
		case formatExpress, formatDirectJSON:
			format = a2uiFormat(trimmed)
		default:
			return sampleConfig{}, fmt.Errorf(
				`A2UI_FORMAT must be "express" or "direct_json", but it is %q`,
				env["A2UI_FORMAT"],
			)
		}
	}

	rawStub, hasStub := env["STUB_LLM"]
	trimmedStub := strings.TrimSpace(rawStub)
	if hasStub && trimmedStub != "" && trimmedStub != "true" && trimmedStub != "false" {
		return sampleConfig{}, fmt.Errorf(
			`STUB_LLM must be "true" or "false", but it is %q. Use STUB_LLM=true to serve the canned response without calling a model`,
			rawStub,
		)
	}

	modelName := strings.TrimSpace(env["MODEL_NAME"])
	if modelName == "" {
		modelName = defaultModelName
	}
	if idx := strings.LastIndex(modelName, "/"); idx >= 0 {
		modelName = modelName[idx+1:]
	}

	if trimmedStub == "true" {
		return sampleConfig{
			Port:      port,
			Format:    format,
			Mode:      modeStub,
			ModelName: modelName,
		}, nil
	}

	apiKey := strings.TrimSpace(env["GEMINI_API_KEY"])
	useVertex := strings.EqualFold(strings.TrimSpace(env["GOOGLE_GENAI_USE_VERTEXAI"]), "true") ||
		strings.TrimSpace(env["GOOGLE_GENAI_USE_VERTEXAI"]) == "1"
	project := strings.TrimSpace(env["GOOGLE_CLOUD_PROJECT"])
	loc := strings.TrimSpace(env["GOOGLE_CLOUD_LOCATION"])
	if loc == "" {
		loc = defaultVertexLocation
	}

	if useVertex || (apiKey == "" && project != "") {
		if project == "" {
			return sampleConfig{}, fmt.Errorf("GOOGLE_CLOUD_PROJECT is required when GOOGLE_GENAI_USE_VERTEXAI is enabled")
		}
		return sampleConfig{
			Port:          port,
			Format:        format,
			Mode:          modeLive,
			ModelName:     modelName,
			UseVertexAI:   true,
			VertexProject: project,
			VertexLoc:     loc,
		}, nil
	}

	if apiKey != "" {
		return sampleConfig{
			Port:         port,
			Format:       format,
			Mode:         modeLive,
			ModelName:    modelName,
			GeminiAPIKey: apiKey,
		}, nil
	}

	return sampleConfig{}, fmt.Errorf(
		"no LLM credentials configured: set GEMINI_API_KEY, set GOOGLE_GENAI_USE_VERTEXAI=true with GOOGLE_CLOUD_PROJECT, or pass STUB_LLM=true",
	)
}
