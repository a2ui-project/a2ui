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

package agent

import (
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

// --- Scaling Conformance (agent/express/scaling.yaml) ---

func TestExpressScalingConformance(t *testing.T) {
	confRoot := expConfFindRoot(t)
	suite := "agent/express/scaling.yaml"
	caseNodes := expConfLoadYAMLSuiteNodes(t, confRoot, suite)
	if len(caseNodes) == 0 {
		t.Fatalf("no scaling cases loaded from %s", suite)
	}

	for _, caseNode := range caseNodes {
		caseName := expConfYAMLNodeCaseName(caseNode)
		t.Run(caseName, func(t *testing.T) {
			tc, _ := expConfDecodeYAMLNode(caseNode).(map[string]any)
			expConfAssertKnownKeys(t, tc, expConfMeasureGrowthCaseKeys, "scaling case")
			if tc["action"] != "measure_growth" {
				t.Fatalf("unsupported scaling action %v", tc["action"])
			}
			args, _ := tc["args"].(map[string]any)
			fmtInst, err := expConfMakeFormat(t, confRoot, args, true, false)
			if err != nil {
				t.Fatalf("expConfMakeFormat: %v", err)
			}

			if os.Getenv("A2UI_RUN_TIMING") != "1" {
				expConfManifest.record(suite, caseName, "default", "skipped", expConfScalingSkipMsg)
				t.Skip(expConfScalingSkipMsg)
			}

			var recorded bool
			defer func() {
				if !recorded {
					if t.Failed() {
						expConfManifest.record(suite, caseName, "default", "failed", "")
					} else {
						expConfManifest.record(suite, caseName, "default", "passed", "")
					}
				}
			}()

			sizesRaw, _ := tc["sizes"].([]any)
			if len(sizesRaw) != 2 {
				t.Fatalf("expected 2 sizes, got %v", sizesRaw)
			}
			sizeSmall := int(sizesRaw[0].(int64))
			sizeLarge := int(sizesRaw[1].(int64))
			_, maxRatio, _, _ := expConfAsNumber(tc["max_ratio"])
			template, _ := tc["payload"].([]any)

			payloadSmall := expConfExpandPayloadTemplate(template, sizeSmall)
			payloadLarge := expConfExpandPayloadTemplate(template, sizeLarge)

			runOnce := func(payload string) error {
				_, pErr := fmtInst.CreateParser().ParseResponse(payload, &ParseOptions{
					Unwrapped: true,
				})
				return pErr
			}

			// Warmup each size once before timing.
			if err := runOnce(payloadSmall); err != nil {
				t.Fatalf("warmup small failed: %v", err)
			}
			if err := runOnce(payloadLarge); err != nil {
				t.Fatalf("warmup large failed: %v", err)
			}

			const rounds = 7
			smallTimes := make([]time.Duration, rounds)
			largeTimes := make([]time.Duration, rounds)
			for r := range rounds {
				t0 := time.Now()
				if err := runOnce(payloadSmall); err != nil {
					t.Fatalf("timed small run failed: %v", err)
				}
				smallTimes[r] = time.Since(t0)

				t1 := time.Now()
				if err := runOnce(payloadLarge); err != nil {
					t.Fatalf("timed large run failed: %v", err)
				}
				largeTimes[r] = time.Since(t1)
			}
			slices.Sort(smallTimes)
			slices.Sort(largeTimes)
			medSmall := smallTimes[rounds/2]
			medLarge := largeTimes[rounds/2]
			if medSmall <= 0 {
				medSmall = 1
			}
			ratio := float64(medLarge) / float64(medSmall)
			if ratio > maxRatio {
				t.Fatalf("growth ratio %.2f (%v / %v) exceeded max_ratio %.2f", ratio, medLarge, medSmall, maxRatio)
			}
		})
	}
}

func expConfExpandPayloadTemplate(template []any, size int) string {
	var b strings.Builder
	for _, seg := range template {
		switch s := seg.(type) {
		case string:
			b.WriteString(s)
		case map[string]any:
			rep, _ := s["repeat"].(string)
			sep, _ := s["separator"].(string)
			for i := range size {
				if i > 0 {
					b.WriteString(sep)
				}
				b.WriteString(strings.ReplaceAll(rep, "{i}", strconv.Itoa(i)))
			}
		}
	}
	return b.String()
}
