package a2uischema

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// CatalogConfig configures how a catalog is loaded.
type CatalogConfig struct {
	Name         string
	Provider     CatalogProvider
	ExamplesPath string
}

// CatalogConfigFromPath constructs a [CatalogConfig] from a file path.
func CatalogConfigFromPath(name, catalogPath, examplesPath string) CatalogConfig {
	return CatalogConfig{
		Name:         name,
		Provider:     FileSystemCatalogProvider(catalogPath),
		ExamplesPath: examplesPath,
	}
}

// BasicCatalogConfig returns a [CatalogConfig] backed by embedded schemas.
func BasicCatalogConfig(version Version) (CatalogConfig, error) {
	provider, err := BasicCatalogProvider(version)
	if err != nil {
		return CatalogConfig{}, err
	}
	return CatalogConfig{
		Name:     "basic",
		Provider: provider,
	}, nil
}

// Catalog is a processed catalog plus the schemas needed to reason about it.
type Catalog struct {
	Version              Version
	Name                 string
	ServerToClientSchema map[string]any
	CommonTypesSchema    map[string]any
	CatalogSchema        map[string]any
}

// ID returns the catalog identifier.
func (c *Catalog) ID() (string, error) {
	id, ok := c.CatalogSchema[CatalogIDKey].(string)
	if !ok || id == "" {
		return "", fmt.Errorf("schema: catalog %q missing catalogId", c.Name)
	}
	return id, nil
}

// Validator returns a new validator for the catalog.
func (c *Catalog) Validator() *Validator {
	return NewValidator(c)
}

// WithPruning returns a copy of the catalog pruned to the requested components and messages.
func (c *Catalog) WithPruning(allowedComponents, allowedMessages []string) (*Catalog, error) {
	if c == nil {
		return nil, fmt.Errorf("schema: nil catalog")
	}
	serverSchema, commonSchema, catalogSchema, err := cloneCatalogSchemas(c)
	if err != nil {
		return nil, err
	}
	out := &Catalog{
		Version:              c.Version,
		Name:                 c.Name,
		ServerToClientSchema: serverSchema,
		CommonTypesSchema:    commonSchema,
		CatalogSchema:        catalogSchema,
	}
	if len(allowedComponents) > 0 {
		components, _ := out.CatalogSchema[CatalogComponentsKey].(map[string]any)
		if components != nil {
			filtered := make(map[string]any)
			for _, name := range allowedComponents {
				if value, ok := components[name]; ok {
					filtered[name] = value
				}
			}
			out.CatalogSchema[CatalogComponentsKey] = filtered
		}
		if defs, ok := out.CatalogSchema["$defs"].(map[string]any); ok {
			if anyComponent, ok := defs["anyComponent"].(map[string]any); ok {
				if oneOf, ok := anyComponent["oneOf"].([]any); ok {
					filtered := oneOf[:0]
					for _, item := range oneOf {
						ref, _ := item.(map[string]any)["$ref"].(string)
						if ref == "" {
							filtered = append(filtered, item)
							continue
						}
						name := ref[strings.LastIndex(ref, "/")+1:]
						if slices.Contains(allowedComponents, name) {
							filtered = append(filtered, item)
						}
					}
					anyComponent["oneOf"] = filtered
				}
			}
		}
	}
	if len(allowedMessages) > 0 {
		defs, _ := out.ServerToClientSchema["$defs"].(map[string]any)
		if defs != nil {
			filteredDefs := make(map[string]any)
			for _, name := range allowedMessages {
				if value, ok := defs[name]; ok {
					filteredDefs[name] = value
				}
			}
			out.ServerToClientSchema["$defs"] = filteredDefs
		}
		if oneOf, ok := out.ServerToClientSchema["oneOf"].([]any); ok {
			filtered := oneOf[:0]
			for _, item := range oneOf {
				ref, _ := item.(map[string]any)["$ref"].(string)
				if ref == "" {
					continue
				}
				name := ref[strings.LastIndex(ref, "/")+1:]
				if slices.Contains(allowedMessages, name) {
					filtered = append(filtered, item)
				}
			}
			out.ServerToClientSchema["oneOf"] = filtered
		}
	}
	return out, nil
}

// RenderAsLLMInstructions renders the schemas as a schema block suitable for prompts.
func (c *Catalog) RenderAsLLMInstructions() (string, error) {
	serverSchema, err := marshalIndented(c.ServerToClientSchema)
	if err != nil {
		return "", err
	}
	commonTypes, err := marshalIndented(c.CommonTypesSchema)
	if err != nil {
		return "", err
	}
	catalogSchema, err := marshalIndented(c.CatalogSchema)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString(A2UISchemaBlockStart)
	b.WriteString("\n### Server To Client Schema:\n")
	b.Write(serverSchema)
	if len(commonTypes) > 0 && string(commonTypes) != "{}" {
		b.WriteString("\n\n### Common Types Schema:\n")
		b.Write(commonTypes)
	}
	b.WriteString("\n\n### Catalog Schema:\n")
	b.Write(catalogSchema)
	if rules, ok := embeddedCatalogRules(c); ok && strings.TrimSpace(rules) != "" {
		b.WriteString("\n\n### Catalog Rules:\n")
		b.WriteString(strings.TrimSpace(rules))
	}
	b.WriteString("\n")
	b.WriteString(A2UISchemaBlockEnd)
	return b.String(), nil
}

// LoadExamples loads `.json` examples from a path and optionally validates them.
// Path may name a file, a directory, or a glob pattern.
func (c *Catalog) LoadExamples(path string, validate bool) (string, error) {
	if path == "" {
		return "", nil
	}
	files, err := exampleFiles(path)
	if err != nil {
		return "", err
	}
	var blocks []string
	validator := c.Validator()
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			return "", err
		}
		if validate {
			if err := validator.ValidateExample(data); err != nil {
				return "", fmt.Errorf("schema: validate example %s: %w", file, err)
			}
		}
		name := filepath.Base(file)
		base := strings.TrimSuffix(name, filepath.Ext(name))
		blocks = append(blocks, fmt.Sprintf("---BEGIN %s---\n%s\n---END %s---", base, strings.TrimSpace(string(data)), base))
	}
	return strings.Join(blocks, "\n\n"), nil
}

func exampleFiles(path string) ([]string, error) {
	if hasGlobMeta(path) {
		return globExampleFiles(path)
	}
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if !info.IsDir() {
		if strings.HasSuffix(info.Name(), ".json") {
			return []string{path}, nil
		}
		return nil, nil
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		files = append(files, filepath.Join(path, entry.Name()))
	}
	slices.Sort(files)
	return files, nil
}

func globExampleFiles(pattern string) ([]string, error) {
	pattern = normalizeGlobPattern(pattern)
	if strings.Contains(pattern, "**") {
		return globStarExampleFiles(pattern)
	}
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, err
	}
	matches = filterJSONFiles(matches)
	slices.Sort(matches)
	return matches, nil
}

func globStarExampleFiles(pattern string) ([]string, error) {
	i := strings.Index(pattern, "**")
	root := pattern[:i]
	if root == "" {
		root = "."
	}
	root = strings.TrimRight(root, string(filepath.Separator))
	suffix := strings.TrimLeft(pattern[i+len("**"):], string(filepath.Separator))
	if suffix == "" {
		suffix = "*"
	}
	var files []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".json") {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		ok, err := matchGlobStarSuffix(suffix, rel)
		if err != nil {
			return err
		}
		if ok {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	slices.Sort(files)
	return files, nil
}

func matchGlobStarSuffix(suffix, rel string) (bool, error) {
	if ok, err := filepath.Match(suffix, rel); ok || err != nil {
		return ok, err
	}
	if !strings.Contains(suffix, string(filepath.Separator)) {
		return filepath.Match(suffix, filepath.Base(rel))
	}
	return false, nil
}

func filterJSONFiles(paths []string) []string {
	files := paths[:0]
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil || info.IsDir() || !strings.HasSuffix(info.Name(), ".json") {
			continue
		}
		files = append(files, path)
	}
	return files
}

func hasGlobMeta(path string) bool {
	return strings.ContainsAny(path, "*?[")
}

func normalizeGlobPattern(pattern string) string {
	return strings.ReplaceAll(pattern, "[!", "[^")
}

func newCatalog(version Version, name string, serverToClientSchema, commonTypesSchema, catalogSchema []byte) (*Catalog, error) {
	serverMap, err := unmarshalJSONMap(serverToClientSchema)
	if err != nil {
		return nil, fmt.Errorf("schema: decode server_to_client schema: %w", err)
	}
	commonMap, err := unmarshalJSONMap(commonTypesSchema)
	if err != nil {
		return nil, fmt.Errorf("schema: decode common_types schema: %w", err)
	}
	catalogMap, err := unmarshalJSONMap(catalogSchema)
	if err != nil {
		return nil, fmt.Errorf("schema: decode catalog schema: %w", err)
	}
	return &Catalog{
		Version:              version,
		Name:                 name,
		ServerToClientSchema: serverMap,
		CommonTypesSchema:    commonMap,
		CatalogSchema:        catalogMap,
	}, nil
}

func embeddedCatalogRules(c *Catalog) (string, bool) {
	if c == nil {
		return "", false
	}
	id, err := c.ID()
	if err != nil {
		return "", false
	}
	switch {
	case c.Version == Version09 && id == "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json":
		return basicCatalogRulesV09, true
	case c.Version == Version091 && id == "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json":
		return basicCatalogRulesV091, true
	case c.Version == Version010 && id == "https://a2ui.org/specification/v0_10/catalogs/basic/catalog.json":
		return basicCatalogRulesV010, true
	}
	return "", false
}

func marshalIndented(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSpace(buf.Bytes()), nil
}

func unmarshalJSONMap(data []byte) (map[string]any, error) {
	if len(bytes.TrimSpace(data)) == 0 {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func cloneCatalogSchemas(c *Catalog) (serverSchema, commonSchema, catalogSchema map[string]any, err error) {
	if c == nil {
		return nil, nil, nil, fmt.Errorf("schema: nil catalog")
	}
	serverSchema, err = cloneJSONMap(c.ServerToClientSchema)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("schema: clone server_to_client schema: %w", err)
	}
	commonSchema, err = cloneJSONMap(c.CommonTypesSchema)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("schema: clone common_types schema: %w", err)
	}
	catalogSchema, err = cloneJSONMap(c.CatalogSchema)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("schema: clone catalog schema: %w", err)
	}
	return serverSchema, commonSchema, catalogSchema, nil
}

func cloneJSONMap(m map[string]any) (map[string]any, error) {
	if m == nil {
		return nil, nil
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = cloneJSONValue(v)
	}
	return out, nil
}

func cloneJSONValue(v any) any {
	switch v := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, elem := range v {
			out[k] = cloneJSONValue(elem)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, elem := range v {
			out[i] = cloneJSONValue(elem)
		}
		return out
	default:
		return v
	}
}
