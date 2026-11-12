module github.com/a2ui-project/a2ui/go/agent

go 1.26.0

require (
	github.com/a2ui-project/a2ui/go/core v0.1.0
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/kr/text v0.2.0 // indirect
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.3 // indirect
	golang.org/x/text v0.43.0 // indirect
)

replace github.com/a2ui-project/a2ui/go/core => ../core
