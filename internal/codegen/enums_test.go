package typescript

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"
	"github.com/bonakodo/sqlc-gen-typescript-native/protocol"
)

// enumRequest includes shared column metadata, an unused enum, and an empty
// enum. PostgreSQL allows creating an enum with no labels before ALTER TYPE.
func enumRequest(options opts.Options) *protocol.GenerateRequest {
	req := compatibilityRequest(options)
	column := &protocol.Column{Name: "status", Type: &protocol.Identifier{Name: "status"}, NotNull: true}
	req.Catalog.Schemas = []*protocol.Schema{{Name: "public",
		Enums: []*protocol.Enum{
			{Name: "status", Vals: []string{"active", "has\"quote", "active", "", "line\nbreak", "${value}`\\", "日本語"}},
			{Name: "unused", Vals: []string{"unused"}},
			{Name: "empty"},
		},
		Tables: []*protocol.Table{{Rel: &protocol.Identifier{Name: "accounts"}, Columns: []*protocol.Column{column}}},
	}}
	req.Queries[0].Filename = "nested/status.sql"
	req.Queries[0].Params[0].Column = column
	req.Queries[0].Columns = []*protocol.Column{column}
	return req
}

// TestEnumExports proves that catalog enums have one source of labels, with
// type-only imports in every consuming module and no new driver dependencies.
func TestEnumExports(t *testing.T) {
	for _, driver := range []string{"pg", "postgres", "mysql2"} {
		for _, typesOnly := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/typesOnly=%t", driver, typesOnly), func(t *testing.T) {
				req := enumRequest(opts.Options{Driver: driver, TypesOnly: typesOnly})
				before := req.Clone()
				response, err := Generate(context.Background(), req)
				if err != nil {
					t.Fatal(err)
				}
				if !wireEqual(before, req) {
					t.Fatal("enum generation mutated the request")
				}
				enums := typesTestFile(t, response, "enums.ts")
				for _, want := range []string{
					`export const StatusValues = ["active", "has\"quote", "", "line\nbreak", "${value}` + "`" + `\\", "日本語"] as const;`,
					`export type Status = (typeof StatusValues)[number];`,
					`export const UnusedValues = ["unused"] as const;`,
					`export const EmptyValues = [] as const;`,
					`export type Empty = (typeof EmptyValues)[number];`,
				} {
					if !strings.Contains(enums, want) {
						t.Errorf("missing %q:\n%s", want, enums)
					}
				}
				for _, filename := range []string{"models.ts", "nested/status_sql.ts"} {
					source := typesTestFile(t, response, filename)
					path := "./enums.ts"
					if strings.Contains(filename, "/") {
						path = "../enums.ts"
					}
					for _, want := range []string{`import type { Status as _sqlcImportStatus } from "` + path + `";`, "status: _sqlcImportStatus;"} {
						if !strings.Contains(source, want) {
							t.Errorf("%s missing %q:\n%s", filename, want, source)
						}
					}
				}
				if !strings.Contains(typesTestFile(t, response, "index.ts"), `export * from "./enums.ts";`) {
					t.Fatal("index omitted enum values or types")
				}
				if strings.Contains(enums, "import ") {
					t.Fatalf("enum lists depend on other modules:\n%s", enums)
				}
			})
		}
	}
}

// TestEnumNamesAvoidExportCollisions reserves both names of each enum before
// allocating query namespaces. Sorting makes the names independent of catalog
// order, while labels retain the database's declared order.
func TestEnumNamesAvoidExportCollisions(t *testing.T) {
	req := enumRequest(opts.Options{Driver: "pg", TypesOnly: true})
	req.Catalog.Schemas[0].Tables = append(req.Catalog.Schemas[0].Tables,
		&protocol.Table{Rel: &protocol.Identifier{Name: "statuses"}},
	)
	req.Catalog.Schemas[0].Enums = []*protocol.Enum{
		{Name: "status", Vals: []string{"active"}},
		{Name: "status_values", Vals: []string{"listed"}},
		{Name: "a", Vals: []string{"first"}},
		{Name: "a_values", Vals: []string{"second"}},
		{Name: "json_value", Vals: []string{"json"}},
		{Name: "date", Vals: []string{"today"}},
	}
	req.Queries[0].Filename = "status_values"
	first, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	enums := typesTestFile(t, first, "enums.ts")
	for _, want := range []string{"export type Status_2 =", "export const Status_2Values =", "export type Date_2 =", "export type JsonValue_2 =", "export const AValues =", "export type AValues_2 ="} {
		if !strings.Contains(enums, want) {
			t.Errorf("missing collision-safe declaration %q:\n%s", want, enums)
		}
	}
	if strings.Contains(typesTestFile(t, first, "index.ts"), "export type * as StatusValues from") {
		t.Fatal("query namespace shadows an enum type")
	}
	entries := req.Catalog.Schemas[0].Enums
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}
	second, err := Generate(context.Background(), req)
	if err != nil || !wireEqual(first, second) {
		t.Fatalf("enum catalog order changed output: %v", err)
	}
}

// TestEnumTypeIdentity distinguishes same-named types in different schemas and
// supports both explicit metadata and older schema-prefixed type names.
func TestEnumTypeIdentity(t *testing.T) {
	m := driverTypeModule("pg", "postgresql")
	m.gen.request.Catalog.Schemas = []*protocol.Schema{
		{Name: "public", Enums: []*protocol.Enum{{Name: "status", Vals: []string{"active"}}, {Name: "has.dot", Vals: []string{"dot"}}}},
		{Name: "archive", Enums: []*protocol.Enum{{Name: "status", Vals: []string{"archived"}}}},
	}
	if err := m.gen.buildEnums(); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ schema, name, want string }{
		{"", "status", "_sqlcImportStatus"},
		{"public", "status", "_sqlcImportStatus"},
		{"archive", "status", "_sqlcImportArchiveStatus"},
		{"", "archive.status", "_sqlcImportArchiveStatus"},
		{"", "has.dot", "_sqlcImportHasDot"},
		{"public", "has.dot", "_sqlcImportHasDot"},
		{"unknown", "status", "string"},
	} {
		value, err := m.resolveType(&protocol.Column{Type: &protocol.Identifier{Schema: test.schema, Name: test.name}, NotNull: true, IsArray: true}, false)
		if err != nil || value.typeName != test.want || m.typeText(value) != "ReadonlyArray<"+test.want+" | null>" {
			t.Errorf("%s.%s = %+v, %v", test.schema, test.name, value, err)
		}
	}
}

// TestEnumOverridesImportOnlyUsedTypes keeps codec replacements free of unused
// enum imports while retaining the base enum constraint for static refinements.
func TestEnumOverridesImportOnlyUsedTypes(t *testing.T) {
	for _, codec := range []bool{false, true} {
		override := opts.Override{DBType: "status", TSType: `"active"`}
		if codec {
			override.TSType = "number"
			override.Codec = &opts.Import{Path: "./codec.ts", Name: "statusCode"}
		}
		req := enumRequest(opts.Options{Driver: "pg", Overrides: []opts.Override{override}})
		response, err := Generate(context.Background(), req)
		if err != nil {
			t.Fatal(err)
		}
		for _, filename := range []string{"models.ts", "nested/status_sql.ts"} {
			source := typesTestFile(t, response, filename)
			if codec && strings.Contains(source, "enums.ts") {
				t.Errorf("codec replacement retained an unused enum import:\n%s", source)
			}
			if !codec && !strings.Contains(source, `_sqlcCompatible<_sqlcImportStatus, "active">`) {
				t.Errorf("static refinement lost the enum constraint:\n%s", source)
			}
		}
	}
}
