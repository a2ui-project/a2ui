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

package schemahelper

import (
	"fmt"
	"runtime"
	"slices"
	"sync"
	"testing"
	"time"
)

func TestOrderedKeys(t *testing.T) {
	m := map[string]any{"zeta": 1, "alpha": 2, "mid": 3}
	if got, want := OrderedKeys(m), []string{"alpha", "mid", "zeta"}; !slices.Equal(got, want) {
		t.Errorf("OrderedKeys(unregistered) = %v, want %v", got, want)
	}

	SetMapKeyOrder(m, []string{"zeta", "alpha", "mid"})
	if got, want := OrderedKeys(m), []string{"zeta", "alpha", "mid"}; !slices.Equal(got, want) {
		t.Errorf("OrderedKeys(registered) = %v, want %v", got, want)
	}

	// Keys added after registration follow the recorded ones alphabetically, and
	// recorded keys that were deleted are skipped.
	m["beta"] = 4
	m["aardvark"] = 5
	delete(m, "alpha")
	if got, want := OrderedKeys(m), []string{"zeta", "mid", "aardvark", "beta"}; !slices.Equal(got, want) {
		t.Errorf("OrderedKeys(after edits) = %v, want %v", got, want)
	}

	SetMapKeyOrder(m, []string{"mid", "beta", "zeta", "aardvark"})
	if got, want := OrderedKeys(m), []string{"mid", "beta", "zeta", "aardvark"}; !slices.Equal(got, want) {
		t.Errorf("OrderedKeys(re-registered) = %v, want %v", got, want)
	}
}

// TestKeyOrderSurvivesOtherRegistrations checks that a long-lived map keeps its order no
// matter how many other maps are registered while it is alive.
func TestKeyOrderSurvivesOtherRegistrations(t *testing.T) {
	m := map[string]any{"b": 1, "a": 2, "c": 3}
	SetMapKeyOrder(m, []string{"b", "a", "c"})
	for i := range 200_000 {
		SetMapKeyOrder(map[string]any{"x": i}, []string{"x"})
	}
	if got, want := OrderedKeys(m), []string{"b", "a", "c"}; !slices.Equal(got, want) {
		t.Errorf("OrderedKeys() = %v, want %v", got, want)
	}
}

// TestKeyOrderDoesNotRetainMaps checks that registering a map does not keep it alive.
func TestKeyOrderDoesNotRetainMaps(t *testing.T) {
	collected := make(chan struct{})
	func() {
		m := map[string]any{"a": 1, "b": 2}
		SetMapKeyOrder(m, []string{"b", "a"})
		runtime.AddCleanup(mapIdentity(m), func(ch chan struct{}) { close(ch) }, collected)
	}()
	for range 20 {
		runtime.GC()
		select {
		case <-collected:
			return
		case <-time.After(10 * time.Millisecond):
		}
	}
	t.Fatal("a registered map was never garbage collected")
}

// TestKeyOrderNotInheritedAtReusedAddress checks that maps allocated after earlier
// registered maps were collected, possibly at the same addresses, start unregistered.
func TestKeyOrderNotInheritedAtReusedAddress(t *testing.T) {
	for range 20_000 {
		SetMapKeyOrder(map[string]any{"z": 1, "a": 2}, []string{"z", "a"})
	}
	runtime.GC()
	runtime.GC()
	for i := range 20_000 {
		m := map[string]any{"z": 1, "a": 2}
		if got, want := OrderedKeys(m), []string{"a", "z"}; !slices.Equal(got, want) {
			t.Fatalf("OrderedKeys(new map %d) = %v, want %v", i, got, want)
		}
	}
}

func TestKeyOrderRegistryDropsCollectedEntries(t *testing.T) {
	for i := range 100_000 {
		SetMapKeyOrder(map[string]any{"x": i}, []string{"x"})
	}
	runtime.GC()
	runtime.GC()
	// Every shard sweeps again once it has grown enough, which drops the entries of
	// the maps registered above.
	for i := range 100_000 {
		SetMapKeyOrder(map[string]any{"y": i}, []string{"y"})
	}
	total := 0
	for i := range keyOrderShards {
		shard := &keyOrderShards[i]
		shard.mu.RLock()
		total += len(shard.entries)
		shard.mu.RUnlock()
	}
	if total >= 200_000 {
		t.Errorf("registry holds %d entries after 200000 registrations of short-lived maps; collected maps were never dropped", total)
	}
}

func TestKeyOrderConcurrentUse(t *testing.T) {
	shared := map[string]any{"b": 1, "a": 2}
	SetMapKeyOrder(shared, []string{"b", "a"})
	var wg sync.WaitGroup
	for g := range 8 {
		wg.Go(func() {
			for i := range 2_000 {
				own := map[string]any{"k": i, "j": g}
				SetMapKeyOrder(own, []string{"k", "j"})
				if got := OrderedKeys(own); !slices.Equal(got, []string{"k", "j"}) {
					t.Errorf("goroutine %d: OrderedKeys(own) = %v", g, got)
					return
				}
				if got := OrderedKeys(shared); !slices.Equal(got, []string{"b", "a"}) {
					t.Errorf("goroutine %d: OrderedKeys(shared) = %v", g, got)
					return
				}
			}
		})
	}
	wg.Wait()
}

func BenchmarkSetMapKeyOrder(b *testing.B) {
	keys := []string{"id", "component", "text", "variant"}
	b.ReportAllocs()
	for i := 0; b.Loop(); i++ {
		SetMapKeyOrder(map[string]any{"id": i, "component": "Text", "text": "x", "variant": "body"}, keys)
	}
}

func BenchmarkOrderedKeys(b *testing.B) {
	maps := make([]map[string]any, 1024)
	for i := range maps {
		maps[i] = map[string]any{"id": i, "component": "Text", "text": "x", "variant": "body"}
		SetMapKeyOrder(maps[i], []string{"id", "component", "text", "variant"})
	}
	b.ReportAllocs()
	for i := 0; b.Loop(); i++ {
		_ = OrderedKeys(maps[i%len(maps)])
	}
}

func BenchmarkSetMapKeyOrderParallel(b *testing.B) {
	keys := []string{"id", "component", "text", "variant"}
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			m := map[string]any{"id": i, "component": "Text", "text": fmt.Sprint(i), "variant": "body"}
			SetMapKeyOrder(m, keys)
			_ = OrderedKeys(m)
			i++
		}
	})
}
