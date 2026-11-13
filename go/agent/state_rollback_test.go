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

package agent_test

import (
	"errors"
	"testing"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

// TestRendererStateRollbackRemovesCreatedSurfaces checks that rolling back a batch
// removes every surface it created, including one whose ID is the empty string.
func TestRendererStateRollbackRemovesCreatedSurfaces(t *testing.T) {
	basic, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog: %v", err)
	}
	for _, surfaceID := range []string{"s1", ""} {
		state, err := agent.NewRendererState([]*core.Catalog{basic})
		if err != nil {
			t.Fatalf("NewRendererState: %v", err)
		}
		errRollback := errors.New("rollback")
		txErr := state.Transaction(func() error {
			if _, err := state.Apply([]core.AgentToRendererMessage{
				{"version": "1.0", "createSurface": map[string]any{"surfaceId": surfaceID}},
			}); err != nil {
				t.Fatalf("Apply(createSurface %q): %v", surfaceID, err)
			}
			return errRollback
		})
		if !errors.Is(txErr, errRollback) {
			t.Fatalf("Transaction returned %v, want the rollback error", txErr)
		}
		if ids := state.SurfaceIDs(); len(ids) != 0 {
			t.Errorf("surfaces after rolling back createSurface %q = %q, want none", surfaceID, ids)
		}
	}
}
