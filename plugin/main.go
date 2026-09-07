// Command sqlc-gen-typescript-native runs the TypeScript generator through
// sqlc's plugin protocol. The same command builds for native hosts and WASI.
package main

import (
	"os"

	typescript "github.com/bonakodo/sqlc-gen-typescript-native"
	"github.com/bonakodo/sqlc-gen-typescript-native/internal/transport"
)

func main() {
	os.Exit(transport.Run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr, typescript.Generate))
}
