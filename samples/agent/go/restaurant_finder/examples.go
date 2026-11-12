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
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// readMessagesFile parses a JSON file containing a slice of A2UI wire messages.
func readMessagesFile(path string) ([]core.AgentToRendererMessage, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var list []map[string]any
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	out := make([]core.AgentToRendererMessage, len(list))
	for i, m := range list {
		out[i] = core.AgentToRendererMessage(m)
	}
	return out, nil
}

// toResponseText serializes A2UI wire messages into wrapped <a2ui> (Express) or <a2ui-json> (Direct JSON) text.
func toResponseText(catalog *core.Catalog, format a2uiFormat, messages []core.AgentToRendererMessage) (string, error) {
	if format == formatDirectJSON {
		pretty, err := json.MarshalIndent(messages, "", "  ")
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%s\n%s\n%s", agent.JSONOpenTag, string(pretty), agent.JSONCloseTag), nil
	}
	ef, err := agent.NewExpressFormat([]*core.Catalog{catalog}, nil, nil)
	if err != nil {
		return "", err
	}
	parser := ef.CreateParser()
	dsl, err := parser.Decompile(messages)
	if err != nil {
		return "", err
	}
	return parser.Wrap([]agent.RawResponsePart{agent.NewRawA2UIPart(dsl, true)}), nil
}

// loadExampleTurns loads sorted few-shot example turns for profile from the shared restaurant_finder examples.
func loadExampleTurns(repoRoot string, profile versionProfile) ([][]core.AgentToRendererMessage, map[string][]core.AgentToRendererMessage, error) {
	examplesDir := filepath.Join(resolveNodeSampleDir(repoRoot), "examples", profile.Version)
	entries, err := os.ReadDir(examplesDir)
	if err != nil {
		return nil, nil, fmt.Errorf("examples directory not found at %s: %w", examplesDir, err)
	}

	var names []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		return nil, nil, fmt.Errorf("no example files found in %s", examplesDir)
	}

	var turns [][]core.AgentToRendererMessage
	byName := make(map[string][]core.AgentToRendererMessage, len(names))
	for _, fileName := range names {
		msgs, err := readMessagesFile(filepath.Join(examplesDir, fileName))
		if err != nil {
			return nil, nil, err
		}
		base := strings.TrimSuffix(fileName, ".json")
		turns = append(turns, msgs)
		byName[base] = msgs
	}
	return turns, byName, nil
}

// loadStubNotice loads the stub-notice surface messages for profile.
func loadStubNotice(repoRoot string, profile versionProfile) ([]core.AgentToRendererMessage, error) {
	path := filepath.Join(resolveNodeSampleDir(repoRoot), "stub_notice", profile.Version+".json")
	return readMessagesFile(path)
}

// loadBasicCatalogs loads the v0.9 and v1.0 Basic Catalogs from the repository specifications.
func loadBasicCatalogs(repoRoot string) (map[string]*core.Catalog, error) {
	out := make(map[string]*core.Catalog, len(servedVersions))
	for _, profile := range servedVersions {
		prov := &agent.FileSystemCatalogProvider{
			Path:            filepath.Join(repoRoot, filepath.FromSlash(profile.BasicCatalogRel)),
			ProtocolVersion: profile.ProtocolVersion,
		}
		cat, err := prov.Load()
		if err != nil {
			return nil, fmt.Errorf("load catalog for %s: %w", profile.Version, err)
		}
		out[profile.Version] = cat
	}
	return out, nil
}
