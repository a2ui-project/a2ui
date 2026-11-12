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

package specassets_test

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/a2ui-project/a2ui/go/core/internal/specassets"
)

func findRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "specification", "versions.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Skip("repository root with specification/versions.json not found above working directory")
		}
		dir = parent
	}
}

func TestEmbeddedAssetsParityWithRepoSource(t *testing.T) {
	repoRoot := findRepoRoot(t)
	count := 0
	err := fs.WalkDir(specassets.FS, ".", func(relPath string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		count++
		embeddedBytes, err := specassets.ReadBytes(relPath)
		if err != nil {
			t.Fatalf("ReadBytes(%q): %v", relPath, err)
		}
		repoPath := filepath.Join(repoRoot, filepath.FromSlash(relPath))
		sourceBytes, err := os.ReadFile(repoPath)
		if err != nil {
			t.Fatalf("os.ReadFile(%q): %v", repoPath, err)
		}
		if !bytes.Equal(embeddedBytes, sourceBytes) {
			t.Errorf("byte mismatch for %q between embedded specassets and repo source %q", relPath, repoPath)
		}
		var embJSON, srcJSON any
		if err := json.Unmarshal(embeddedBytes, &embJSON); err != nil {
			t.Fatalf("unmarshal embedded %q: %v", relPath, err)
		}
		if err := json.Unmarshal(sourceBytes, &srcJSON); err != nil {
			t.Fatalf("unmarshal source %q: %v", repoPath, err)
		}
		if !reflect.DeepEqual(embJSON, srcJSON) {
			t.Errorf("JSON semantic mismatch for %q", relPath)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("WalkDir failed: %v", err)
	}
	if count == 0 {
		t.Fatal("expected non-zero embedded JSON assets")
	}
}
