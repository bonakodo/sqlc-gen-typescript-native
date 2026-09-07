package typescript

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"
	"github.com/bonakodo/sqlc-gen-typescript-native/protocol"
)

// TestServerJSONTypes keeps JSON null within the type even for SQL NOT NULL,
// while SQL-null policy controls the separate nullable-column alternative.
func TestServerJSONTypes(t *testing.T) {
	for _, driver := range []string{"pg", "postgres", "mysql2"} {
		for _, undefined := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/undefined=%t", driver, undefined), func(t *testing.T) {
				req := compatibilityRequest(opts.Options{Driver: driver, TypesOnly: true, EmitNullAsUndefined: undefined})
				req.Queries[0].Columns = []*protocol.Column{
					{Name: "required", Type: &protocol.Identifier{Name: "json"}, NotNull: true},
					{Name: "optional", Type: &protocol.Identifier{Name: "json"}},
				}
				response, err := Generate(context.Background(), req)
				if err != nil {
					t.Fatal(err)
				}
				source := typesTestFile(t, response, "query_sql.ts")
				missing := "null"
				if undefined {
					missing = "undefined"
				}
				for _, want := range []string{"required: _sqlcImportJsonValue;", "optional: _sqlcImportJsonValue | " + missing + ";", `from "./json.ts"`} {
					if !strings.Contains(source, want) {
						t.Errorf("missing %q:\n%s", want, source)
					}
				}
				jsonTypes := typesTestFile(t, response, "json.ts")
				for _, want := range []string{"export type JsonValue =", "| null", "export interface JsonObject", "export type JsonArray = JsonValue[];"} {
					if !strings.Contains(jsonTypes, want) {
						t.Errorf("missing recursive JSON definition %q:\n%s", want, jsonTypes)
					}
				}
				for _, file := range response.Files {
					if file.Name == "runtime.ts" || strings.Contains(string(file.Contents), "node:") {
						t.Errorf("types_only JSON imported a runtime dependency in %s", file.Name)
					}
				}
			})
		}
	}
}

// TestJSONStaticOverride permits an imported interface without requiring an
// index signature or a codec. Parsing and SQL-null handling still use JSON's
// built-in converters, while only a configured codec can validate the shape.
func TestJSONStaticOverride(t *testing.T) {
	for _, driver := range []string{"pg", "postgres", "mysql2"} {
		for _, typesOnly := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/typesOnly=%t", driver, typesOnly), func(t *testing.T) {
				req := compatibilityRequest(opts.Options{Driver: driver, TypesOnly: typesOnly, Overrides: []opts.Override{{
					DBType: "json", TSType: "Document", Import: &opts.Import{Path: "./domain.ts", Name: "Document"},
				}}})
				query := req.Queries[0]
				query.Filename = "nested/query.sql"
				query.Columns = []*protocol.Column{{Name: "document", Type: &protocol.Identifier{Name: "json"}, NotNull: true}}
				query.Params[0].Column = &protocol.Column{Name: "document", Type: &protocol.Identifier{Name: "json"}, NotNull: true}
				response, err := Generate(context.Background(), req)
				if err != nil {
					t.Fatal(err)
				}
				source := typesTestFile(t, response, "nested/query_sql.ts")
				for _, want := range []string{`Document as _sqlcImportDocument`, `from "../domain.ts"`, "document: _sqlcImportDocument;", "static contract"} {
					if !strings.Contains(source, want) {
						t.Errorf("missing %q:\n%s", want, source)
					}
				}
				if strings.Contains(source, "_sqlcCompatible") || strings.Contains(source, "JsonValue") {
					t.Errorf("JSON shape was constrained to an index signature:\n%s", source)
				}
				if !typesOnly && (!strings.Contains(source, `("json", args.document, false)`) || !strings.Contains(source, `>("json", row[0], false, false)`)) {
					t.Errorf("static shape override changed JSON runtime conversion:\n%s", source)
				}
			})
		}
	}
}

// TestJSONHelpersAvoidModelCollision keeps all barrel exports valid when a
// table would otherwise have the same name as a recursive JSON helper type.
func TestJSONHelpersAvoidModelCollision(t *testing.T) {
	req := compatibilityRequest(opts.Options{Driver: "pg", TypesOnly: true})
	req.Catalog.Schemas = []*protocol.Schema{{Name: "public", Tables: []*protocol.Table{{
		Rel:     &protocol.Identifier{Name: "json_values"},
		Columns: []*protocol.Column{{Name: "document", Type: &protocol.Identifier{Name: "jsonb"}, NotNull: true}},
	}}}}
	response, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	models := typesTestFile(t, response, "models.ts")
	if strings.Contains(models, "export interface JsonValue {") {
		t.Fatalf("model shadows public JsonValue helper:\n%s", models)
	}
	if !strings.Contains(typesTestFile(t, response, "index.ts"), `export type { JsonValue, JsonObject, JsonArray } from "./json.ts";`) {
		t.Fatal("barrel omitted public JSON helpers")
	}
}
