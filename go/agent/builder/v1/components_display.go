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

package v1

import (
	"github.com/a2ui-project/a2ui/go/agent/builder"
	"github.com/a2ui-project/a2ui/go/core"
)

// IconNameSVGPath specifies a custom SVG path for an Icon component.
type IconNameSVGPath struct {
	SVGPath DynamicString `json:"svgPath"`
}

// NewIconNameSVGPath constructs a v1.0 IconNameSVGPath.
func NewIconNameSVGPath(svgPath DynamicString) IconNameSVGPath {
	return IconNameSVGPath{SVGPath: svgPath}
}

// BuilderVersionFamily returns VersionFamily1_0.
func (IconNameSVGPath) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue emits {"svgPath": ...}.
func (p IconNameSVGPath) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if builder.IsNilValue(p.SVGPath) {
		return nil, core.NewValidationError("IconNameSVGPath.SVGPath is required")
	}
	v, err := p.SVGPath.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"svgPath": v}, nil
}

func (IconNameSVGPath) isV1IconNameValue() {}

// Text builds a v1.0 Basic Catalog Text component.
type Text struct {
	ComponentNode
	Text    DynamicString
	Variant TextVariant
	Weight  *float64
}

// NewText constructs a v1.0 Text component.
func NewText(text DynamicString) *Text {
	return &Text{Text: text, Variant: TextVariantBody}
}

// ComponentType returns "Text".
func (*Text) ComponentType() string { return "Text" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Text) WithID(id string) *Text { c.ID = id; return c }

// WithCatalogID sets the component catalogId and returns c.
func (c *Text) WithCatalogID(id string) *Text { c.CatalogID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Text) WithAccessibility(a AccessibilityAttributes) *Text {
	c.Accessibility = &a
	return c
}

// WithExtensions sets the metadata.extensions entries and returns c.
func (c *Text) WithExtensions(ext Extensions) *Text { c.Extensions = ext; return c }

// WithVariant sets the variant property and returns c.
func (c *Text) WithVariant(v TextVariant) *Text { c.Variant = v; return c }

// WithWeight sets the weight property and returns c.
func (c *Text) WithWeight(w float64) *Text { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Text) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Text) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Text) {
		return nil, core.NewValidationError("Text.Text is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	tv, err := c.Text.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["text"] = tv
	variant := c.Variant
	if variant == "" {
		variant = TextVariantBody
	}
	if err := ctx.ValidateEnum("Text.variant", string(variant), variant); err != nil {
		return nil, err
	}
	out["variant"] = string(variant)
	if err := setWeight(out, "Text.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}

// Image builds a v1.0 Basic Catalog Image component.
type Image struct {
	ComponentNode
	URL         DynamicString
	Description DynamicString
	Fit         ImageFit
	Variant     ImageVariant
	Weight      *float64
}

// NewImage constructs a v1.0 Image component.
func NewImage(url DynamicString) *Image {
	return &Image{URL: url, Fit: ImageFitFill, Variant: ImageVariantMediumFeature}
}

// ComponentType returns "Image".
func (*Image) ComponentType() string { return "Image" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Image) WithID(id string) *Image { c.ID = id; return c }

// WithCatalogID sets the component catalogId and returns c.
func (c *Image) WithCatalogID(id string) *Image { c.CatalogID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Image) WithAccessibility(a AccessibilityAttributes) *Image {
	c.Accessibility = &a
	return c
}

// WithExtensions sets the metadata.extensions entries and returns c.
func (c *Image) WithExtensions(ext Extensions) *Image { c.Extensions = ext; return c }

// WithDescription sets the description property and returns c.
func (c *Image) WithDescription(d DynamicString) *Image { c.Description = d; return c }

// WithFit sets the fit property and returns c.
func (c *Image) WithFit(f ImageFit) *Image { c.Fit = f; return c }

// WithVariant sets the variant property and returns c.
func (c *Image) WithVariant(v ImageVariant) *Image { c.Variant = v; return c }

// WithWeight sets the weight property and returns c.
func (c *Image) WithWeight(w float64) *Image { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Image) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Image) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.URL) {
		return nil, core.NewValidationError("Image.URL is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	uv, err := c.URL.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["url"] = uv
	if !builder.IsNilValue(c.Description) {
		dv, err := c.Description.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out["description"] = dv
	}
	fit := c.Fit
	if fit == "" {
		fit = ImageFitFill
	}
	if err := ctx.ValidateEnum("Image.fit", string(fit), fit); err != nil {
		return nil, err
	}
	out["fit"] = string(fit)
	variant := c.Variant
	if variant == "" {
		variant = ImageVariantMediumFeature
	}
	if err := ctx.ValidateEnum("Image.variant", string(variant), variant); err != nil {
		return nil, err
	}
	out["variant"] = string(variant)
	if err := setWeight(out, "Image.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}

// Icon builds a v1.0 Basic Catalog Icon component.
type Icon struct {
	ComponentNode
	Name   IconNameValue
	Weight *float64
}

// NewIcon constructs a v1.0 Icon component.
func NewIcon(name IconNameValue) *Icon {
	return &Icon{Name: name}
}

// ComponentType returns "Icon".
func (*Icon) ComponentType() string { return "Icon" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Icon) WithID(id string) *Icon { c.ID = id; return c }

// WithCatalogID sets the component catalogId and returns c.
func (c *Icon) WithCatalogID(id string) *Icon { c.CatalogID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Icon) WithAccessibility(a AccessibilityAttributes) *Icon {
	c.Accessibility = &a
	return c
}

// WithExtensions sets the metadata.extensions entries and returns c.
func (c *Icon) WithExtensions(ext Extensions) *Icon { c.Extensions = ext; return c }

// WithWeight sets the weight property and returns c.
func (c *Icon) WithWeight(w float64) *Icon { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Icon) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Icon) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.Name) {
		return nil, core.NewValidationError("Icon.Name is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	nv, err := c.Name.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["name"] = nv
	if err := setWeight(out, "Icon.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}

// Video builds a v1.0 Basic Catalog Video component.
type Video struct {
	ComponentNode
	URL       DynamicString
	PosterURL DynamicString
	Weight    *float64
}

// NewVideo constructs a v1.0 Video component.
func NewVideo(url DynamicString) *Video {
	return &Video{URL: url}
}

// ComponentType returns "Video".
func (*Video) ComponentType() string { return "Video" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *Video) WithID(id string) *Video { c.ID = id; return c }

// WithCatalogID sets the component catalogId and returns c.
func (c *Video) WithCatalogID(id string) *Video { c.CatalogID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *Video) WithAccessibility(a AccessibilityAttributes) *Video {
	c.Accessibility = &a
	return c
}

// WithExtensions sets the metadata.extensions entries and returns c.
func (c *Video) WithExtensions(ext Extensions) *Video { c.Extensions = ext; return c }

// WithPosterURL sets the poster URL property and returns c.
func (c *Video) WithPosterURL(p DynamicString) *Video { c.PosterURL = p; return c }

// WithWeight sets the weight property and returns c.
func (c *Video) WithWeight(w float64) *Video { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *Video) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *Video) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.URL) {
		return nil, core.NewValidationError("Video.URL is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	uv, err := c.URL.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["url"] = uv
	if !builder.IsNilValue(c.PosterURL) {
		pv, err := c.PosterURL.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out["posterUrl"] = pv
	}
	if err := setWeight(out, "Video.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}

// AudioPlayer builds a v1.0 Basic Catalog AudioPlayer component.
type AudioPlayer struct {
	ComponentNode
	URL         DynamicString
	Description DynamicString
	Weight      *float64
}

// NewAudioPlayer constructs a v1.0 AudioPlayer component.
func NewAudioPlayer(url DynamicString) *AudioPlayer {
	return &AudioPlayer{URL: url}
}

// ComponentType returns "AudioPlayer".
func (*AudioPlayer) ComponentType() string { return "AudioPlayer" }

// WithID sets the explicit author-assigned component ID and returns c.
func (c *AudioPlayer) WithID(id string) *AudioPlayer { c.ID = id; return c }

// WithCatalogID sets the component catalogId and returns c.
func (c *AudioPlayer) WithCatalogID(id string) *AudioPlayer { c.CatalogID = id; return c }

// WithAccessibility sets the accessibility attributes and returns c.
func (c *AudioPlayer) WithAccessibility(a AccessibilityAttributes) *AudioPlayer {
	c.Accessibility = &a
	return c
}

// WithExtensions sets the metadata.extensions entries and returns c.
func (c *AudioPlayer) WithExtensions(ext Extensions) *AudioPlayer { c.Extensions = ext; return c }

// WithDescription sets the description property and returns c.
func (c *AudioPlayer) WithDescription(d DynamicString) *AudioPlayer { c.Description = d; return c }

// WithWeight sets the weight property and returns c.
func (c *AudioPlayer) WithWeight(w float64) *AudioPlayer { c.Weight = &w; return c }

// Flatten flattens c and its descendants into post-order wire component maps,
// using rootID as the root component ID and scope prefix.
func (c *AudioPlayer) Flatten(rootID string) ([]map[string]any, error) {
	return builder.FlattenComponentTree(c, rootID)
}

// SerializeComponent implements builder.ComponentSerializer.
func (c *AudioPlayer) SerializeComponent(ctx *builder.FlattenContext) (map[string]any, error) {
	if builder.IsNilValue(c.URL) {
		return nil, core.NewValidationError("AudioPlayer.URL is required")
	}
	out := make(map[string]any)
	if err := c.SerializeEnvelopeAttributes(ctx, out, ""); err != nil {
		return nil, err
	}
	uv, err := c.URL.SerializeBuilderValue(ctx)
	if err != nil {
		return nil, err
	}
	out["url"] = uv
	if !builder.IsNilValue(c.Description) {
		dv, err := c.Description.SerializeBuilderValue(ctx)
		if err != nil {
			return nil, err
		}
		out["description"] = dv
	}
	if err := setWeight(out, "AudioPlayer.weight", c.Weight); err != nil {
		return nil, err
	}
	return out, nil
}
