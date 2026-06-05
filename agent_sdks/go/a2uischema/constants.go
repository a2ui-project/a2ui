package a2uischema

const (
	SupportedCatalogIDsKey = "supportedCatalogIds"
	InlineCatalogsKey      = "inlineCatalogs"
	CatalogComponentsKey   = "components"
	CatalogFunctionsKey    = "functions"
	CatalogIDKey           = "catalogId"
	CatalogThemeKey        = "theme"
	InlineCatalogName      = "inline"
	A2UIOpenTag            = "<a2ui-json>"
	A2UICloseTag           = "</a2ui-json>"
	A2UISchemaBlockStart   = "---BEGIN A2UI JSON SCHEMA---"
	A2UISchemaBlockEnd     = "---END A2UI JSON SCHEMA---"
	DefaultWorkflowRules   = "The generated response MUST follow these rules:\n- The response can contain one or more A2UI JSON blocks.\n- Each A2UI JSON block MUST be wrapped in `<a2ui-json>` and `</a2ui-json>` tags.\n- Between or around these blocks, you can provide conversational text.\n- The JSON part MUST be a single, raw JSON object or array of A2UI messages and MUST validate against the provided A2UI JSON SCHEMA.\n- Component IDs referenced by a component MUST be defined in the same update or already exist on the surface."
)

type Version string

const (
	Version09  Version = "v0.9"
	Version091 Version = "v0.9.1"
	Version010 Version = "v0.10"
)
