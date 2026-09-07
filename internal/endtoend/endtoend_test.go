// Package endtoend verifies the plugin protocol using an installed sqlc binary.
package endtoend

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestPlugins runs the same compiler requests through the native process and
// WASI entry points. It checks every output byte, including runtime modules,
// without assuming that building a .wasm file proves sqlc can execute it.
// External tools are opt-in so ordinary library tests stay offline and fast.
func TestPlugins(t *testing.T) {
	if os.Getenv("SQLC_TEST_INTEGRATION") != "1" {
		t.Skip("set SQLC_TEST_INTEGRATION=1 to test installed sqlc process and WASI plugins")
	}
	sqlc := os.Getenv("SQLC")
	if sqlc == "" {
		sqlc = "sqlc"
	}
	if _, err := exec.LookPath(sqlc); err != nil {
		t.Fatal("integration requested but sqlc is unavailable: ", err)
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	output := os.Getenv("SQLC_TEST_OUTPUT")
	if output == "" {
		output = t.TempDir()
	} else {
		output, err = filepath.Abs(output)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(output, 0755); err != nil {
			t.Fatal(err)
		}
	}
	goTool := filepath.Join(runtime.GOROOT(), "bin", "go")
	executable := filepath.Join(output, "plugin")
	wasm := filepath.Join(output, "plugin.wasm")
	run(t, root, []string{"CGO_ENABLED=0"}, goTool, "build", "-o", executable, "./plugin")
	run(t, root, []string{"GO=" + goTool}, filepath.Join(root, "scripts", "build-wasm.sh"), wasm)
	checkWire(t, root, executable, wasm)
	wasmBytes, err := os.ReadFile(wasm)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(wasmBytes)
	type testCase struct {
		Name, Engine, Runtime, Driver string
		Extra                         map[string]any
	}
	var cases []testCase
	for _, runtime := range []string{"node", "bun", "deno"} {
		for _, driver := range []string{"pg", "postgres", "mysql2", "better-sqlite3"} {
			engine := "postgresql"
			if driver == "mysql2" {
				engine = "mysql"
			}
			if driver == "better-sqlite3" {
				engine = "sqlite"
			}
			cases = append(cases, testCase{runtime + "-" + driver, engine, runtime, driver, nil})
		}
	}
	cases = append(cases,
		testCase{"embed-pg", "postgresql", "node", "pg", nil},
		testCase{"embed-sqlite", "sqlite", "node", "better-sqlite3", nil},
		testCase{"enum-pg", "postgresql", "node", "pg", nil},
		testCase{"enum-types-only", "postgresql", "node", "pg", map[string]any{"types_only": true}},
		testCase{"deno-db-sqlite", "sqlite", "deno", "@bonakodo/sqlite", nil},
		testCase{"native-db-sqlite", "sqlite", "deno", "@bonakodo/sqlite", map[string]any{"sqlite_type_mode": "native"}},
		testCase{"native-better-sqlite3", "sqlite", "node", "better-sqlite3", map[string]any{"sqlite_type_mode": "native"}},
		testCase{"undefined", "sqlite", "deno", "@bonakodo/sqlite", map[string]any{"emit_null_as_undefined": true, "emit_sql_as_const": false, "sqlite_type_mode": "native"}},
		testCase{"types-only", "sqlite", "deno", "@bonakodo/sqlite", map[string]any{"types_only": true}},
		testCase{"json-custom", "postgresql", "node", "pg", map[string]any{"overrides": []any{map[string]any{
			"column": "records.document", "ts_type": "Document", "import": map[string]any{"path": "../../../json_domain.ts", "name": "Document"},
		}}}},
		testCase{"json-types-only", "postgresql", "node", "pg", map[string]any{"types_only": true, "overrides": []any{map[string]any{
			"column": "records.document", "ts_type": "Document", "import": map[string]any{"path": "../../../json_domain.ts", "name": "Document"},
		}}}},
		testCase{"mysql-strings", "mysql", "node", "mysql2", map[string]any{"mysql2": map[string]any{"support_big_numbers": true, "big_number_strings": true}}},
		testCase{"mysql-mixed", "mysql", "node", "mysql2", map[string]any{"mysql2": map[string]any{"support_big_numbers": true}}},
	)
	var blocks []any
	for _, tc := range cases {
		options := map[string]any{"runtime": tc.Runtime, "driver": tc.Driver}
		for key, value := range tc.Extra {
			options[key] = value
		}
		fixturePath := filepath.Join(root, "internal", "endtoend", "testdata", tc.Engine)
		if tc.Name == "embed-pg" {
			fixturePath = filepath.Join(root, "internal", "codegen", "testdata", "stock_embed")
		} else if tc.Name == "embed-sqlite" {
			fixturePath = filepath.Join(root, "internal", "codegen", "testdata", "stock_embed_sqlite")
		} else if strings.HasPrefix(tc.Name, "enum-") {
			fixturePath = filepath.Join(root, "internal", "endtoend", "testdata", "enums")
		}
		fixture, err := filepath.Rel(output, fixturePath)
		if err != nil {
			t.Fatal(err)
		}
		blocks = append(blocks, map[string]any{"engine": tc.Engine, "schema": filepath.Join(fixture, "schema.sql"), "queries": filepath.Join(fixture, "query.sql"), "codegen": []any{
			map[string]any{"plugin": "typescript-wasm", "out": filepath.Join(tc.Name, "wasm"), "options": options},
			map[string]any{"plugin": "typescript-process", "out": filepath.Join(tc.Name, "process"), "options": options},
		}})
	}
	config := map[string]any{"version": "2", "plugins": []any{
		map[string]any{"name": "typescript-wasm", "wasm": map[string]any{"url": "file://" + filepath.ToSlash(wasm), "sha256": hex.EncodeToString(digest[:])}},
		map[string]any{"name": "typescript-process", "process": map[string]any{"cmd": executable}},
	}, "sql": blocks}
	configBytes, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(output, "sqlc.json")
	if err := os.WriteFile(configPath, configBytes, 0644); err != nil {
		t.Fatal(err)
	}
	run(t, root, nil, sqlc, "version")
	run(t, root, nil, sqlc, "generate", "-f", configPath)
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			want := files(t, filepath.Join(output, tc.Name, "process"))
			got := files(t, filepath.Join(output, tc.Name, "wasm"))
			if len(want) != len(got) {
				t.Fatalf("file count: process=%d wasm=%d", len(want), len(got))
			}
			if len(got) < 3 {
				t.Fatalf("expected model, query, and index files, got %d", len(got))
			}
			for name, contents := range want {
				if !bytes.Equal(contents, got[name]) {
					t.Errorf("process and WASI differ: %s", name)
				}
			}
			if tc.Extra["types_only"] == true {
				if _, ok := got["runtime.ts"]; ok {
					t.Error("types_only emitted runtime.ts")
				}
				if bytes.Contains(got["query_sql.ts"], []byte("export function")) {
					t.Error("types_only emitted query functions")
				}
			}
			if strings.HasPrefix(tc.Name, "enum-") {
				if _, ok := got["enums.ts"]; !ok {
					t.Error("catalog enums did not produce enums.ts")
				}
			}
		})
	}
	for _, driver := range []string{"pg", "postgres", "mysql2", "better-sqlite3"} {
		t.Run("node-bun-identical/"+driver, func(t *testing.T) {
			node := files(t, filepath.Join(output, "node-"+driver, "wasm"))
			bun := files(t, filepath.Join(output, "bun-"+driver, "wasm"))
			if len(node) != len(bun) {
				t.Fatal("Node and Bun emitted different file counts")
			}
			for name, contents := range node {
				if !bytes.Equal(contents, bun[name]) {
					t.Errorf("Node and Bun differ: %s", name)
				}
			}
		})
	}
	t.Logf("generated %d driver/options cases in %s", len(cases), output)
}

func run(t *testing.T, dir string, env []string, name string, args ...string) {
	t.Helper()
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%s %s: %v\n%s", name, strings.Join(args, " "), err, output)
	}
	if len(output) != 0 {
		t.Log(strings.TrimSpace(string(output)))
	}
}

func files(t *testing.T, dir string) map[string][]byte {
	t.Helper()
	result := map[string][]byte{}
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		name, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		result[name], err = os.ReadFile(path)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}
