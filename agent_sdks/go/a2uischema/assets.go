package a2uischema

import _ "embed"

var (
	//go:embed schemas/v0_9/server_to_client.json
	serverToClientV09 []byte

	//go:embed schemas/v0_9/common_types.json
	commonTypesV09 []byte

	//go:embed schemas/v0_9/basic_catalog.json
	basicCatalogV09 []byte

	//go:embed schemas/v0_9/basic_catalog_rules.txt
	basicCatalogRulesV09 string

	//go:embed schemas/v0_9_1/server_to_client.json
	serverToClientV091 []byte

	//go:embed schemas/v0_9_1/common_types.json
	commonTypesV091 []byte

	//go:embed schemas/v0_9_1/basic_catalog.json
	basicCatalogV091 []byte

	//go:embed schemas/v0_9_1/basic_catalog_rules.txt
	basicCatalogRulesV091 string

	//go:embed schemas/v0_10/server_to_client.json
	serverToClientV010 []byte

	//go:embed schemas/v0_10/common_types.json
	commonTypesV010 []byte

	//go:embed schemas/v0_10/basic_catalog.json
	basicCatalogV010 []byte

	//go:embed schemas/v0_10/basic_catalog_rules.txt
	basicCatalogRulesV010 string
)
