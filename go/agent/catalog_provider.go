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
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/a2ui-project/a2ui/go/core"
)

func wrapCatalogError(cause error, format string, args ...any) *core.CatalogError {
	err := core.NewCatalogErrorf(format, args...)
	err.Cause = cause
	return err
}

// CatalogProvider loads and validates an A2UI Catalog.
type CatalogProvider interface {
	Load() (*core.Catalog, error)
}

// FileSystemCatalogProvider loads a catalog JSON file from disk (accepting local paths or file:// URLs).
type FileSystemCatalogProvider struct {
	Path            string
	CatalogID       string
	ProtocolVersion core.ProtocolVersion
}

// Load reads and validates the catalog JSON file.
func (p *FileSystemCatalogProvider) Load() (*core.Catalog, error) {
	if p == nil || p.Path == "" {
		return nil, core.NewCatalogError("catalog path must be a non-empty string")
	}
	filePath, err := toLocalPath(p.Path, "catalog")
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, wrapCatalogError(err, "cannot read the catalog document %q: %v", p.Path, err)
	}
	raw, err := core.ParseJSON(data)
	if err != nil {
		return nil, wrapCatalogError(err, "the catalog document %q is not valid JSON: %v", p.Path, err)
	}
	doc, ok := raw.(map[string]any)
	if !ok {
		return nil, core.NewCatalogErrorf("the catalog document %q is not a JSON object", p.Path)
	}
	keyOrder, _ := core.ExtractJSONKeyOrder(data)
	return loadCatalogDocument(doc, p.ProtocolVersion, p.CatalogID, fmt.Sprintf("%q", p.Path), keyOrder)
}

// InMemoryCatalogProvider wraps a pre-parsed catalog map or existing *core.Catalog.
type InMemoryCatalogProvider struct {
	Catalog         *core.Catalog
	Document        map[string]any
	CatalogID       string
	ProtocolVersion core.ProtocolVersion
	KeyOrder        map[string][]string
}

// Load returns or parses the in-memory catalog.
func (p *InMemoryCatalogProvider) Load() (*core.Catalog, error) {
	if p == nil {
		return nil, core.NewCatalogError("in-memory catalog provider is nil")
	}
	if p.Catalog != nil {
		if p.CatalogID != "" && p.Catalog.CatalogID() != p.CatalogID {
			return nil, core.NewCatalogErrorf(
				"in-memory catalog declares catalog id %q, but the provider was given %q",
				p.Catalog.CatalogID(), p.CatalogID,
			)
		}
		if p.ProtocolVersion != "" {
			pv, err := core.ToProtocolVersion(string(p.ProtocolVersion))
			if err != nil {
				return nil, wrapCatalogError(err, "provider was given invalid protocol version %q: %v", p.ProtocolVersion, err)
			}
			if p.Catalog.ProtocolVersion() != pv {
				return nil, core.NewCatalogErrorf(
					"in-memory catalog declares protocol version %q, but the provider was given %q",
					p.Catalog.ProtocolVersion(), pv,
				)
			}
		}
		return p.Catalog, nil
	}
	if p.Document == nil {
		return nil, core.NewCatalogError("the in-memory catalog document is not a mapping")
	}
	return loadCatalogDocument(p.Document, p.ProtocolVersion, p.CatalogID, "the in-memory catalog document", p.KeyOrder)
}

func loadCatalogDocument(
	doc map[string]any,
	providerVersion core.ProtocolVersion,
	providerID string,
	source string,
	keyOrder map[string][]string,
) (*core.Catalog, error) {
	settledID, err := settleCatalogID(doc, providerID, source)
	if err != nil {
		return nil, err
	}
	settledPV, err := settleProtocolVersion(doc, providerVersion, source)
	if err != nil {
		return nil, err
	}
	cloned, _ := core.CloneJSONValue(doc).(map[string]any)
	if cloned == nil {
		cloned = map[string]any{}
	}
	cloned["catalogId"] = settledID
	opts := buildCatalogLoadOptions(settledID, settledPV, keyOrder)
	cat, err := core.CatalogFromJSON(cloned, opts)
	if err != nil {
		var catErr *core.CatalogError
		if errors.As(err, &catErr) {
			return nil, err
		}
		return nil, wrapCatalogError(err, "failed to load catalog from %s: %v", source, err)
	}
	return cat, nil
}

func buildCatalogLoadOptions(catalogID string, pv core.ProtocolVersion, keyOrder map[string][]string) *core.CatalogLoadOptions {
	return &core.CatalogLoadOptions{
		CatalogID:       catalogID,
		ProtocolVersion: pv,
		KeyOrder:        keyOrder,
	}
}

func settleCatalogID(doc map[string]any, providerID string, source string) (string, error) {
	rawDeclared, hasDeclared := doc["catalogId"]
	if hasDeclared && rawDeclared != nil {
		declared, ok := rawDeclared.(string)
		if !ok || declared == "" {
			return "", core.NewCatalogErrorf("%s declares a 'catalogId' that is not a non-empty string", source)
		}
		if providerID != "" && declared != providerID {
			return "", core.NewCatalogErrorf(
				"%s declares catalog id %q, but the provider was given %q",
				source, declared, providerID,
			)
		}
		return declared, nil
	}
	if providerID != "" {
		return providerID, nil
	}
	return "", core.NewCatalogErrorf(
		"%s declares no 'catalogId' and the provider was given none, so nothing names the catalog",
		source,
	)
}

func settleProtocolVersion(doc map[string]any, providerVersion core.ProtocolVersion, source string) (core.ProtocolVersion, error) {
	var providerPV core.ProtocolVersion
	hasProviderPV := providerVersion != ""
	if hasProviderPV {
		pv, err := core.ToProtocolVersion(string(providerVersion))
		if err != nil {
			return "", wrapCatalogError(err, "provider was given invalid protocol version %q: %v", providerVersion, err)
		}
		providerPV = pv
	}

	rawDeclared, hasDeclared := doc["protocolVersion"]
	if hasDeclared && rawDeclared != nil {
		declared, ok := rawDeclared.(string)
		if !ok || declared == "" {
			return "", core.NewCatalogErrorf("%s declares a 'protocolVersion' that is not a non-empty string", source)
		}
		docPV, err := core.ToProtocolVersion(declared)
		if err != nil {
			return "", wrapCatalogError(err, "%s declares unsupported protocol version %q: %v", source, declared, err)
		}
		if hasProviderPV && docPV != providerPV {
			return "", core.NewCatalogErrorf(
				"%s declares protocol version %q, but the provider was given %q",
				source, declared, providerPV,
			)
		}
		return docPV, nil
	}
	if hasProviderPV {
		return providerPV, nil
	}
	return "", core.NewCatalogErrorf(
		"%s declares no 'protocolVersion' and the provider was given none, so nothing states which protocol it is written against",
		source,
	)
}

func toLocalPath(rawPath, kind string) (string, error) {
	colon := strings.IndexByte(rawPath, ':')
	slash := strings.IndexAny(rawPath, `/\`)
	if colon <= 0 || (slash >= 0 && slash < colon) {
		return rawPath, nil
	}
	scheme := rawPath[:colon]
	if len(scheme) == 1 && ((scheme[0] >= 'a' && scheme[0] <= 'z') || (scheme[0] >= 'A' && scheme[0] <= 'Z')) {
		return rawPath, nil
	}
	if !strings.EqualFold(scheme, "file") {
		return "", core.NewCatalogErrorf("unsupported %s URL scheme %q in %q", kind, scheme, rawPath)
	}
	parsed, err := url.Parse(rawPath)
	if err != nil {
		return "", wrapCatalogError(err, "invalid %s URL %q: %v", kind, rawPath, err)
	}
	unescaped, err := url.PathUnescape(parsed.Path)
	if err != nil {
		return "", wrapCatalogError(err, "invalid %s URL path %q: %v", kind, rawPath, err)
	}
	if len(unescaped) >= 3 && unescaped[0] == '/' &&
		((unescaped[1] >= 'a' && unescaped[1] <= 'z') || (unescaped[1] >= 'A' && unescaped[1] <= 'Z')) &&
		unescaped[2] == ':' {
		unescaped = unescaped[1:]
	}
	return unescaped, nil
}

// CatalogTransformer produces a transformed copy of a Catalog (for example, pruning components or functions).
type CatalogTransformer interface {
	Transform(catalog *core.Catalog) (*core.Catalog, error)
}

// ComponentPruningTransformer retains only the allowed component names on a catalog.
type ComponentPruningTransformer struct {
	AllowedComponents []string
}

// Transform returns a catalog copy retaining only AllowedComponents.
func (t *ComponentPruningTransformer) Transform(catalog *core.Catalog) (*core.Catalog, error) {
	if catalog == nil {
		return nil, core.NewCatalogError("catalog must not be nil")
	}
	allow := make(map[string]bool, len(t.AllowedComponents))
	for _, name := range t.AllowedComponents {
		allow[name] = true
	}
	comps := catalog.Components()
	kept := make(map[string]core.ComponentAPI)
	var order []string
	for _, name := range catalog.ComponentNames() {
		if allow[name] {
			if comp, ok := comps[name]; ok {
				kept[name] = comp
				order = append(order, name)
			}
		}
	}
	for name, comp := range comps {
		if allow[name] {
			if _, exists := kept[name]; !exists {
				kept[name] = comp
				order = append(order, name)
			}
		}
	}
	return catalog.CopyWith(core.CopyWithOptions{
		Components:      kept,
		ComponentOrder:  order,
		ClearComponents: len(kept) == 0,
	})
}

// FunctionPruningTransformer retains only the allowed function names on a catalog.
type FunctionPruningTransformer struct {
	AllowedFunctions []string
}

// Transform returns a catalog copy retaining only AllowedFunctions.
func (t *FunctionPruningTransformer) Transform(catalog *core.Catalog) (*core.Catalog, error) {
	if catalog == nil {
		return nil, core.NewCatalogError("catalog must not be nil")
	}
	allow := make(map[string]bool, len(t.AllowedFunctions))
	for _, name := range t.AllowedFunctions {
		allow[name] = true
	}
	fns := catalog.Functions()
	kept := make(map[string]core.FunctionAPI)
	var order []string
	for _, name := range catalog.FunctionNames() {
		if allow[name] {
			if fn, ok := fns[name]; ok {
				kept[name] = fn
				order = append(order, name)
			}
		}
	}
	for name, fn := range fns {
		if allow[name] {
			if _, exists := kept[name]; !exists {
				kept[name] = fn
				order = append(order, name)
			}
		}
	}
	return catalog.CopyWith(core.CopyWithOptions{
		Functions:      kept,
		FunctionOrder:  order,
		ClearFunctions: len(kept) == 0,
	})
}

// CatalogConfigOptions configures CatalogConfig loading from disk.
type CatalogConfigOptions struct {
	CatalogID       string
	ProtocolVersion core.ProtocolVersion
	Transformers    []CatalogTransformer
}

// CatalogConfig pairs a Catalog (or CatalogProvider) with ordered CatalogTransformer stages.
type CatalogConfig struct {
	catalog      *core.Catalog
	provider     CatalogProvider
	transformers []CatalogTransformer
	transformed  *core.Catalog
}

// NewCatalogConfig creates a CatalogConfig from a loaded Catalog and optional transformers.
func NewCatalogConfig(catalog *core.Catalog, transformers ...CatalogTransformer) (*CatalogConfig, error) {
	if catalog == nil {
		return nil, core.NewCatalogError("catalog must not be nil")
	}
	curr := catalog
	var err error
	for _, tr := range transformers {
		if tr == nil {
			continue
		}
		curr, err = tr.Transform(curr)
		if err != nil {
			return nil, err
		}
	}
	return &CatalogConfig{
		catalog:      catalog,
		transformers: append([]CatalogTransformer(nil), transformers...),
		transformed:  curr,
	}, nil
}

// CatalogConfigFromProvider loads a Catalog from provider and applies optional transformers.
func CatalogConfigFromProvider(provider CatalogProvider, transformers ...CatalogTransformer) (*CatalogConfig, error) {
	if provider == nil {
		return nil, core.NewCatalogError("catalog provider must not be nil")
	}
	cat, err := provider.Load()
	if err != nil {
		return nil, err
	}
	cfg, err := NewCatalogConfig(cat, transformers...)
	if err != nil {
		return nil, err
	}
	cfg.provider = provider
	return cfg, nil
}

// CatalogConfigFromPath loads a Catalog from path with optional CatalogConfigOptions.
func CatalogConfigFromPath(path string, opts *CatalogConfigOptions) (*CatalogConfig, error) {
	var resolved CatalogConfigOptions
	if opts != nil {
		resolved = *opts
	}
	prov := &FileSystemCatalogProvider{
		Path:            path,
		CatalogID:       resolved.CatalogID,
		ProtocolVersion: resolved.ProtocolVersion,
	}
	return CatalogConfigFromProvider(prov, resolved.Transformers...)
}

// Catalog returns the original untransformed Catalog.
func (c *CatalogConfig) Catalog() *core.Catalog {
	if c == nil {
		return nil
	}
	return c.catalog
}

// Provider returns the CatalogProvider that loaded the catalog, or nil if created directly from a Catalog.
func (c *CatalogConfig) Provider() CatalogProvider {
	if c == nil {
		return nil
	}
	return c.provider
}

// Transformers returns a copy of the configured CatalogTransformer pipeline.
func (c *CatalogConfig) Transformers() []CatalogTransformer {
	if c == nil {
		return nil
	}
	return append([]CatalogTransformer(nil), c.transformers...)
}

// TransformedCatalog returns the catalog after applying all configured transformers.
func (c *CatalogConfig) TransformedCatalog() *core.Catalog {
	if c == nil {
		return nil
	}
	return c.transformed
}
