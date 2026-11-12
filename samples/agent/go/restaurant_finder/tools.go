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
	"runtime"
	"strings"

	adkagent "google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/tool"
	"google.golang.org/adk/v2/tool/functiontool"
)

// getRestaurantsArgs defines the structured input parameters for the get_restaurants tool.
type getRestaurantsArgs struct {
	Cuisine  string `json:"cuisine" jsonschema:"The cuisine type to search for."`
	Location string `json:"location" jsonschema:"The location to search in."`
	Count    int    `json:"count,omitempty" jsonschema:"The number of restaurants to return."`
}

// getRestaurantsResult wraps the JSON-encoded restaurant array returned by get_restaurants.
type getRestaurantsResult struct {
	Restaurants string `json:"result"`
}

// resolveRepoRoot locates the repository root directory containing catalogs/basic/v1/catalog.json.
func resolveRepoRoot() (string, error) {
	if _, thisFile, _, ok := runtime.Caller(0); ok {
		candidate := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", ".."))
		if _, err := os.Stat(filepath.Join(candidate, "catalogs", "basic", "v1", "catalog.json")); err == nil {
			return candidate, nil
		}
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, statErr := os.Stat(filepath.Join(dir, "catalogs", "basic", "v1", "catalog.json")); statErr == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not locate repository root from %q", dir)
		}
		dir = parent
	}
}

// resolvePythonSampleDir returns the path to samples/agent/adk/restaurant_finder.
func resolvePythonSampleDir(repoRoot string) string {
	return filepath.Join(repoRoot, "samples", "agent", "adk", "restaurant_finder")
}

// resolveNodeSampleDir returns the path to samples/agent/node/restaurant_finder.
func resolveNodeSampleDir(repoRoot string) string {
	return filepath.Join(repoRoot, "samples", "agent", "node", "restaurant_finder")
}

// verifySampleAssets checks that the shared restaurant data, images, and example payloads exist on disk.
func verifySampleAssets(repoRoot string) error {
	pyDir := resolvePythonSampleDir(repoRoot)
	dataPath := filepath.Join(pyDir, "restaurant_data.json")
	imagesDir := filepath.Join(pyDir, "images")
	if _, err := os.Stat(dataPath); err != nil {
		return fmt.Errorf("required restaurant data file not found at %s: %w", dataPath, err)
	}
	if info, err := os.Stat(imagesDir); err != nil || !info.IsDir() {
		return fmt.Errorf("required images directory not found at %s", imagesDir)
	}
	return nil
}

// executeGetRestaurants reads matching restaurant entries from restaurant_data.json, rewriting localhost:10002 URLs to baseURL.
func executeGetRestaurants(args getRestaurantsArgs, baseURL, pythonSampleDir string) string {
	count := args.Count
	if count <= 0 {
		count = 5
	}
	locLower := strings.ToLower(args.Location)
	var items []any
	if strings.Contains(locLower, "new york") || strings.Contains(locLower, "ny") || strings.Contains(locLower, "nyc") {
		filePath := filepath.Join(pythonSampleDir, "restaurant_data.json")
		if rawBytes, err := os.ReadFile(filePath); err == nil {
			rawStr := string(rawBytes)
			if baseURL != "" {
				rawStr = strings.ReplaceAll(rawStr, "http://localhost:10002", strings.TrimRight(baseURL, "/"))
			}
			var all []any
			if jsonErr := json.Unmarshal([]byte(rawStr), &all); jsonErr == nil {
				if count < len(all) {
					items = all[:count]
				} else {
					items = all
				}
			}
		}
	}
	if items == nil {
		items = []any{}
	}
	encoded, _ := json.Marshal(items)
	return string(encoded)
}

// newGetRestaurantsTool builds an ADK FunctionTool for get_restaurants.
func newGetRestaurantsTool(defaultBaseURL, pythonSampleDir string) (tool.Tool, error) {
	return functiontool.New(
		functiontool.Config{
			Name:        "get_restaurants",
			Description: "Call this tool to get a list of restaurants based on a cuisine and location. 'count' is the number of restaurants to return.",
		},
		func(ctx adkagent.Context, args getRestaurantsArgs) (getRestaurantsResult, error) {
			baseURL := defaultBaseURL
			if ctx != nil && ctx.ReadonlyState() != nil {
				if v, err := ctx.ReadonlyState().Get("base_url"); err == nil {
					if s, ok := v.(string); ok && s != "" {
						baseURL = s
					}
				}
			}
			return getRestaurantsResult{
				Restaurants: executeGetRestaurants(args, baseURL, pythonSampleDir),
			}, nil
		},
	)
}
