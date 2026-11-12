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

// Package specassets embeds canonical A2UI protocol JSON Schemas and built-in
// component/function catalogs so go/core operates completely offline with zero
// runtime filesystem or network dependencies.
package specassets

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
)

// FS holds the embedded specification/{v0_8,v0_9,v0_9_1,v1_0} and catalogs/{basic,mcp} JSON files.
//
//go:embed specification catalogs
var FS embed.FS

// ReadBytes returns the raw bytes of an embedded JSON asset by its repo-relative path.
func ReadBytes(relPath string) ([]byte, error) {
	data, err := fs.ReadFile(FS, relPath)
	if err != nil {
		return nil, fmt.Errorf("specassets: read %q: %w", relPath, err)
	}
	return data, nil
}

// ReadJSONMap parses an embedded JSON object asset into a fresh map[string]any.
func ReadJSONMap(relPath string) (map[string]any, error) {
	data, err := ReadBytes(relPath)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("specassets: decode %q: %w", relPath, err)
	}
	return out, nil
}
