// Package transport implements sqlc's one-request stdin/stdout plugin protocol.
package transport

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/bonakodo/sqlc-gen-typescript-native/protocol"
)

type Handler func(context.Context, *protocol.GenerateRequest) (*protocol.GenerateResponse, error)

// Run writes only a serialized GenerateResponse to output. Errors go to
// diagnostics and return sqlc's usual plugin failure status, 2.
func Run(args []string, input io.Reader, output, diagnostics io.Writer, generate Handler) int {
	if err := run(args, input, output, generate); err != nil {
		fmt.Fprintln(diagnostics, "error generating output:", err)
		return 2
	}
	return 0
}

func run(args []string, input io.Reader, output io.Writer, generate Handler) error {
	if len(args) != 0 && strings.TrimPrefix(args[0], "/") != "plugin.CodegenService/Generate" {
		return fmt.Errorf("unknown method %q", args[0])
	}
	data, err := io.ReadAll(input)
	if err != nil {
		return err
	}
	var request protocol.GenerateRequest
	if err := request.Unmarshal(data); err != nil {
		return err
	}
	response, err := generate(context.Background(), &request)
	if err != nil {
		return err
	}
	if response == nil {
		return fmt.Errorf("generator returned no response")
	}
	data, err = response.Marshal()
	if err != nil {
		return err
	}
	n, err := output.Write(data)
	if err == nil && n != len(data) {
		return io.ErrShortWrite
	}
	return err
}
