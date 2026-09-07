package typescript

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"
	"github.com/bonakodo/sqlc-gen-typescript-native/protocol"
)

// typesTestRequest creates an isolated SQLite catalog for generator type tests.
func typesTestRequest(options opts.Options) *protocol.GenerateRequest {
	if options.Runtime == "" {
		options.Runtime = "deno"
	}
	if options.Driver == "" {
		options.Driver = "@bonakodo/sqlite"
	}
	if options.SQLiteTypeMode == "" {
		options.SQLiteTypeMode = "native"
	}
	data, err := json.Marshal(options)
	if err != nil {
		panic(err)
	}
	return &protocol.GenerateRequest{
		Settings: &protocol.Settings{Engine: "sqlite"},
		Catalog: &protocol.Catalog{
			DefaultSchema: "main",
			Schemas: []*protocol.Schema{{Name: "main", Tables: []*protocol.Table{{
				Rel: &protocol.Identifier{Name: "users"},
				Columns: []*protocol.Column{
					{Name: "id", NotNull: true, Type: &protocol.Identifier{Name: "INTEGER"}},
					{Name: "created_at", Type: &protocol.Identifier{Name: "INTEGER"}},
				},
			}}}},
		},
		PluginOptions: data,
	}
}

// typesTestFile returns a generated module, failing if generation omitted it.
func typesTestFile(t *testing.T, response *protocol.GenerateResponse, name string) string {
	t.Helper()
	for _, file := range response.Files {
		if file.Name == name {
			return string(file.Contents)
		}
	}
	t.Fatalf("missing generated module %s", name)
	return ""
}

// TestColumnOverrideOriginalName verifies alias identity and column precedence.
func TestColumnOverrideOriginalName(t *testing.T) {
	g := generator{
		request: typesTestRequest(opts.Options{}),
		options: opts.Options{Overrides: []opts.Override{
			{DBType: "INTEGER", TSType: "number", Nullable: true},
			{Column: "users.created_*", TSType: "Date"},
		}},
	}
	column := &protocol.Column{
		Name: "createdAtAlias", OriginalName: "created_at",
		Table: &protocol.Identifier{Name: "users"}, Type: &protocol.Identifier{Name: "INTEGER"},
	}
	if got := g.columnOverride(column); got == nil || got.TSType != "Date" {
		t.Fatalf("alias column override = %v", got)
	}
	column.Table.Schema = "archive"
	if got := g.columnOverride(column); got == nil || got.TSType != "number" {
		t.Fatalf("two-part selector crossed schemas: %v", got)
	}
}

// TestDatabaseOverrideNullability keeps nullable and non-null type overrides apart.
func TestDatabaseOverrideNullability(t *testing.T) {
	g := generator{
		request: typesTestRequest(opts.Options{}),
		options: opts.Options{Overrides: []opts.Override{
			{DBType: "integer", TSType: "RequiredID"},
			{DBType: "integer", TSType: "OptionalID", Nullable: true},
		}},
	}
	column := &protocol.Column{Type: &protocol.Identifier{Name: "INTEGER"}}
	if got := g.columnOverride(column); got == nil || got.TSType != "OptionalID" {
		t.Fatalf("nullable override = %v", got)
	}
	column.NotNull = true
	if got := g.columnOverride(column); got == nil || got.TSType != "RequiredID" {
		t.Fatalf("non-null override = %v", got)
	}
}

// TestUnknownOverrideRequiresCodec prevents unknown from hiding an unchecked
// runtime representation change behind a vacuous TypeScript type constraint.
func TestUnknownOverrideRequiresCodec(t *testing.T) {
	for _, typeName := range []string{"Date", "Payload", "string", "{ value: number }"} {
		t.Run(typeName, func(t *testing.T) {
			req := typesTestRequest(opts.Options{Overrides: []opts.Override{{
				Column: "users.created_at", TSType: typeName,
			}}})
			req.Catalog.Schemas[0].Tables[0].Columns[1].Type.Name = "custom_storage"
			if _, err := Generate(context.Background(), req); err == nil || !strings.Contains(err.Error(), "requires a codec") {
				t.Fatalf("unknown override error = %v", err)
			}
		})
	}
}

// TestModelsOmitCodecValueImports prevents unused runtime imports in table models.
func TestModelsOmitCodecValueImports(t *testing.T) {
	req := typesTestRequest(opts.Options{Overrides: []opts.Override{{
		Column: "users.created_at", TSType: "Date", Codec: &opts.Import{Path: "./codecs.ts", Name: "dateCodec"},
	}}})
	response, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	models := typesTestFile(t, response, "models.ts")
	if strings.Contains(models, "dateCodec") || strings.Contains(models, "codecs.ts") {
		t.Fatalf("table model imported a runtime codec:\n%s", models)
	}
	if !strings.Contains(models, "createdAt: Date | null;") {
		t.Fatalf("table model lost the override type:\n%s", models)
	}
}

// TestTypesOnlyEmbedImports avoids imports needed solely by omitted row decoders.
func TestTypesOnlyEmbedImports(t *testing.T) {
	req := typesTestRequest(opts.Options{TypesOnly: true, Overrides: []opts.Override{{
		Column: "users.id", TSType: "UserID", Import: &opts.Import{Path: "./types.ts", Name: "UserID"},
	}}})
	req.Queries = []*protocol.Query{{
		Name: "GetUser", Cmd: ":one", Filename: "nested/users.sql", Text: "SELECT users.id, users.created_at FROM users",
		Columns: []*protocol.Column{{Name: "user", NotNull: true, EmbedTable: &protocol.Identifier{Name: "users"}}},
	}}
	response, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	source := typesTestFile(t, response, "nested/users_sql.ts")
	if strings.Contains(source, "UserID") || strings.Contains(source, "types.ts") || strings.Contains(source, "runtime.ts") {
		t.Fatalf("types-only embed imported decoder dependencies:\n%s", source)
	}
	if !strings.Contains(source, `from "../models.ts"`) {
		t.Fatalf("nested module did not import models from the output root:\n%s", source)
	}
	if strings.Contains(source, "SELECT") || strings.Contains(source, "function ") {
		t.Fatalf("types-only module contains runtime code:\n%s", source)
	}
}

// TestUnusedConfiguredTypeImport does not emit an import absent from ts_type.
func TestUnusedConfiguredTypeImport(t *testing.T) {
	req := typesTestRequest(opts.Options{TypesOnly: true, Overrides: []opts.Override{{
		Column: "users.id", TSType: "bigint", Import: &opts.Import{Path: "./types.ts", Name: "UnusedType"},
	}}})
	response, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	source := typesTestFile(t, response, "models.ts")
	if strings.Contains(source, "UnusedType") || strings.Contains(source, "types.ts") {
		t.Fatalf("unused configured import leaked into output:\n%s", source)
	}
}

// TestCodecImportsAvoidFunctionLocals prevents a local binding from hiding a codec.
func TestCodecImportsAvoidFunctionLocals(t *testing.T) {
	for _, codec := range []string{"args", "database", "stmt", "row", "rows", "_sqlcParam1"} {
		t.Run(codec, func(t *testing.T) {
			req := typesTestRequest(opts.Options{Overrides: []opts.Override{{
				Column: "users.created_at", TSType: "Date", Codec: &opts.Import{Path: "./codecs.ts", Name: codec},
			}}})
			req.Queries = []*protocol.Query{{
				Name: "GetDate", Cmd: ":one", Filename: "date.sql", Text: "SELECT created_at FROM users",
				Columns: []*protocol.Column{{Name: "created_at", Type: &protocol.Identifier{Name: "INTEGER"}, Table: &protocol.Identifier{Name: "users"}}},
			}}
			response, err := Generate(context.Background(), req)
			if err != nil {
				t.Fatal(err)
			}
			source := typesTestFile(t, response, "date_sql.ts")
			if !strings.Contains(source, codec+" as _sqlcImport") {
				t.Fatalf("codec import lacks a protected alias:\n%s", source)
			}
			if !strings.Contains(source, "DecodeCustom<Date | null>") {
				t.Fatalf("nullable codec result lost its generic type:\n%s", source)
			}
		})
	}
}

// TestTypeNullAndSliceWrapping preserves the scalar override inside each wrapper.
func TestTypeNullAndSliceWrapping(t *testing.T) {
	m := (&generator{options: opts.Options{}}).newModule("types.ts")
	value := valueType{typeName: "'draft' | 'live'", nullable: true, slice: true}
	if got := m.typeText(value); got != "ReadonlyArray<'draft' | 'live' | null>" {
		t.Fatalf("nullable slice type = %s", got)
	}
	m.gen.options.EmitNullAsUndefined = true
	if got := m.typeText(value); got != "ReadonlyArray<'draft' | 'live' | undefined>" {
		t.Fatalf("optional slice type = %s", got)
	}
}

// TestGenerationPreservesRequestAndOrder checks owned catalog copies and stability.
func TestGenerationPreservesRequestAndOrder(t *testing.T) {
	req := typesTestRequest(opts.Options{TypesOnly: true})
	before := req.Clone()
	first, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if !wireEqual(first, second) {
		t.Fatal("repeated generation changed the output")
	}
	if !wireEqual(req, before) {
		t.Fatal("generation changed the caller's request")
	}
}

// TestQueryFilenameURLCharacters rejects filenames that change import URL meaning.
func TestQueryFilenameURLCharacters(t *testing.T) {
	for _, name := range []string{"posts#archive.sql", "posts?old.sql", "posts%2Farchive.sql"} {
		if _, err := queryFilename(name); err == nil {
			t.Fatalf("URL-significant query filename accepted: %s", name)
		}
	}
	if got, err := queryFilename("nested/posts.sql"); err != nil || got != "nested/posts_sql.ts" {
		t.Fatalf("valid query filename = %q, %v", got, err)
	}
}

// TestIndexNamespacePreservesModel prevents a query namespace from hiding a
// same-named table model in the shared public index.
func TestIndexNamespacePreservesModel(t *testing.T) {
	req := typesTestRequest(opts.Options{})
	req.Queries = []*protocol.Query{{Name: "DeleteUsers", Cmd: ":exec", Filename: "user.sql", Text: "DELETE FROM users"}}
	response, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	index := typesTestFile(t, response, "index.ts")
	if !strings.Contains(index, "export * as User_2 from") {
		t.Fatalf("query namespace hides the User model:\n%s", index)
	}
}

// TestInvalidParameterMetadata rejects malformed direct requests before sorting
// or emitting an unused argument that would fail strict TypeScript checks.
func TestInvalidParameterMetadata(t *testing.T) {
	valid := &protocol.Parameter{Number: 1, Column: &protocol.Column{Name: "id"}}
	for _, params := range [][]*protocol.Parameter{{nil}, {valid, nil}, {valid}} {
		req := typesTestRequest(opts.Options{})
		req.Queries = []*protocol.Query{{
			Name: "DeleteUsers", Cmd: ":exec", Filename: "users.sql",
			Text: "DELETE FROM users", Params: params,
		}}
		if _, err := Generate(context.Background(), req); err == nil {
			t.Fatalf("accepted invalid parameter metadata: %v", params)
		}
	}
}

// TestDenoBareImports covers query imports, runtime imports, and type hints for
// every driver, including legacy options that carry registry prefixes and pins.
func TestDenoBareImports(t *testing.T) {
	for _, test := range []struct{ driver, specifier, types string }{
		{"jsr:@bonakodo/sqlite@0.1.0", "@bonakodo/sqlite", ""},
		{"npm:pg@8.16.3", "pg", "@types/pg"},
		{"npm:postgres@3.4.9", "postgres", ""},
		{"npm:mysql2@3.24.3/promise", "mysql2/promise", ""},
		{"npm:better-sqlite3@13.0.3", "better-sqlite3", "@types/better-sqlite3"},
	} {
		t.Run(test.driver, func(t *testing.T) {
			req := compatibilityRequest(opts.Options{Runtime: "deno", Driver: test.driver})
			response, err := Generate(context.Background(), req)
			if err != nil {
				t.Fatal(err)
			}
			for _, file := range response.Files {
				source := string(file.Contents)
				if strings.Contains(source, "jsr:") || strings.Contains(source, "npm:") {
					t.Errorf("%s contains a registry prefix:\n%s", file.Name, source)
				}
			}
			runtime := typesTestFile(t, response, "runtime.ts")
			if !strings.Contains(runtime, `from "`+test.specifier+`"`) {
				t.Errorf("runtime does not import %s:\n%s", test.specifier, runtime)
			}
			if test.types != "" && !strings.Contains(runtime, `// @deno-types="`+test.types+`"`) {
				t.Errorf("runtime does not map type package %s:\n%s", test.types, runtime)
			}
			if test.specifier == "@bonakodo/sqlite" {
				query := typesTestFile(t, response, "query_sql.ts")
				if !strings.Contains(query, `from "@bonakodo/sqlite"`) {
					t.Errorf("query does not import the bare SQLite package:\n%s", query)
				}
			}
		})
	}
}

// FuzzGenerateDeterministic exercises names, comments, and type imports through
// complete types-only generation. It checks that each response has valid UTF-8,
// repeated calls return the same result, and neither call changes compiler input.
func FuzzGenerateDeterministic(f *testing.F) {
	f.Add("users", "user_id", "GetUsers", "A documented field.", "./types/value.ts")
	f.Add("利用者", "表示名", "利用者一覧", "説明 */ export const injected = 1;\u2028次", "./型/値.ts")
	f.Add("User", "__proto__", "user", "Comment\r\nnext line", "../types/user.ts")
	f.Add("e\u0301", "camelCase_name", "ImportedValue", "`${value}` and \\slashes", "./type\"name.ts")
	f.Add("\xfftable", "\xfefield", "\xfdquery", "\xfccomment", "./\xfbtype.ts")
	f.Fuzz(func(t *testing.T, tableName, columnName, queryName, comment, importPath string) {
		if len(tableName)+len(columnName)+len(queryName)+len(comment)+len(importPath) > 8192 {
			t.Skip()
		}
		if queryName == "" {
			queryName = "Query"
		}
		if importPath == "" {
			importPath = "./types.ts"
		}
		req := typesTestRequest(opts.Options{TypesOnly: true, Overrides: []opts.Override{{
			DBType: "TEXT", Nullable: true, TSType: "ImportedValue",
			Import: &opts.Import{Path: importPath, Name: "ImportedValue"},
		}}})
		table := req.Catalog.Schemas[0].Tables[0]
		table.Rel.Name = tableName
		table.Comment = comment
		table.Columns = []*protocol.Column{
			{Name: columnName, Comment: comment, Type: &protocol.Identifier{Name: "TEXT"}},
			{Name: columnName, Comment: comment, Type: &protocol.Identifier{Name: "TEXT"}},
		}
		for _, filename := range []string{"query.sql", "nested/query.sql"} {
			req.Queries = append(req.Queries, &protocol.Query{
				Name: queryName, Cmd: ":one", Filename: filename,
				Text: "SELECT 1, 2", Comments: []string{comment},
				Columns: []*protocol.Column{
					{Name: columnName, Comment: comment, Type: &protocol.Identifier{Name: "TEXT"}},
					{Name: columnName, Comment: comment, Type: &protocol.Identifier{Name: "TEXT"}},
				},
			})
		}
		before := req.Clone()
		first, firstErr := Generate(context.Background(), req)
		second, secondErr := Generate(context.Background(), req)
		if !wireEqual(req, before) {
			t.Fatal("generation changed the compiler request")
		}
		if (firstErr == nil) != (secondErr == nil) || firstErr != nil && firstErr.Error() != secondErr.Error() {
			t.Fatalf("generation returned inconsistent errors: %v, %v", firstErr, secondErr)
		}
		if !wireEqual(first, second) {
			t.Fatal("generation returned different files for the same request")
		}
		if firstErr != nil {
			return
		}
		for _, file := range first.Files {
			if !utf8.ValidString(file.Name) || !utf8.Valid(file.Contents) {
				t.Fatalf("generated file %q contains invalid UTF-8", file.Name)
			}
		}
	})
}
