package a2uischema

import (
	"encoding/json"
	"fmt"

	"github.com/a2ui-project/a2ui/agent_sdks/go/a2ui"
	a2uiv010 "github.com/a2ui-project/a2ui/agent_sdks/go/a2ui/v010"
	a2uiv091 "github.com/a2ui-project/a2ui/agent_sdks/go/a2ui/v091"
)

// SchemaModifier can rewrite a decoded schema before it is used.
type SchemaModifier func(schema map[string]any) error

// SchemaManager manages schemas, catalogs, and prompt rendering.
type SchemaManager struct {
	version               Version
	acceptsInlineCatalogs bool
	serverToClientSchema  map[string]any
	commonTypesSchema     map[string]any
	supportedCatalogs     []*Catalog
	catalogExamplePaths   map[string]string
	schemaModifiers       []SchemaModifier
}

// NewSchemaManager constructs a schema manager.
func NewSchemaManager(version Version, catalogs []CatalogConfig, acceptsInlineCatalogs bool, schemaModifiers ...SchemaModifier) (*SchemaManager, error) {
	serverSchema, commonSchema, err := embeddedSchemas(version)
	if err != nil {
		return nil, err
	}
	manager := &SchemaManager{
		version:               version,
		acceptsInlineCatalogs: acceptsInlineCatalogs,
		serverToClientSchema:  serverSchema,
		commonTypesSchema:     commonSchema,
		catalogExamplePaths:   make(map[string]string),
		schemaModifiers:       schemaModifiers,
	}
	for _, cfg := range catalogs {
		data, err := cfg.Provider.Load()
		if err != nil {
			return nil, fmt.Errorf("schema: load catalog %q: %w", cfg.Name, err)
		}
		serverSchemaData, err := marshalJSON(serverSchema)
		if err != nil {
			return nil, fmt.Errorf("schema: encode server_to_client schema: %w", err)
		}
		commonSchemaData, err := marshalJSON(commonSchema)
		if err != nil {
			return nil, fmt.Errorf("schema: encode common_types schema: %w", err)
		}
		catalog, err := newCatalog(version, cfg.Name, serverSchemaData, commonSchemaData, data)
		if err != nil {
			return nil, err
		}
		if err := manager.applyModifiers(catalog.ServerToClientSchema); err != nil {
			return nil, err
		}
		if err := manager.applyModifiers(catalog.CommonTypesSchema); err != nil {
			return nil, err
		}
		if err := manager.applyModifiers(catalog.CatalogSchema); err != nil {
			return nil, err
		}
		manager.supportedCatalogs = append(manager.supportedCatalogs, catalog)
		if cfg.ExamplesPath != "" {
			id, err := catalog.ID()
			if err != nil {
				return nil, err
			}
			manager.catalogExamplePaths[id] = cfg.ExamplesPath
		}
	}
	return manager, nil
}

// SupportedCatalogIDs returns the agent-supported catalog identifiers.
func (m *SchemaManager) SupportedCatalogIDs() []string {
	ids := make([]string, 0, len(m.supportedCatalogs))
	for _, catalog := range m.supportedCatalogs {
		id, err := catalog.ID()
		if err == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

// SelectedCatalog selects the catalog for the provided client capabilities and pruning.
func (m *SchemaManager) SelectedCatalog(clientCapabilities any, allowedComponents, allowedMessages []string) (*Catalog, error) {
	selected, err := m.selectCatalogFor(clientCapabilities)
	if err != nil {
		return nil, err
	}
	return selected.WithPruning(allowedComponents, allowedMessages)
}

// LoadExamples loads examples for a catalog if configured.
func (m *SchemaManager) LoadExamples(catalog *Catalog, validate bool) (string, error) {
	if catalog == nil {
		return "", fmt.Errorf("schema: nil catalog")
	}
	id, err := catalog.ID()
	if err != nil {
		return "", err
	}
	path := m.catalogExamplePaths[id]
	return catalog.LoadExamples(path, validate)
}

// GenerateSystemPrompt assembles the system prompt.
func (m *SchemaManager) GenerateSystemPrompt(roleDescription, workflowDescription, uiDescription string, clientCapabilities any, allowedComponents, allowedMessages []string, includeSchema, includeExamples, validateExamples bool) (string, error) {
	catalog, err := m.SelectedCatalog(clientCapabilities, allowedComponents, allowedMessages)
	if err != nil {
		return "", err
	}
	return m.generateSystemPrompt(catalog, roleDescription, workflowDescription, uiDescription, includeSchema, includeExamples, validateExamples)
}

func (m *SchemaManager) generateSystemPrompt(catalog *Catalog, roleDescription, workflowDescription, uiDescription string, includeSchema, includeExamples, validateExamples bool) (string, error) {
	parts := []string{roleDescription}
	workflow := DefaultWorkflowRules
	if workflowDescription != "" {
		workflow += "\n" + workflowDescription
	}
	parts = append(parts, "## Workflow Description:\n"+workflow)
	if uiDescription != "" {
		parts = append(parts, "## UI Description:\n"+uiDescription)
	}
	if includeSchema {
		schemaBlock, err := catalog.RenderAsLLMInstructions()
		if err != nil {
			return "", err
		}
		parts = append(parts, schemaBlock)
	}
	if includeExamples {
		examples, err := m.LoadExamples(catalog, validateExamples)
		if err != nil {
			return "", err
		}
		if examples != "" {
			parts = append(parts, "### Examples:\n"+examples)
		}
	}
	return joinPromptParts(parts), nil
}

func (m *SchemaManager) applyModifiers(schema map[string]any) error {
	for _, modifier := range m.schemaModifiers {
		if err := modifier(schema); err != nil {
			return err
		}
	}
	return nil
}

func (m *SchemaManager) selectCatalog(clientCapabilities *a2ui.ClientCapabilities) (*Catalog, error) {
	if len(m.supportedCatalogs) == 0 {
		return nil, fmt.Errorf("schema: no supported catalogs configured")
	}
	if clientCapabilities == nil || clientCapabilities.V09 == nil {
		return m.supportedCatalogs[0], nil
	}
	caps := clientCapabilities.V09
	if len(caps.InlineCatalogs) > 0 {
		if !m.acceptsInlineCatalogs {
			return nil, fmt.Errorf("schema: inline catalogs provided but not accepted")
		}
		base := m.supportedCatalogs[0]
		if len(caps.SupportedCatalogIDs) > 0 {
			for _, id := range caps.SupportedCatalogIDs {
				for _, catalog := range m.supportedCatalogs {
					catalogID, err := catalog.ID()
					if err == nil && catalogID == id {
						base = catalog
						break
					}
				}
			}
		}
		return mergeInlineCatalogs(m.version, base, caps.InlineCatalogs)
	}
	if len(caps.SupportedCatalogIDs) == 0 {
		return m.supportedCatalogs[0], nil
	}
	for _, id := range caps.SupportedCatalogIDs {
		for _, catalog := range m.supportedCatalogs {
			catalogID, err := catalog.ID()
			if err == nil && catalogID == id {
				return catalog, nil
			}
		}
	}
	return nil, fmt.Errorf("schema: no mutually supported catalog found")
}

func (m *SchemaManager) selectCatalogV010(clientCapabilities *a2uiv010.ClientCapabilities) (*Catalog, error) {
	if m.version != Version010 {
		return nil, fmt.Errorf("schema: manager version = %q, want %q", m.version, Version010)
	}
	if len(m.supportedCatalogs) == 0 {
		return nil, fmt.Errorf("schema: no supported catalogs configured")
	}
	if clientCapabilities == nil || clientCapabilities.V010 == nil {
		return m.supportedCatalogs[0], nil
	}
	caps := clientCapabilities.V010
	if len(caps.InlineCatalogs) > 0 {
		if !m.acceptsInlineCatalogs {
			return nil, fmt.Errorf("schema: inline catalogs provided but not accepted")
		}
		base := m.supportedCatalogs[0]
		if len(caps.SupportedCatalogIDs) > 0 {
			for _, id := range caps.SupportedCatalogIDs {
				for _, catalog := range m.supportedCatalogs {
					catalogID, err := catalog.ID()
					if err == nil && catalogID == id {
						base = catalog
						break
					}
				}
			}
		}
		return mergeInlineCatalogsV010(m.version, base, caps.InlineCatalogs)
	}
	if len(caps.SupportedCatalogIDs) == 0 {
		return m.supportedCatalogs[0], nil
	}
	for _, id := range caps.SupportedCatalogIDs {
		for _, catalog := range m.supportedCatalogs {
			catalogID, err := catalog.ID()
			if err == nil && catalogID == id {
				return catalog, nil
			}
		}
	}
	return nil, fmt.Errorf("schema: no mutually supported catalog found")
}

func (m *SchemaManager) selectCatalogFor(clientCapabilities any) (*Catalog, error) {
	switch caps := clientCapabilities.(type) {
	case nil:
		if m.version == Version010 {
			return m.selectCatalogV010(nil)
		}
		return m.selectCatalog(nil)
	case *a2ui.ClientCapabilities:
		if !isV09WireVersion(m.version) {
			return nil, fmt.Errorf("schema: manager version = %q, got v0.9 capabilities", m.version)
		}
		return m.selectCatalog(caps)
	case *a2uiv091.ClientCapabilities:
		if m.version != Version091 {
			return nil, fmt.Errorf("schema: manager version = %q, got v0.9.1 capabilities", m.version)
		}
		return m.selectCatalogV091(caps)
	case *a2uiv010.ClientCapabilities:
		if m.version != Version010 {
			return nil, fmt.Errorf("schema: manager version = %q, got v0.10 capabilities", m.version)
		}
		return m.selectCatalogV010(caps)
	default:
		return nil, fmt.Errorf("schema: unsupported client capabilities type %T", clientCapabilities)
	}
}

func (m *SchemaManager) selectCatalogV091(clientCapabilities *a2uiv091.ClientCapabilities) (*Catalog, error) {
	if m.version != Version091 {
		return nil, fmt.Errorf("schema: manager version = %q, want %q", m.version, Version091)
	}
	if len(m.supportedCatalogs) == 0 {
		return nil, fmt.Errorf("schema: no supported catalogs configured")
	}
	if clientCapabilities == nil || clientCapabilities.V091 == nil {
		return m.supportedCatalogs[0], nil
	}
	caps := clientCapabilities.V091
	if len(caps.InlineCatalogs) > 0 {
		if !m.acceptsInlineCatalogs {
			return nil, fmt.Errorf("schema: inline catalogs provided but not accepted")
		}
		base := m.supportedCatalogs[0]
		if len(caps.SupportedCatalogIDs) > 0 {
			for _, id := range caps.SupportedCatalogIDs {
				for _, catalog := range m.supportedCatalogs {
					catalogID, err := catalog.ID()
					if err == nil && catalogID == id {
						base = catalog
						break
					}
				}
			}
		}
		return mergeInlineCatalogsV091(m.version, base, caps.InlineCatalogs)
	}
	if len(caps.SupportedCatalogIDs) == 0 {
		return m.supportedCatalogs[0], nil
	}
	for _, id := range caps.SupportedCatalogIDs {
		for _, catalog := range m.supportedCatalogs {
			catalogID, err := catalog.ID()
			if err == nil && catalogID == id {
				return catalog, nil
			}
		}
	}
	return nil, fmt.Errorf("schema: no mutually supported catalog found")
}

func mergeInlineCatalogs(version Version, base *Catalog, inlineCatalogs []a2ui.CatalogDef) (*Catalog, error) {
	serverSchema, commonSchema, catalogSchema, err := cloneCatalogSchemas(base)
	if err != nil {
		return nil, err
	}
	merged := &Catalog{
		Version:              version,
		Name:                 InlineCatalogName,
		ServerToClientSchema: serverSchema,
		CommonTypesSchema:    commonSchema,
		CatalogSchema:        catalogSchema,
	}
	for _, inline := range inlineCatalogs {
		if inline.CatalogID != "" {
			merged.CatalogSchema[CatalogIDKey] = inline.CatalogID
		}
		components, _ := merged.CatalogSchema[CatalogComponentsKey].(map[string]any)
		if components == nil {
			components = make(map[string]any)
			merged.CatalogSchema[CatalogComponentsKey] = components
		}
		for name, raw := range inline.Components {
			var decoded any
			if err := json.Unmarshal(raw, &decoded); err != nil {
				return nil, fmt.Errorf("schema: decode inline component %q: %w", name, err)
			}
			components[name] = decoded
		}
		if len(inline.Theme) > 0 {
			theme, _ := merged.CatalogSchema[CatalogThemeKey].(map[string]any)
			if theme == nil {
				theme = make(map[string]any)
				merged.CatalogSchema[CatalogThemeKey] = theme
			}
			for name, raw := range inline.Theme {
				var decoded any
				if err := json.Unmarshal(raw, &decoded); err != nil {
					return nil, fmt.Errorf("schema: decode inline theme %q: %w", name, err)
				}
				theme[name] = decoded
			}
		}
		if err := mergeInlineFunctions(merged.CatalogSchema, inline.Functions); err != nil {
			return nil, err
		}
	}
	return merged, nil
}

func mergeInlineCatalogsV091(version Version, base *Catalog, inlineCatalogs []a2uiv091.CatalogDef) (*Catalog, error) {
	serverSchema, commonSchema, catalogSchema, err := cloneCatalogSchemas(base)
	if err != nil {
		return nil, err
	}
	merged := &Catalog{
		Version:              version,
		Name:                 InlineCatalogName,
		ServerToClientSchema: serverSchema,
		CommonTypesSchema:    commonSchema,
		CatalogSchema:        catalogSchema,
	}
	for _, inline := range inlineCatalogs {
		if inline.CatalogID != "" {
			merged.CatalogSchema[CatalogIDKey] = inline.CatalogID
		}
		components, _ := merged.CatalogSchema[CatalogComponentsKey].(map[string]any)
		if components == nil {
			components = make(map[string]any)
			merged.CatalogSchema[CatalogComponentsKey] = components
		}
		for name, raw := range inline.Components {
			var decoded any
			if err := json.Unmarshal(raw, &decoded); err != nil {
				return nil, fmt.Errorf("schema: decode inline component %q: %w", name, err)
			}
			components[name] = decoded
		}
		if len(inline.Theme) > 0 {
			theme, _ := merged.CatalogSchema[CatalogThemeKey].(map[string]any)
			if theme == nil {
				theme = make(map[string]any)
				merged.CatalogSchema[CatalogThemeKey] = theme
			}
			for name, raw := range inline.Theme {
				var decoded any
				if err := json.Unmarshal(raw, &decoded); err != nil {
					return nil, fmt.Errorf("schema: decode inline theme %q: %w", name, err)
				}
				theme[name] = decoded
			}
		}
		if err := mergeInlineFunctions(merged.CatalogSchema, inline.Functions); err != nil {
			return nil, err
		}
	}
	return merged, nil
}

func mergeInlineCatalogsV010(version Version, base *Catalog, inlineCatalogs []a2uiv010.CatalogDef) (*Catalog, error) {
	serverSchema, commonSchema, catalogSchema, err := cloneCatalogSchemas(base)
	if err != nil {
		return nil, err
	}
	merged := &Catalog{
		Version:              version,
		Name:                 InlineCatalogName,
		ServerToClientSchema: serverSchema,
		CommonTypesSchema:    commonSchema,
		CatalogSchema:        catalogSchema,
	}
	for _, inline := range inlineCatalogs {
		if inline.CatalogID != "" {
			merged.CatalogSchema[CatalogIDKey] = inline.CatalogID
		}
		components, _ := merged.CatalogSchema[CatalogComponentsKey].(map[string]any)
		if components == nil {
			components = make(map[string]any)
			merged.CatalogSchema[CatalogComponentsKey] = components
		}
		for name, raw := range inline.Components {
			var decoded any
			if err := json.Unmarshal(raw, &decoded); err != nil {
				return nil, fmt.Errorf("schema: decode inline component %q: %w", name, err)
			}
			components[name] = decoded
		}
		if len(inline.Theme) > 0 {
			theme, _ := merged.CatalogSchema[CatalogThemeKey].(map[string]any)
			if theme == nil {
				theme = make(map[string]any)
				merged.CatalogSchema[CatalogThemeKey] = theme
			}
			for name, raw := range inline.Theme {
				var decoded any
				if err := json.Unmarshal(raw, &decoded); err != nil {
					return nil, fmt.Errorf("schema: decode inline theme %q: %w", name, err)
				}
				theme[name] = decoded
			}
		}
		if err := mergeInlineFunctions(merged.CatalogSchema, inline.Functions); err != nil {
			return nil, err
		}
	}
	return merged, nil
}

func mergeInlineFunctions(catalogSchema map[string]any, functions any) error {
	data, err := json.Marshal(functions)
	if err != nil {
		return fmt.Errorf("schema: encode inline functions: %w", err)
	}
	var defs []map[string]any
	if err := json.Unmarshal(data, &defs); err != nil {
		return fmt.Errorf("schema: decode inline functions: %w", err)
	}
	if len(defs) == 0 {
		return nil
	}
	functionsMap, _ := catalogSchema[CatalogFunctionsKey].(map[string]any)
	if functionsMap != nil {
		for _, def := range defs {
			name, _ := def["name"].(string)
			if name == "" {
				return fmt.Errorf("schema: inline function missing name")
			}
			functionsMap[name] = def
		}
		return nil
	}
	functionsList, _ := catalogSchema[CatalogFunctionsKey].([]any)
	for _, def := range defs {
		functionsList = append(functionsList, def)
	}
	catalogSchema[CatalogFunctionsKey] = functionsList
	return nil
}

func embeddedSchemas(version Version) (map[string]any, map[string]any, error) {
	switch version {
	case Version09:
		serverMap, err := unmarshalJSONMap(serverToClientV09)
		if err != nil {
			return nil, nil, err
		}
		commonMap, err := unmarshalJSONMap(commonTypesV09)
		if err != nil {
			return nil, nil, err
		}
		return serverMap, commonMap, nil
	case Version091:
		serverMap, err := unmarshalJSONMap(serverToClientV091)
		if err != nil {
			return nil, nil, err
		}
		commonMap, err := unmarshalJSONMap(commonTypesV091)
		if err != nil {
			return nil, nil, err
		}
		return serverMap, commonMap, nil
	case Version010:
		serverMap, err := unmarshalJSONMap(serverToClientV010)
		if err != nil {
			return nil, nil, err
		}
		commonMap, err := unmarshalJSONMap(commonTypesV010)
		if err != nil {
			return nil, nil, err
		}
		return serverMap, commonMap, nil
	default:
		return nil, nil, fmt.Errorf("schema: unsupported version %q", version)
	}
}

func marshalJSON(v any) ([]byte, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return data, nil
}

func joinPromptParts(parts []string) string {
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			out = append(out, part)
		}
	}
	return string(bytesJoinWithDoubleNewline(out))
}

func bytesJoinWithDoubleNewline(parts []string) []byte {
	if len(parts) == 0 {
		return nil
	}
	var out []byte
	for i, part := range parts {
		if i > 0 {
			out = append(out, '\n', '\n')
		}
		out = append(out, part...)
	}
	return out
}
