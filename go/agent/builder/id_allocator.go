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

package builder

import (
	"fmt"
	"strings"
)

// IDAllocator generates deterministic, collision-free scoped component IDs
// of the form "{scope_prefix}__{component_lower}_{counter}" or "{scope_prefix}__{preferred_id}".
type IDAllocator struct {
	ScopePrefix string
	counters    map[string]int
	existingIDs map[string]bool
}

// NewIDAllocator creates an IDAllocator for scopePrefix, pre-seeded with reserved existingIDs.
// When scopePrefix is empty, it defaults to "c".
func NewIDAllocator(scopePrefix string, existingIDs map[string]bool) *IDAllocator {
	if scopePrefix == "" {
		scopePrefix = "c"
	}
	reserved := make(map[string]bool, len(existingIDs))
	for id, ok := range existingIDs {
		if ok {
			reserved[id] = true
		}
	}
	return &IDAllocator{
		ScopePrefix: scopePrefix,
		counters:    make(map[string]int),
		existingIDs: reserved,
	}
}

// Allocate returns a scoped component ID for componentName.
// If preferredID is non-empty, it returns "{ScopePrefix}__{preferredID}";
// otherwise it increments the per-component counter until finding an unreserved ID.
func (a *IDAllocator) Allocate(componentName string, preferredID string) string {
	if preferredID != "" {
		candidate := fmt.Sprintf("%s__%s", a.ScopePrefix, preferredID)
		a.existingIDs[candidate] = true
		return candidate
	}
	prefix := strings.ToLower(componentName)
	for {
		a.counters[prefix]++
		candidate := fmt.Sprintf("%s__%s_%d", a.ScopePrefix, prefix, a.counters[prefix])
		if !a.existingIDs[candidate] {
			a.existingIDs[candidate] = true
			return candidate
		}
	}
}
