package endtoend

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/testpb"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

// These checks run the exact optimized artifact, including TinyGo's runtime.
// Inputs and outputs use the independent upstream protobuf implementation.
func checkWire(t *testing.T, root, native, wasm string) {
	t.Helper()
	valid, err := proto.Marshal(&testpb.GenerateRequest{
		Settings: &testpb.Settings{Engine: "sqlite"}, Catalog: &testpb.Catalog{DefaultSchema: "main"},
		PluginOptions: []byte(`{"driver":"better-sqlite3"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	unknown := protowire.AppendVarint(protowire.AppendTag(nil, 500, protowire.VarintType), 42)
	deep := []byte{}
	for range 100 {
		deep = protowire.AppendTag(deep, 500, protowire.StartGroupType)
	}
	for range 100 {
		deep = protowire.AppendTag(deep, 500, protowire.EndGroupType)
	}
	for _, target := range []struct {
		name    string
		command []string
	}{
		{"native", []string{native}},
		{"tinygo", []string{"node", filepath.Join(root, "scripts/wasi-run.mjs"), wasm}},
	} {
		t.Run("wire/"+target.name, func(t *testing.T) {
			for _, tc := range []struct {
				name   string
				input  []byte
				method string
				valid  bool
			}{
				{"valid", valid, "/plugin.CodegenService/Generate", true},
				{"unknown field", append(bytes.Clone(valid), unknown...), "", true},
				{"bad tag", []byte{0}, "", false},
				{"truncated message", []byte{10, 4, 1}, "", false},
				{"invalid utf8", []byte{10, 3, 18, 1, 255}, "", false},
				{"excessive nesting", deep, "", false},
				{"unknown method", valid, "/plugin.CodegenService/Other", false},
				{"invalid generator options", nil, "", false},
			} {
				t.Run(tc.name, func(t *testing.T) {
					args := append([]string(nil), target.command[1:]...)
					if tc.method != "" {
						args = append(args, tc.method)
					}
					cmd := exec.Command(target.command[0], args...)
					cmd.Env = append(os.Environ(), "NODE_NO_WARNINGS=1")
					cmd.Stdin = bytes.NewReader(tc.input)
					var stdout, stderr bytes.Buffer
					cmd.Stdout, cmd.Stderr = &stdout, &stderr
					err := cmd.Run()
					if tc.valid {
						if err != nil || stderr.Len() != 0 {
							t.Fatalf("run: %v: %s", err, &stderr)
						}
						var response testpb.GenerateResponse
						if err := proto.Unmarshal(stdout.Bytes(), &response); err != nil {
							t.Fatal(err)
						}
						if len(response.Files) != 2 {
							t.Fatalf("empty catalog should produce models and index, got %d files", len(response.Files))
						}
					} else {
						var exit *exec.ExitError
						if !errors.As(err, &exit) || exit.ExitCode() != 2 || stdout.Len() != 0 || !strings.Contains(stderr.String(), "error generating output:") {
							t.Fatalf("err=%v stdout=%q stderr=%q", err, &stdout, &stderr)
						}
					}
				})
			}
		})
	}
}
