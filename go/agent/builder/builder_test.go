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
	"fmt"
	"math"
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

func TestFlattenComponentForestCollisionPrevention(t *testing.T) {
	// Explicit root IDs stay unchanged.
	explicitForest, err := builder.FlattenComponentForest([]builder.Node{
		v1.NewText(v1.Str("Header")).WithID("header_text"),
		v1.NewDivider().WithID("divider_0"),
		v1.NewText(v1.Str("Body")).WithID("body_text"),
	}, "")
	if err != nil {
		t.Fatalf("explicit FlattenComponentForest failed: %v", err)
	}
	gotExplicitIDs := []string{
		explicitForest[0]["id"].(string),
		explicitForest[1]["id"].(string),
		explicitForest[2]["id"].(string),
	}
	if !reflect.DeepEqual(gotExplicitIDs, []string{"header_text", "divider_0", "body_text"}) {
		t.Fatalf("got explicit forest IDs %v", gotExplicitIDs)
	}

	// Duplicate explicit IDs across the forest are rejected.
	_, err = builder.FlattenComponentForest([]builder.Node{
		v1.NewText(v1.Str("A")).WithID("dup_id"),
		v1.NewText(v1.Str("B")).WithID("dup_id"),
	}, "")
	var valErr *core.ValidationError
	if !errors.As(err, &valErr) {
		t.Fatalf("expected *core.ValidationError for duplicate explicit forest IDs, got %v", err)
	}

	// Multiple unnamed roots allocate distinct IDs instead of colliding on "root__text_1".
	unnamedRoots, err := builder.FlattenComponentForest([]builder.Node{
		v1.NewText(v1.Str("a")),
		v1.NewText(v1.Str("b")),
	}, "")
	if err != nil {
		t.Fatalf("unnamed roots FlattenComponentForest failed: %v", err)
	}
	if unnamedRoots[0]["id"] != "root__text_1" || unnamedRoots[1]["id"] != "root__text_2" {
		t.Fatalf("unexpected unnamed root IDs: %v, %v", unnamedRoots[0]["id"], unnamedRoots[1]["id"])
	}

	// Unnamed roots with same-typed unnamed descendants never collide across trees.
	nestedForest, err := builder.FlattenComponentForest([]builder.Node{
		v1.NewCard(v1.NewText(v1.Str("a"))),
		v1.NewRow(v1.Children(v1.NewText(v1.Str("b")))),
	}, "")
	if err != nil {
		t.Fatalf("nested unnamed FlattenComponentForest failed: %v", err)
	}
	gotNestedIDs := make([]string, len(nestedForest))
	for i, c := range nestedForest {
		gotNestedIDs[i] = c["id"].(string)
	}
	wantNestedIDs := []string{"root__text_1", "root__card_1", "root__text_2", "root__row_1"}
	if !reflect.DeepEqual(gotNestedIDs, wantNestedIDs) {
		t.Fatalf("got nested forest IDs %v, want %v", gotNestedIDs, wantNestedIDs)
	}
}

type ptrEnvelopeCarrierNode struct {
	ID    string `json:"-"`
	Title string `json:"title"`
}

func (n ptrEnvelopeCarrierNode) ComponentType() string { return "PtrCarrier" }
func (n ptrEnvelopeCarrierNode) ComponentID() string   { return n.ID }
func (ptrEnvelopeCarrierNode) BuilderVersionFamily() builder.VersionFamily {
	return builder.VersionFamily1_0
}

func (n *ptrEnvelopeCarrierNode) SerializeEnvelopeAttributes(_ *builder.FlattenContext, dst map[string]any, defaultCID string) error {
	if defaultCID != "" {
		dst["@catalogId"] = defaultCID
	}
	dst["@metadata"] = map[string]any{"extensions": map[string]any{"fromPtr": true}}
	return nil
}

func (ptrEnvelopeCarrierNode) DefaultCatalogID() string {
	return "https://example.com/ptr_carrier.json"
}

type standaloneCatalogProviderV1 struct {
	Label string `json:"label"`
}

func (standaloneCatalogProviderV1) ComponentType() string { return "StandaloneWidget" }
func (standaloneCatalogProviderV1) ComponentID() string   { return "" }
func (standaloneCatalogProviderV1) BuilderVersionFamily() builder.VersionFamily {
	return builder.VersionFamily1_0
}
func (standaloneCatalogProviderV1) DefaultCatalogID() string {
	return "https://example.com/standalone/v1.json"
}

type standaloneCatalogProviderV09 struct {
	Label string `json:"label"`
}

func (standaloneCatalogProviderV09) ComponentType() string { return "StandaloneV09" }
func (standaloneCatalogProviderV09) ComponentID() string   { return "" }
func (standaloneCatalogProviderV09) BuilderVersionFamily() builder.VersionFamily {
	return builder.VersionFamily0_9
}
func (standaloneCatalogProviderV09) DefaultCatalogID() string {
	return "https://example.com/standalone/v09.json"
}

type FallbackNamedStruct struct {
	v1.ComponentNode
	Caption string `json:"caption"`
}

func TestValueTypeNodesAndDefaultCatalogIDProviders(t *testing.T) {
	// Value-type custom component embedding v1.ComponentNode works as a builder.Node directly.
	valMetric := metricCard{
		Label: "Memory",
		Value: v1.Str("64%"),
	}
	valMetric.ID = "mem_1"
	flatVal, err := builder.FlattenComponentTree(valMetric, "")
	if err != nil {
		t.Fatalf("value-type metricCard flatten failed: %v", err)
	}
	if flatVal[0]["id"] != "mem_1" || flatVal[0]["@catalogId"] != "https://example.com/catalogs/metrics/v1/catalog.json" {
		t.Fatalf("unexpected value-type metricCard output: %#v", flatVal[0])
	}

	// Pointer-receiver EnvelopeAttributeCarrier on a value-type Node is invoked via addressable copy.
	flatPtrCarrier, err := builder.FlattenComponentTree(ptrEnvelopeCarrierNode{ID: "pc1", Title: "Hello"}, "")
	if err != nil {
		t.Fatalf("ptrEnvelopeCarrierNode value flatten failed: %v", err)
	}
	if flatPtrCarrier[0]["@catalogId"] != "https://example.com/ptr_carrier.json" {
		t.Fatalf("missing @catalogId from pointer-receiver carrier: %#v", flatPtrCarrier[0])
	}
	if !reflect.DeepEqual(flatPtrCarrier[0]["@metadata"], map[string]any{"extensions": map[string]any{"fromPtr": true}}) {
		t.Fatalf("missing @metadata from pointer-receiver carrier: %#v", flatPtrCarrier[0])
	}

	// Standalone DefaultCatalogIDProvider without EnvelopeAttributeCarrier emits @catalogId in v1.0, not v0.9.
	flatStandaloneV1, err := builder.FlattenComponentTree(standaloneCatalogProviderV1{Label: "ok"}, "sw1")
	if err != nil {
		t.Fatalf("standalone v1 provider failed: %v", err)
	}
	if flatStandaloneV1[0]["@catalogId"] != "https://example.com/standalone/v1.json" {
		t.Fatalf("expected standalone @catalogId, got %#v", flatStandaloneV1[0])
	}

	flatStandaloneV09, err := builder.FlattenComponentTree(standaloneCatalogProviderV09{Label: "ok"}, "sw09")
	if err != nil {
		t.Fatalf("standalone v09 provider failed: %v", err)
	}
	if _, hasAtCID := flatStandaloneV09[0]["@catalogId"]; hasAtCID {
		t.Fatalf("v0.9 standalone provider must not emit @catalogId: %#v", flatStandaloneV09[0])
	}

	// Custom struct without ComponentType() override resolves struct type name as both root and child.
	parent := v1.NewCard(&FallbackNamedStruct{Caption: "leaf"}).WithID("root")
	flatFallback, err := builder.FlattenComponentTree(parent, "")
	if err != nil {
		t.Fatalf("FallbackNamedStruct child flatten failed: %v", err)
	}
	if flatFallback[0]["component"] != "FallbackNamedStruct" || flatFallback[0]["id"] != "root__fallbacknamedstruct_1" {
		t.Fatalf("unexpected fallback component type/id: %#v", flatFallback[0])
	}
}

type nodeSliceContainer struct {
	v1.ComponentNode
	Items []builder.Node `json:"items"`
}

func (nodeSliceContainer) ComponentType() string { return "NodeSliceContainer" }

func TestTypedNilSafetyAndChildNodeSlices(t *testing.T) {
	var nilTree *builder.ComponentTree
	if _, err := nilTree.Flatten(); err == nil {
		t.Fatal("expected nil *ComponentTree.Flatten() to return error")
	}
	if _, err := nilTree.MarshalJSON(); err == nil {
		t.Fatal("expected nil *ComponentTree.MarshalJSON() to return error")
	}

	typedNilRoot := (*v1.Text)(nil)
	if _, err := builder.NewComponentTree(typedNilRoot, "s1").Flatten(); err == nil {
		t.Fatal("expected ComponentTree with typed-nil Root to return error")
	}

	var nilV1Str *v1.StringLiteral
	var nilV09Str *v09.StringLiteral
	var nilV1Num *v1.IntLiteral
	var nilV1Func *v1.FunctionCall

	requiredFailures := []builder.Node{
		v1.NewText(nilV1Str),
		v09.NewText(nilV09Str),
		v1.NewCard(typedNilRoot),
		v1.NewSlider(10, nilV1Num),
		v1.NewTextField(v1.Str("Lbl"), v1.Str("Val")).WithChecks(v1.NewCheckRule(nilV1Func, "bad")),
		v1.NewTabs(v1.NewTabItem(nilV1Str, v1.NewText(v1.Str("ok")))),
	}
	for i, n := range requiredFailures {
		_, err := builder.FlattenComponentTree(n, "root")
		var valErr *core.ValidationError
		if !errors.As(err, &valErr) {
			t.Fatalf("case %d: expected *core.ValidationError on typed-nil required field, got %v", i, err)
		}
	}

	// Typed-nil optional fields are cleanly omitted without panicking or emitting null.
	var nilStrPtr *string
	dtV1 := v1.NewDateTimeInput(v1.Str("2026-05-01")).
		WithMin(nilStrPtr).
		WithMax(nilV1Str).
		WithLabel(nilV1Str).
		WithAccessibility(v1.AccessibilityAttributes{Label: nilV1Str, Description: v1.Str("Date")})
	flatDT, err := dtV1.Flatten("dt")
	if err != nil {
		t.Fatalf("DateTimeInput with typed-nil optional fields failed: %v", err)
	}
	if _, hasMin := flatDT[0]["min"]; hasMin {
		t.Fatalf("expected typed-nil Min to be omitted, got %#v", flatDT[0])
	}
	if _, hasMax := flatDT[0]["max"]; hasMax {
		t.Fatalf("expected typed-nil Max to be omitted, got %#v", flatDT[0])
	}
	if _, hasLbl := flatDT[0]["label"]; hasLbl {
		t.Fatalf("expected typed-nil Label to be omitted, got %#v", flatDT[0])
	}

	dtV09 := v09.NewDateTimeInput(v09.Str("2026-05-01")).WithMin(nilStrPtr).WithMax(nilV09Str)
	flatDTV09, err := dtV09.Flatten("dt09")
	if err != nil {
		t.Fatalf("v0.9 DateTimeInput with typed-nil optional fields failed: %v", err)
	}
	if _, hasMin := flatDTV09[0]["min"]; hasMin {
		t.Fatalf("expected v0.9 typed-nil Min to be omitted, got %#v", flatDTV09[0])
	}

	// []builder.Node containing nil or typed-nil child fails validation rather than emitting null.
	badSlice := &nodeSliceContainer{Items: []builder.Node{v1.NewText(v1.Str("ok")), nil}}
	if _, err := builder.FlattenComponentTree(badSlice, "root"); err == nil {
		t.Fatal("expected nil element in []builder.Node to fail validation")
	}
	badTypedNilSlice := &nodeSliceContainer{Items: []builder.Node{typedNilRoot}}
	if _, err := builder.FlattenComponentTree(badTypedNilSlice, "root"); err == nil {
		t.Fatal("expected typed-nil element in []builder.Node to fail validation")
	}
}

type cyclicEmbeddedStruct struct {
	*cyclicEmbeddedStruct
	Label string `json:"label"`
}

type innerShadowBase struct {
	Title string `json:"title"`
}

type outerShadowOmitEmpty struct {
	v1.ComponentNode
	innerShadowBase
	Title       string               `json:"title,omitempty"`
	LiteralDash string               `json:"-,"`
	Skipped     string               `json:"-"`
	Cyclic      cyclicEmbeddedStruct `json:"cyclic"`
	ZeroArr     [2]int               `json:"zeroArr,omitempty"`
	EmptyArr    [0]int               `json:"emptyArr,omitempty"`
}

func (outerShadowOmitEmpty) ComponentType() string { return "OuterShadow" }

type tieUntaggedMixin struct {
	Shared string
}

type tieTaggedMixin struct {
	Other string `json:"shared"`
}

type tieResolvedNode struct {
	v1.ComponentNode
	tieUntaggedMixin
	tieTaggedMixin
}

func (tieResolvedNode) ComponentType() string { return "TieResolved" }

type jsonMarshalerBox struct {
	Code int
}

func (b jsonMarshalerBox) MarshalJSON() ([]byte, error) {
	return []byte(fmt.Sprintf(`{"code":%d}`, b.Code)), nil
}

type textMarshalerTag struct {
	Tag string
}

func (t *textMarshalerTag) MarshalText() ([]byte, error) {
	return []byte("tag:" + t.Tag), nil
}

type ptrReceiverEnum string

func (*ptrReceiverEnum) EnumValues() []string { return []string{"alpha", "beta"} }

type marshalerAndEnumNode struct {
	v1.ComponentNode
	Box    jsonMarshalerBox  `json:"box"`
	NilBox *jsonMarshalerBox `json:"nilBox,omitempty"`
	Tag    textMarshalerTag  `json:"tag"`
	NilTag *textMarshalerTag `json:"nilTag,omitempty"`
	Mode   ptrReceiverEnum   `json:"mode"`
}

func (marshalerAndEnumNode) ComponentType() string { return "MarshalerNode" }

type selfRefStruct struct {
	Next *selfRefStruct `json:"next"`
}

func TestComponentRefReservationMarshalersEnumsArraysCyclesAndFloats(t *testing.T) {
	// ComponentRef reserves its ID in Pass 1 so Pass 2 auto-allocation skips it.
	colWithRef := v1.NewColumn(v1.Children(
		v1.NewText(v1.Str("Auto text")),
		builder.NewComponentRef("root__text_1"),
	)).WithID("root")
	flatRef, err := builder.FlattenComponentTree(colWithRef, "")
	if err != nil {
		t.Fatalf("FlattenComponentTree with ComponentRef failed: %v", err)
	}
	if flatRef[0]["id"] != "root__text_2" {
		t.Fatalf("expected auto-allocated Text to skip reserved ComponentRef ID 'root__text_1', got %v", flatRef[0]["id"])
	}

	// BFS typeFields: cyclic embedded pointer, json:"-," vs json:"-", omitempty dominance, and [N]T omitempty.
	shadow := &outerShadowOmitEmpty{
		innerShadowBase: innerShadowBase{Title: "inner-must-not-leak"},
		Title:           "",
		LiteralDash:     "dash-val",
		Skipped:         "hidden",
		Cyclic:          cyclicEmbeddedStruct{Label: "leaf"},
	}
	flatShadow, err := builder.FlattenComponentTree(shadow, "sh1")
	if err != nil {
		t.Fatalf("outerShadowOmitEmpty flatten failed: %v", err)
	}
	gotShadow := flatShadow[0]
	if _, leaked := gotShadow["title"]; leaked {
		t.Fatalf("shadowed inner Title leaked despite outer omitempty field: %#v", gotShadow)
	}
	if gotShadow["-"] != "dash-val" {
		t.Fatalf("expected json:\"-,'\" to emit under key \"-\", got %#v", gotShadow)
	}
	if _, hasSkipped := gotShadow["skipped"]; hasSkipped {
		t.Fatalf("expected json:\"-\" field to be skipped: %#v", gotShadow)
	}
	if !reflect.DeepEqual(gotShadow["cyclic"], map[string]any{"label": "leaf"}) {
		t.Fatalf("unexpected cyclic embedded struct output: %#v", gotShadow["cyclic"])
	}
	if !reflect.DeepEqual(gotShadow["zeroArr"], []any{int64(0), int64(0)}) {
		t.Fatalf("expected non-zero-length [2]int with omitempty to be preserved, got %#v", gotShadow["zeroArr"])
	}
	if _, hasEmptyArr := gotShadow["emptyArr"]; hasEmptyArr {
		t.Fatalf("expected [0]int with omitempty to be omitted, got %#v", gotShadow)
	}

	// Same-depth tie breaking favors explicitly JSON-tagged field.
	tie := &tieResolvedNode{
		tieUntaggedMixin: tieUntaggedMixin{Shared: "untagged"},
		tieTaggedMixin:   tieTaggedMixin{Other: "tagged-wins"},
	}
	flatTie, err := builder.FlattenComponentTree(tie, "tie1")
	if err != nil {
		t.Fatalf("tieResolvedNode flatten failed: %v", err)
	}
	if flatTie[0]["shared"] != "tagged-wins" {
		t.Fatalf("expected tagged field to win same-depth tie, got %#v", flatTie[0])
	}

	// json.Marshaler, encoding.TextMarshaler, and pointer-receiver StringEnum.
	mNode := &marshalerAndEnumNode{
		Box:  jsonMarshalerBox{Code: 200},
		Tag:  textMarshalerTag{Tag: "v1"},
		Mode: "alpha",
	}
	flatM, err := builder.FlattenComponentTree(mNode, "m1")
	if err != nil {
		t.Fatalf("marshalerAndEnumNode flatten failed: %v", err)
	}
	if !reflect.DeepEqual(flatM[0]["box"], map[string]any{"code": int64(200)}) || flatM[0]["tag"] != "tag:v1" || flatM[0]["mode"] != "alpha" {
		t.Fatalf("unexpected marshaler/enum output: %#v", flatM[0])
	}
	badEnumNode := &marshalerAndEnumNode{Tag: textMarshalerTag{Tag: "x"}, Mode: "gamma"}
	if _, err := builder.FlattenComponentTree(badEnumNode, "m2"); err == nil {
		t.Fatal("expected invalid pointer-receiver StringEnum to fail strict validation")
	}
	if _, err := builder.FlattenComponentTreeWithOptions(badEnumNode, "m2", builder.FlattenOptions{AllowOpenEnums: true}); err != nil {
		t.Fatalf("expected AllowOpenEnums to permit unknown pointer-receiver StringEnum, got %v", err)
	}

	// Cyclic pointer, map, and slice values return *core.RecursionError.
	cycPtr := &selfRefStruct{}
	cycPtr.Next = cycPtr
	var recErr *core.RecursionError
	if _, err := (&builder.FlattenContext{}).SerializeValue(cycPtr); !errors.As(err, &recErr) {
		t.Fatalf("expected *core.RecursionError for cyclic struct pointer, got %v", err)
	}
	cycMap := map[string]any{}
	cycMap["self"] = cycMap
	if _, err := (&builder.FlattenContext{}).SerializeValue(cycMap); !errors.As(err, &recErr) {
		t.Fatalf("expected *core.RecursionError for cyclic map, got %v", err)
	}
	cycSlice := []any{nil}
	cycSlice[0] = cycSlice
	if _, err := (&builder.FlattenContext{}).SerializeValue(cycSlice); !errors.As(err, &recErr) {
		t.Fatalf("expected *core.RecursionError for cyclic slice, got %v", err)
	}

	// NaN and Inf floats are rejected with *core.ValidationError.
	var valErr *core.ValidationError
	for _, badFloat := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := (&builder.FlattenContext{}).SerializeValue(badFloat); !errors.As(err, &valErr) {
			t.Fatalf("expected *core.ValidationError for SerializeValue(%v), got %v", badFloat, err)
		}
		if _, err := builder.FlattenComponentTree(v1.NewSlider(10, v1.Num(badFloat)), "s"); !errors.As(err, &valErr) {
			t.Fatalf("expected *core.ValidationError for v1.Num(%v), got %v", badFloat, err)
		}
		if _, err := builder.FlattenComponentTree(v09.NewSlider(10, v09.Num(badFloat)), "s"); !errors.As(err, &valErr) {
			t.Fatalf("expected *core.ValidationError for v09.Num(%v), got %v", badFloat, err)
		}
		if _, err := builder.FlattenComponentTree(v1.NewSlider(badFloat, v1.Num(1)), "s"); !errors.As(err, &valErr) {
			t.Fatalf("expected *core.ValidationError for Slider.Max=%v, got %v", badFloat, err)
		}
		if _, err := builder.FlattenComponentTree(v1.NewText(v1.Str("hi")).WithWeight(badFloat), "t"); !errors.As(err, &valErr) {
			t.Fatalf("expected *core.ValidationError for Weight=%v, got %v", badFloat, err)
		}
	}

	// Explicit nil FunctionCall args are preserved, while typed-nil option helpers omit unset entries.
	reqV1, err := v1.Required(nil).SerializeBuilderValue(&builder.FlattenContext{})
	if err != nil {
		t.Fatalf("v1.Required(nil) failed: %v", err)
	}
	wantReqV1 := map[string]any{"@call": "required", "args": map[string]any{"value": nil}}
	if !reflect.DeepEqual(reqV1, wantReqV1) {
		t.Fatalf("v1.Required(nil) = %#v, want %#v", reqV1, wantReqV1)
	}
	reqV09, err := v09.Required(nil).SerializeBuilderValue(&builder.FlattenContext{})
	if err != nil {
		t.Fatalf("v09.Required(nil) failed: %v", err)
	}
	wantReqV09 := map[string]any{"call": "required", "args": map[string]any{"value": nil}}
	if !reflect.DeepEqual(reqV09, wantReqV09) {
		t.Fatalf("v09.Required(nil) = %#v, want %#v", reqV09, wantReqV09)
	}

	var nilDec *v1.IntLiteral
	var nilGrp *v1.BoolLiteral
	fnOpt, err := v1.FormatNumber(v1.Num(12.5), v1.WithDecimals(nilDec), v1.WithGrouping(nilGrp)).SerializeBuilderValue(&builder.FlattenContext{})
	if err != nil {
		t.Fatalf("FormatNumber with typed-nil options failed: %v", err)
	}
	wantFnOpt := map[string]any{"@call": "formatNumber", "args": map[string]any{"value": 12.5}}
	if !reflect.DeepEqual(fnOpt, wantFnOpt) {
		t.Fatalf("FormatNumber with typed-nil options = %#v, want %#v", fnOpt, wantFnOpt)
	}
}
