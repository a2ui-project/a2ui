module github.com/a2ui-project/a2ui/go/a2aext

go 1.26.0

require (
	github.com/a2aproject/a2a-go v0.3.15
	github.com/a2ui-project/a2ui/go/agent v0.1.0
	github.com/a2ui-project/a2ui/go/core v0.1.0
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/google/uuid v1.6.0 // indirect
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.3 // indirect
	golang.org/x/text v0.43.0 // indirect
)

replace (
	github.com/a2ui-project/a2ui/go/agent => ../agent
	github.com/a2ui-project/a2ui/go/core => ../core
)
