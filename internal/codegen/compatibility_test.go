package typescript

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"
	"github.com/bonakodo/sqlc-gen-typescript-native/protocol"
)

// compatibilityRequest models the older plugin's common query shapes without
// selecting native migration options through the native-generator test helper.
func compatibilityRequest(options opts.Options) *protocol.GenerateRequest {
	engine, integer, placeholder := "sqlite", "integer", "?"
	switch options.DriverName() {
	case "pg", "postgres":
		engine, integer, placeholder = "postgresql", "int4", "$1"
	case "mysql2":
		engine, integer = "mysql", "int"
	}
	data, err := json.Marshal(options)
	if err != nil {
		panic(err)
	}
	return &protocol.GenerateRequest{
		Settings:      &protocol.Settings{Engine: engine},
		Catalog:       &protocol.Catalog{DefaultSchema: "public"},
		PluginOptions: data,
		Queries: []*protocol.Query{{
			Name: "GetAuthor", Filename: "query.sql", Cmd: ":one",
			Text:   "SELECT author_id, first_name, bio FROM authors WHERE author_id = " + placeholder,
			Params: []*protocol.Parameter{{Number: 1, Column: &protocol.Column{Name: "author_id", Type: &protocol.Identifier{Name: integer}, NotNull: true}}},
			Columns: []*protocol.Column{
				{Name: "author_id", Type: &protocol.Identifier{Name: integer}, NotNull: true},
				{Name: "first_name", Type: &protocol.Identifier{Name: "text"}, NotNull: true},
				{Name: "bio", Type: &protocol.Identifier{Name: "text"}},
			},
		}},
	}
}

// compatibilitySource obtains a generated public module and checks one output
// per filename, fixing the older plugin's duplicate-file response defect.
func compatibilitySource(t *testing.T, req *protocol.GenerateRequest) string {
	t.Helper()
	response, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, file := range response.Files {
		if seen[file.Name] {
			t.Fatalf("duplicate generated file %q", file.Name)
		}
		seen[file.Name] = true
	}
	return typesTestFile(t, response, "query_sql.ts")
}

// TestCompatibilityDefaultAPI preserves the old function, argument, row, SQL,
// and promise names across all supported runtime and driver pairs.
func TestCompatibilityDefaultAPI(t *testing.T) {
	for _, driver := range []string{"pg", "postgres", "mysql2", "better-sqlite3", "@bonakodo/sqlite"} {
		for _, runtime := range []string{"node", "bun", "deno"} {
			if driver == "@bonakodo/sqlite" && runtime != "deno" {
				continue
			}
			t.Run(runtime+"/"+driver, func(t *testing.T) {
				source := compatibilitySource(t, compatibilityRequest(opts.Options{Runtime: runtime, Driver: driver}))
				for _, want := range []string{
					"export const getAuthorQuery =", "export interface GetAuthorArgs", "export interface GetAuthorRow",
					"authorId:", "firstName:", "bio:", ", args: GetAuthorArgs)",
				} {
					if !strings.Contains(source, want) {
						t.Errorf("missing public API %q:\n%s", want, source)
					}
				}
				want := "export async function getAuthor(database:"
				result := "): Promise<GetAuthorRow | null>"
				if driver == "@bonakodo/sqlite" {
					want = "export function getAuthor(database:"
					result = "): GetAuthorRow | null"
				}
				if !strings.Contains(source, want) || !strings.Contains(source, result) {
					t.Fatalf("changed wrapper async/return contract:\n%s", source)
				}
				if strings.Contains(source, "args.author_id") || strings.Contains(source, "row.author_id") {
					t.Fatalf("SQL spelling leaked into application field access:\n%s", source)
				}
			})
		}
	}
}

// TestCompatibilityNames keeps valid legacy query identifiers while preserving
// existing camelCase properties in both driver and native value modes.
func TestCompatibilityNames(t *testing.T) {
	for _, native := range []bool{false, true} {
		options := opts.Options{Runtime: "deno", Driver: "@bonakodo/sqlite"}
		if native {
			options.SQLiteTypeMode = "native"
		}
		req := compatibilityRequest(options)
		req.Queries[0].Name = "Get_Author"
		req.Queries[0].Params[0].Column.Name = "authorID"
		req.Queries[0].Columns[0].Name = "authorID"
		req.Queries[0].Columns[1].Name = "firstName"
		req.Queries[0].Columns[2].Name = "odd-name"
		source := compatibilitySource(t, req)
		wants := []string{"get_Author(", "get_AuthorQuery", "Get_AuthorArgs", "Get_AuthorRow", "authorID:", "firstName:", `"odd-name":`}
		if native {
			wants = []string{"getAuthor(", "getAuthorQuery", "GetAuthorArgs", "GetAuthorRow", "authorID:", "firstName:", `"odd-name":`}
		}
		for _, want := range wants {
			if !strings.Contains(source, want) {
				t.Errorf("native=%t: missing %q:\n%s", native, want, source)
			}
		}
	}
}

// TestCompatibilityNoArgsAndNullPolicy keeps omitted argument objects distinct
// from optional nullable properties and uses the same policy in result types.
func TestCompatibilityNoArgsAndNullPolicy(t *testing.T) {
	for _, undefined := range []bool{false, true} {
		req := compatibilityRequest(opts.Options{Driver: "pg", EmitNullAsUndefined: undefined})
		req.Queries[0].Params[0].Column.NotNull = false
		req.Queries = append(req.Queries, &protocol.Query{
			Name: "ListAuthors", Filename: "query.sql", Cmd: ":many", Text: "SELECT author_id FROM authors",
			Columns: []*protocol.Column{{Name: "author_id", Type: &protocol.Identifier{Name: "int4"}, NotNull: true}},
		})
		source := compatibilitySource(t, req)
		if strings.Contains(source, "ListAuthorsArgs") || !strings.Contains(source, "): Promise<ListAuthorsRow[]>") {
			t.Fatalf("argument-free :many changed public API:\n%s", source)
		}
		arg, row, result := "authorId: number | null;", "bio: string | null;", "Promise<GetAuthorRow | null>"
		if undefined {
			arg, row, result = "authorId?: number | undefined;", "bio: string | undefined;", "Promise<GetAuthorRow | undefined>"
		}
		for _, want := range []string{arg, row, result} {
			if !strings.Contains(source, want) {
				t.Errorf("undefined=%t: missing %q:\n%s", undefined, want, source)
			}
		}
	}
}

// TestCompatibilityInsertIDTypes checks legacy insert IDs and the deliberate
// better-sqlite3 extension independently from native SQLite's exact bigint API.
func TestCompatibilityInsertIDTypes(t *testing.T) {
	for _, test := range []struct{ driver, runtime, mode, result string }{
		{"mysql2", "node", "", "Promise<number>"},
		{"@bonakodo/sqlite", "deno", "", "number"},
		{"@bonakodo/sqlite", "deno", "native", "bigint"},
		{"better-sqlite3", "node", "", "Promise<bigint>"},
		{"better-sqlite3", "node", "native", "bigint"},
	} {
		t.Run(test.driver+"/"+test.mode, func(t *testing.T) {
			req := compatibilityRequest(opts.Options{Runtime: test.runtime, Driver: test.driver, SQLiteTypeMode: test.mode})
			req.Queries[0].Name, req.Queries[0].Cmd, req.Queries[0].Columns = "CreateAuthor", ":execlastid", nil
			source := compatibilitySource(t, req)
			if !strings.Contains(source, "): "+test.result+" {") {
				t.Fatalf("insert ID result lost %s:\n%s", test.result, source)
			}
		})
	}
	for _, driver := range []string{"pg", "postgres"} {
		req := compatibilityRequest(opts.Options{Driver: driver})
		req.Queries[0].Cmd = ":execlastid"
		if response, err := Generate(context.Background(), req); err == nil || response != nil {
			t.Errorf("%s accepted unsupported :execlastid: %v", driver, err)
		}
	}
}

// TestCompatibilityJSONTypes strengthens parsed server JSON while retaining
// the SQLite driver's storage representation and nullable field spelling.
func TestCompatibilityJSONTypes(t *testing.T) {
	for _, driver := range []string{"pg", "postgres", "mysql2", "better-sqlite3", "@bonakodo/sqlite"} {
		runtime := "node"
		if driver == "@bonakodo/sqlite" {
			runtime = "deno"
		}
		req := compatibilityRequest(opts.Options{Runtime: runtime, Driver: driver})
		req.Queries[0].Columns = []*protocol.Column{{Name: "json_data", Type: &protocol.Identifier{Name: "json"}}}
		source := compatibilitySource(t, req)
		want := "jsonData: _sqlcImportJsonValue | null;"
		if driver == "better-sqlite3" || driver == "@bonakodo/sqlite" {
			want = "jsonData: any | null;"
		}
		if !strings.Contains(source, want) {
			t.Errorf("%s missing JSON type %q:\n%s", driver, want, source)
		}
	}
}

// TestCompatibilityOneMultiplicity ensures :one's documentation and generated
// guard both retain the old server contract. Runtime integration tests exercise
// the returned value with zero, one, and multiple actual result rows.
func TestCompatibilityOneMultiplicity(t *testing.T) {
	for _, driver := range []string{"pg", "postgres", "mysql2"} {
		source := compatibilitySource(t, compatibilityRequest(opts.Options{Driver: driver}))
		if !strings.Contains(source, "if (rows.length !== 1) return null;") {
			t.Errorf("%s :one no longer requires one row:\n%s", driver, source)
		}
		if strings.Contains(source, "@returns The first row") {
			t.Errorf("%s :one docs promise a first row for multiple matches", driver)
		}
	}
	for _, driver := range []string{"better-sqlite3", "@bonakodo/sqlite"} {
		source := compatibilitySource(t, compatibilityRequest(opts.Options{Runtime: "deno", Driver: driver}))
		if strings.Contains(source, "rows.length !== 1") || !strings.Contains(source, "@returns The first row") {
			t.Errorf("%s :one lost SQLite first-row behavior:\n%s", driver, source)
		}
	}
}
