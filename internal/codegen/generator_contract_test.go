package typescript

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/sqlc-dev/plugin-sdk-go/plugin"
	"google.golang.org/protobuf/proto"
)

// contractRequest keeps regression fixtures explicit about the driver contract.
func contractRequest(engine, driver string) *plugin.GenerateRequest {
	return &plugin.GenerateRequest{
		Settings:      &plugin.Settings{Engine: engine},
		Catalog:       &plugin.Catalog{DefaultSchema: "public"},
		PluginOptions: []byte(`{"runtime":"node","driver":"` + driver + `"}`),
	}
}

func contractFile(t *testing.T, response *plugin.GenerateResponse, name string) string {
	t.Helper()
	for _, file := range response.Files {
		if file.Name == name {
			return string(file.Contents)
		}
	}
	t.Fatalf("missing generated file %s", name)
	return ""
}

func TestGeneratorContractMySQLUsesPreparedBindings(t *testing.T) {
	req := contractRequest("mysql", "mysql2")
	req.Queries = []*plugin.Query{{
		Name: "StoreQuestion", Filename: "query.sql", Cmd: ":exec",
		Text: "INSERT INTO notes (label, data) VALUES ('?', ?) /* ? */",
		Params: []*plugin.Parameter{{Number: 1, Column: &plugin.Column{
			Name: "data", Type: &plugin.Identifier{Name: "json"}, NotNull: true,
		}}},
	}}
	response, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	// mysql2.query interpolates question marks inside strings and comments.
	// Only the prepared protocol leaves these literals and JSON values intact.
	query := contractFile(t, response, "query_sql.ts")
	if strings.Contains(query, "database.query") || !strings.Contains(query, "database.execute") {
		t.Fatalf("MySQL request uses text interpolation: %s", query)
	}
	if !strings.Contains(query, "VALUES ('?', ?) /* ? */") {
		t.Fatal("literal question marks changed during SQL generation")
	}
}

func TestGeneratorContractPostgreSQLExecHasNoUnusedResult(t *testing.T) {
	req := contractRequest("postgresql", "pg")
	req.Queries = []*plugin.Query{{Name: "DeleteAll", Filename: "query.sql", Cmd: ":exec", Text: "DELETE FROM notes"}}
	response, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	query := contractFile(t, response, "query_sql.ts")
	if strings.Contains(query, "const result =") {
		t.Fatal(":exec declares an unused result, which fails noUnusedLocals")
	}
}

func TestGeneratorContractPostgreSQLSharesBoundTypeAndValue(t *testing.T) {
	req := contractRequest("postgresql", "pg")
	req.Queries = []*plugin.Query{{
		Name: "DeleteOptional", Filename: "query.sql", Cmd: ":exec",
		Text: "DELETE FROM notes WHERE id = $2 OR $2 IS NULL OR tag = $1",
		Params: []*plugin.Parameter{
			{Number: 1, Column: &plugin.Column{Name: "tag", Type: &plugin.Identifier{Name: "text"}}},
			{Number: 2, Column: &plugin.Column{Name: "id", Type: &plugin.Identifier{Name: "int4"}}},
		},
	}}
	response, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	query := contractFile(t, response, "query_sql.ts")
	if !strings.Contains(query, "id = $1 OR $1 IS NULL OR tag = $2") ||
		!strings.Contains(query, "values: [_sqlcParam2, _sqlcParam1]") {
		t.Fatalf("PostgreSQL bind identity or order changed: %s", query)
	}
}

func TestGeneratorContractOutputPathsUseBothHostSeparators(t *testing.T) {
	for _, input := range []string{"../query.sql", `..\query.sql`, `nested\..\..\query.sql`, `/query.sql`, `\query.sql`, `C:\query.sql`, `C:query.sql`, "query\x00.sql"} {
		t.Run(input, func(t *testing.T) {
			req := contractRequest("postgresql", "pg")
			req.Queries = []*plugin.Query{{Name: "DeleteAll", Filename: input, Cmd: ":exec", Text: "DELETE FROM notes"}}
			response, err := Generate(context.Background(), req)
			if err == nil || response != nil {
				t.Fatalf("accepted unsafe cross-platform path %q", input)
			}
		})
	}
	for _, input := range []string{"nested/query.sql", `nested\query.sql`} {
		output, err := queryFilename(input)
		if err != nil || output != "nested/query_sql.ts" {
			t.Fatalf("safe cross-platform path %q became %q: %v", input, output, err)
		}
	}
}

func TestGeneratorContractModelCannotShadowArrayType(t *testing.T) {
	req := contractRequest("postgresql", "pg")
	req.Catalog.Schemas = []*plugin.Schema{{Name: "public", Tables: []*plugin.Table{{
		Rel:     &plugin.Identifier{Name: "readonly_arrays"},
		Columns: []*plugin.Column{{Name: "items", Type: &plugin.Identifier{Name: "int4"}, IsArray: true, NotNull: true}},
	}}}}
	response, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	models := contractFile(t, response, "models.ts")
	if strings.Contains(models, "interface ReadonlyArray {") || !strings.Contains(models, "interface ReadonlyArray_2 {") {
		t.Fatalf("model shadows the built-in array type: %s", models)
	}
}

func TestGeneratorContractRejectsEmbeddedCatalogColumns(t *testing.T) {
	req := contractRequest("postgresql", "pg")
	identity := &plugin.Identifier{Name: "items"}
	req.Catalog.Schemas = []*plugin.Schema{{Name: "public", Tables: []*plugin.Table{{
		Rel: identity, Columns: []*plugin.Column{{Name: "self", EmbedTable: identity}},
	}}}}
	response, err := Generate(context.Background(), req)
	if err == nil || response != nil || !strings.Contains(err.Error(), "cannot embed") {
		t.Fatalf("expected safe rejection of a recursive catalog: %v", err)
	}
}

// cancelDuringGeneration changes state between generator cancellation checks,
// making the final-check regression deterministic without timing-dependent work.
type cancelDuringGeneration struct {
	context.Context
	checks int
}

func (ctx *cancelDuringGeneration) Err() error {
	ctx.checks++
	if ctx.checks > 1 {
		return context.Canceled
	}
	return nil
}

func TestGeneratorContractCancellationDoesNotReturnPartialFiles(t *testing.T) {
	req := contractRequest("postgresql", "pg")
	ctx := &cancelDuringGeneration{Context: context.Background()}
	response, err := Generate(ctx, req)
	if !errors.Is(err, context.Canceled) || response != nil {
		t.Fatalf("cancelled generation returned files: response=%v, error=%v", response, err)
	}
}

func TestGeneratorContractGenerationLeavesCatalogAndQueryOrderIntact(t *testing.T) {
	req := contractRequest("postgresql", "pg")
	req.Catalog.Schemas = []*plugin.Schema{{Name: "public", Tables: []*plugin.Table{
		{Rel: &plugin.Identifier{Name: "zebras"}, Columns: []*plugin.Column{{Name: "id", Type: &plugin.Identifier{Name: "int4"}}}},
		{Rel: &plugin.Identifier{Name: "authors"}, Columns: []*plugin.Column{{Name: "id", Type: &plugin.Identifier{Name: "int4"}}}},
	}}}
	req.Queries = []*plugin.Query{
		{Name: "ZLast", Filename: "query.sql", Cmd: ":exec", Text: "DELETE FROM zebras"},
		{Name: "AFirst", Filename: "query.sql", Cmd: ":exec", Text: "DELETE FROM authors"},
	}
	before := proto.Clone(req)
	first, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(req, before) || !proto.Equal(first, second) {
		t.Fatal("generation changed shared catalog, query metadata, or stable output")
	}
}
