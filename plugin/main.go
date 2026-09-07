// Command sqlc-gen-typescript-native runs the TypeScript generator through
// sqlc's plugin protocol. The same command builds for native hosts and WASI.
package main

import (
	"github.com/sqlc-dev/plugin-sdk-go/codegen"

	typescript "github.com/bonakodo/sqlc-gen-typescript-native"
)

func main() {
	codegen.Run(typescript.Generate)
}
