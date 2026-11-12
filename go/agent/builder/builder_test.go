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

package builder_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/a2ui-project/a2ui/go/agent/builder"
	v09 "github.com/a2ui-project/a2ui/go/agent/builder/v09"
	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
	"github.com/a2ui-project/a2ui/go/core"
)

type customCatalogBase struct {
	v1.ComponentNode
}

func (customCatalogBase) DefaultCatalogID() string {
	return "https://example.com/catalogs/metrics/v1/catalog.json"
}

type metricCard struct {
	customCatalogBase
	Label string           `json:"label"`
	Value v1.DynamicString `json:"value"`
	Icon  builder.Node     `json:"icon,omitempty"`
}

func (metricCard) ComponentType() string { return "MetricCard" }

func TestIDCollisionPreventionAndSharedDAGNodes(t *testing.T) {
	tree := v1.NewColumn(v1.Children(
		v1.NewText(v1.Str("Auto-allocated first")),
		v1.NewText(v1.Str("Explicit text_1")).WithID("text_1"),
	)).WithID("root")

	comps, err := builder.FlattenComponentTree(tree, "")
	if err != nil {
		t.Fatalf("FlattenComponentTree failed: %v", err)
	}
	if len(comps) != 3 {
		t.Fatalf("expected 3 components, got %d", len(comps))
	}
	ids := []string{comps[0]["id"].(string), comps[1]["id"].(string), comps[2]["id"].(string)}
	wantIDs := []string{"root__text_2", "root__text_1", "root"}
	if !reflect.DeepEqual(ids, wantIDs) {
		t.Fatalf("got IDs %v, want %v", ids, wantIDs)
	}

	shared := v1.NewText(v1.Str("Reused")).WithID("shared")
	sharedCol := v1.NewColumn(v1.Children(shared, shared)).WithID("wrapper")
	sharedComps, err := builder.FlattenComponentTree(sharedCol, "")
	if err != nil {
		t.Fatalf("shared FlattenComponentTree failed: %v", err)
	}
	if len(sharedComps) != 2 {
		t.Fatalf("expected shared child to emit once (2 components total), got %d", len(sharedComps))
	}
	if !reflect.DeepEqual(sharedComps[1]["children"], []any{"wrapper__shared", "wrapper__shared"}) {
		t.Fatalf("unexpected children slice: %#v", sharedComps[1]["children"])
	}
}

func TestCycleAndDuplicateExplicitIDDetection(t *testing.T) {
	cardA := v1.NewCard(nil).WithID("a")
	cardB := v1.NewCard(cardA).WithID("b")
	cardA.Child = cardB

	_, err := builder.FlattenComponentTree(cardA, "")
	var recErr *core.RecursionError
	if !errors.As(err, &recErr) {
		t.Fatalf("expected *core.RecursionError on cyclic builder graph, got %v", err)
	}

	dupCol := v1.NewColumn(v1.Children(
		v1.NewText(v1.Str("First")).WithID("dup"),
		v1.NewText(v1.Str("Second")).WithID("dup"),
	)).WithID("root")
	_, err = builder.FlattenComponentTree(dupCol, "")
	var valErr *core.ValidationError
	if !errors.As(err, &valErr) {
		t.Fatalf("expected *core.ValidationError on duplicate explicit IDs, got %v", err)
	}
}

func TestStrictVsLenientEnumsAndActionExclusivity(t *testing.T) {
	badVariant := v1.NewText(v1.Str("Hi")).WithVariant(v1.TextVariant("futureVariant"))
	if _, err := builder.FlattenComponentTree(badVariant, ""); err == nil {
		t.Fatal("expected strict authoring flatten to reject unknown enum variant")
	}
	lenientComps, err := builder.FlattenComponentTreeWithOptions(badVariant, "t1", builder.FlattenOptions{
		AllowOpenEnums: true,
	})
	if err != nil {
		t.Fatalf("expected AllowOpenEnums flatten to succeed, got %v", err)
	}
	if lenientComps[0]["variant"] != "futureVariant" {
		t.Fatalf("expected futureVariant preserved, got %v", lenientComps[0]["variant"])
	}

	if err := (v1.Action{}).Validate(); err == nil {
		t.Fatal("expected empty Action to fail validation")
	}
	ev := v1.ActionEvent{Name: "save"}
	fc := v1.OpenURL(v1.Str("https://a2ui.org"))
	if err := (v1.Action{Event: &ev, FunctionCall: &fc}).Validate(); err == nil {
		t.Fatal("expected dual-branch Action to fail validation")
	}
}

func TestAllBasicComponentsFunctionsCustomNodesAndExtensions(t *testing.T) {
	// Exercise all 18 Basic Catalog components and all 14 function builders across v1 and v09.
	allFnsV1 := []v1.FunctionCall{
		v1.Required(v1.Bind("/req")),
		v1.Regex(v1.Bind("/zip"), "^[0-9]{5}$"),
		v1.Length(v1.Bind("/bio"), v1.WithRangeMin(3), v1.WithRangeMax(100)),
		v1.Numeric(v1.Bind("/age"), v1.WithRangeMin(0), v1.WithRangeMax(120)),
		v1.Email(v1.Bind("/email")),
		v1.FormatString(v1.Str("Hello ${/name}")),
		v1.FormatNumber(v1.Num(1234.5), v1.WithDecimals(v1.Int(2)), v1.WithGrouping(v1.Bool(true))),
		v1.FormatCurrency(v1.Num(99.95), v1.Str("USD"), v1.WithDecimals(v1.Int(2))),
		v1.FormatDate(v1.Bind("/ts"), v1.Str("yyyy-MM-dd")),
		v1.Pluralize(v1.Int(2), v1.Str("items"), v1.WithPluralOne(v1.Str("item"))),
		v1.OpenURL(v1.Str("https://a2ui.org")),
		v1.And(v1.Bool(true), v1.Bind("/ok")),
		v1.Or(v1.Bool(false), v1.Bind("/alt")),
		v1.Not(v1.Bool(false)),
	}
	if len(allFnsV1) != 14 {
		t.Fatalf("expected 14 v1 functions, got %d", len(allFnsV1))
	}

	allFnsV09 := []v09.FunctionCall{
		v09.Required(v09.Bind("/req")),
		v09.Regex(v09.Bind("/zip"), "^[0-9]{5}$"),
		v09.Length(v09.Bind("/bio"), v09.WithRangeMin(3), v09.WithRangeMax(100)),
		v09.Numeric(v09.Bind("/age"), v09.WithRangeMin(0), v09.WithRangeMax(120)),
		v09.Email(v09.Bind("/email")),
		v09.FormatString(v09.Str("Hello ${/name}")),
		v09.FormatNumber(v09.Num(1234.5), v09.WithDecimals(v09.Int(2)), v09.WithGrouping(v09.Bool(true))),
		v09.FormatCurrency(v09.Num(99.95), v09.Str("USD")),
		v09.FormatDate(v09.Bind("/ts"), v09.Str("yyyy-MM-dd")),
		v09.Pluralize(v09.Int(2), v09.Str("items"), v09.WithPluralOne(v09.Str("item"))),
		v09.OpenURL("https://a2ui.org"),
		v09.And(v09.Bool(true), v09.Bind("/ok")),
		v09.Or(v09.Bool(false), v09.Bind("/alt")),
		v09.Not(v09.Bool(false)),
	}
	if len(allFnsV09) != 14 {
		t.Fatalf("expected 14 v09 functions, got %d", len(allFnsV09))
	}

	custom := &metricCard{
		Label: "Latency",
		Value: v1.FormatNumber(v1.Num(12.3)),
		Icon:  v1.NewIcon(v1.NewIconNameSVGPath(v1.Str("M0 0 L10 10"))),
	}
	custom.ID = "lat_card"
	if err := custom.SetExtension("telemetry", map[string]any{"unit": "ms"}); err != nil {
		t.Fatalf("SetExtension failed: %v", err)
	}

	dashboard := v1.NewCard(
		v1.NewColumn(v1.Children(
			v1.NewText(v1.Str("Overview")).WithWeight(1),
			v1.NewImage(v1.Str("https://example.com/banner.png")).WithDescription(v1.Str("Banner")),
			v1.NewVideo(v1.Str("https://example.com/demo.mp4")).WithPosterURL(v1.Str("https://example.com/poster.png")),
			v1.NewAudioPlayer(v1.Str("https://example.com/clip.mp3")),
			v1.NewDivider(),
			v1.NewRow(v1.Children(
				v1.NewCheckBox(v1.Str("Agree"), v1.Bool(true)),
				v1.NewSlider(100, v1.Num(50)).WithSteps(5),
				v1.NewDateTimeInput(v1.Str("2026-01-01")).WithEnableDate(true),
			)),
			v1.NewChoicePicker(
				[]v1.ChoicePickerOption{v1.NewChoicePickerOption(v1.Str("One"), "1")},
				v1.Strs("1"),
			),
			v1.NewTabs(v1.NewTabItem(v1.Str("Metrics"), custom)),
			v1.NewModal(
				v1.NewButton(v1.NewText(v1.Str("Open")), v1.EventAction("open_modal", nil)),
				v1.NewList(v1.Children(
					v1.NewTextField(v1.Str("Email"), v1.Bind("/email")).
						WithPlaceholder(v1.Str("you@example.com")).
						WithChecks(v1.NewCheckRule(v1.Email(v1.Bind("/email")), "Invalid email")),
				)),
			),
		)),
	).WithID("root")

	flat, err := dashboard.Flatten("")
	if err != nil {
		t.Fatalf("dashboard.Flatten failed: %v", err)
	}
	if len(flat) < 15 {
		t.Fatalf("expected >= 15 flattened components, got %d", len(flat))
	}

	// Verify custom node inherited DefaultCatalogID and serialized metadata.extensions.
	var foundMetric map[string]any
	for _, comp := range flat {
		if comp["component"] == "MetricCard" {
			foundMetric = comp
			break
		}
	}
	if foundMetric == nil {
		t.Fatal("MetricCard not found in flattened output")
	}
	if foundMetric["@catalogId"] != "https://example.com/catalogs/metrics/v1/catalog.json" {
		t.Fatalf("unexpected MetricCard @catalogId: %v", foundMetric["@catalogId"])
	}
	wantMeta := map[string]any{"extensions": map[string]any{"telemetry": map[string]any{"unit": "ms"}}}
	if !reflect.DeepEqual(foundMetric["@metadata"], wantMeta) {
		t.Fatalf("unexpected MetricCard @metadata: %#v", foundMetric["@metadata"])
	}

	// Verify SetSurfaceExtensions validates UAX #31 keys and updates matching createSurface.
	createMsg, err := v1.CreateSurface(v1.CreateSurfaceOptions{
		SurfaceID:  "s1",
		CatalogID:  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
		Components: flat,
	})
	if err != nil {
		t.Fatalf("CreateSurface failed: %v", err)
	}
	updated, err := v1.SetSurfaceExtensions(
		[]core.AgentToRendererMessage{createMsg},
		"s1",
		v1.Extensions{"surfaceTheme": map[string]any{"mode": "dark"}},
	)
	if err != nil {
		t.Fatalf("SetSurfaceExtensions failed: %v", err)
	}
	cs := updated[0]["createSurface"].(map[string]any)
	meta := cs["metadata"].(map[string]any)
	if !reflect.DeepEqual(meta["extensions"], map[string]any{"surfaceTheme": map[string]any{"mode": "dark"}}) {
		t.Fatalf("unexpected surface extensions: %#v", meta)
	}

	if _, err := v1.SetSurfaceExtensions(updated, "s1", v1.Extensions{"bad-key!": 1}); err == nil {
		t.Fatal("expected invalid UAX #31 extension key to fail")
	}
}

func TestComponentTreeMarshalJSON(t *testing.T) {
	tree := builder.NewComponentTree(v1.NewCard(v1.NewText(v1.Str("Hi"))), "main")
	raw, err := json.Marshal(tree)
	if err != nil {
		t.Fatalf("json.Marshal(ComponentTree) failed: %v", err)
	}
	want := `[{"component":"Text","id":"root__text_1","text":"Hi","variant":"body"},{"child":"root__text_1","component":"Card","id":"root"}]`
	if string(raw) != want {
		t.Fatalf("unexpected ComponentTree JSON:\n got: %s\nwant: %s", raw, want)
	}
}

type embeddedAxisMixin struct {
	XAxis string `json:"xAxis"`
	Title string `json:"title"`
}

type EmbeddedLegendMixin struct {
	ShowLegend bool `json:"showLegend"`
}

type nestedChartConfig struct {
	embeddedAxisMixin
	*EmbeddedLegendMixin
	TaggedEmbed EmbeddedLegendMixin `json:"taggedEmbed"`
	Title       string              `json:"title"`
}

type embeddedChartNode struct {
	customCatalogBase
	embeddedAxisMixin
	*EmbeddedLegendMixin
	NamedMixin EmbeddedLegendMixin `json:"namedMixin"`
	Title      string              `json:"title"`
	Config     nestedChartConfig   `json:"config"`
}

func (embeddedChartNode) ComponentType() string { return "EmbeddedChart" }

func TestAnonymousEmbeddedStructFlattening(t *testing.T) {
	legendTrue := &EmbeddedLegendMixin{ShowLegend: true}
	node := &embeddedChartNode{
		embeddedAxisMixin:   embeddedAxisMixin{XAxis: "time", Title: "inner-node-title"},
		EmbeddedLegendMixin: legendTrue,
		NamedMixin:          EmbeddedLegendMixin{ShowLegend: false},
		Title:               "outer-node-title",
		Config: nestedChartConfig{
			embeddedAxisMixin:   embeddedAxisMixin{XAxis: "latency", Title: "inner-cfg-title"},
			EmbeddedLegendMixin: nil, // nil embedded pointer should be omitted
			TaggedEmbed:         EmbeddedLegendMixin{ShowLegend: true},
			Title:               "outer-cfg-title",
		},
	}
	node.ID = "chart_1"

	flat, err := builder.FlattenComponentTree(node, "")
	if err != nil {
		t.Fatalf("FlattenComponentTree failed: %v", err)
	}
	if len(flat) != 1 {
		t.Fatalf("expected 1 component, got %d", len(flat))
	}
	got := flat[0]
	if got["xAxis"] != "time" || got["showLegend"] != true || got["title"] != "outer-node-title" {
		t.Fatalf("unexpected flattened custom node fields: %#v", got)
	}
	if _, hasRawMixinKey := got["embeddedAxisMixin"]; hasRawMixinKey {
		t.Fatalf("anonymous embeddedAxisMixin was not flattened: %#v", got)
	}
	if _, hasPtrMixinKey := got["embeddedLegendMixin"]; hasPtrMixinKey {
		t.Fatalf("anonymous EmbeddedLegendMixin pointer was not flattened: %#v", got)
	}
	wantNamed := map[string]any{"showLegend": false}
	if !reflect.DeepEqual(got["namedMixin"], wantNamed) {
		t.Fatalf("explicitly named field = %#v, want %#v", got["namedMixin"], wantNamed)
	}

	wantCfg := map[string]any{
		"xAxis":       "latency",
		"title":       "outer-cfg-title",
		"taggedEmbed": map[string]any{"showLegend": true},
	}
	if !reflect.DeepEqual(got["config"], wantCfg) {
		t.Fatalf("nested struct config = %#v, want %#v", got["config"], wantCfg)
	}
}
