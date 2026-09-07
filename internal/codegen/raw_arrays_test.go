package typescript

import (
	"reflect"
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"
	"github.com/sqlc-dev/plugin-sdk-go/plugin"
)

// TestPostgresRawArrayResults preserves array NULL spelling while keeping each
// scalar column's configured driver parser, including parsers returning null.
func TestPostgresRawArrayResults(t *testing.T) {
	for _, command := range []string{":one", ":many"} {
		t.Run(command, func(t *testing.T) {
			req := compatibilityRequest(opts.Options{Driver: "postgres"})
			req.Queries[0].Cmd = command
			req.Queries[0].Columns = []*plugin.Column{
				{Name: "id", Type: &plugin.Identifier{Name: "int4"}, NotNull: true},
				{Name: "labels", Type: &plugin.Identifier{Name: "text"}, IsArray: true, NotNull: true},
				{Name: "document", Type: &plugin.Identifier{Name: "jsonb"}, NotNull: true},
				{Name: "amounts", Type: &plugin.Identifier{Name: "numeric"}, IsArray: true},
			}
			source := compatibilitySource(t, req)
			for _, want := range []string{
				").raw();", "result.columns.length !== 4", "const column = result.columns[index];",
				"if (value === null) return null;", `value.toString("utf8")`,
				"if (index === 1 || index === 3) return text;", "return column.parser ? column.parser(text) : text;",
			} {
				if !strings.Contains(source, want) {
					t.Errorf("missing raw-array behavior %q:\n%s", want, source)
				}
			}
			if strings.Contains(source, ").values();") || strings.Contains(source, "parser(text) ??") || strings.Contains(source, ".parsers[") {
				t.Fatalf("raw-array query changes parser scope or parsed nulls:\n%s", source)
			}
		})
	}
}

// TestPostgresRawArrayScope leaves scalar result queries and all pg queries on
// their existing driver APIs. Array parameters alone do not require raw results.
func TestPostgresRawArrayScope(t *testing.T) {
	for _, driver := range []string{"postgres", "pg"} {
		req := compatibilityRequest(opts.Options{Driver: driver})
		req.Queries[0].Params[0].Column.IsArray = true
		source := compatibilitySource(t, req)
		if strings.Contains(source, ").raw();") {
			t.Fatalf("%s selected raw rows without result arrays:\n%s", driver, source)
		}
		if driver == "postgres" && !strings.Contains(source, ").values();") {
			t.Fatalf("scalar postgres.js query lost its value API:\n%s", source)
		}
		if driver == "pg" {
			req.Queries[0].Columns[0].IsArray = true
			source = compatibilitySource(t, req)
			if strings.Contains(source, ").raw();") || !strings.Contains(source, "database.query(") {
				t.Fatalf("pg result arrays changed driver APIs:\n%s", source)
			}
		}
	}
}

// TestRawArrayColumnIndices follows nested embeds exactly, including scalar
// columns before and after each embedded model and multidimensional arrays.
func TestRawArrayColumnIndices(t *testing.T) {
	fields := []field{
		{value: valueType{kind: "number"}},
		{children: []field{
			{value: valueType{arrayDims: 1}},
			{children: []field{{value: valueType{kind: "date"}}, {value: valueType{arrayDims: 2}}}},
		}},
		{value: valueType{arrayDims: 1}},
	}
	if got, want := rawArrayColumnIndices(fields), []int{1, 3, 4}; !reflect.DeepEqual(got, want) {
		t.Fatalf("raw array indices = %v, want %v", got, want)
	}
	if got := rawArrayColumnIndices(nil); len(got) != 0 {
		t.Fatalf("empty result fields produced indices %v", got)
	}
}

// TestPostgresEmbeddedRawArrayResults checks the emitted physical positions for
// an embedded table and confirms raw rows still feed the ordinary nested decoder.
func TestPostgresEmbeddedRawArrayResults(t *testing.T) {
	req := compatibilityRequest(opts.Options{Driver: "postgres"})
	req.Catalog.Schemas = []*plugin.Schema{{Name: "public", Tables: []*plugin.Table{{
		Rel: &plugin.Identifier{Schema: "public", Name: "records"},
		Columns: []*plugin.Column{
			{Name: "id", Type: &plugin.Identifier{Name: "int4"}, NotNull: true},
			{Name: "labels", Type: &plugin.Identifier{Name: "text"}, IsArray: true},
		},
	}}}}
	req.Queries[0].Columns = []*plugin.Column{
		{Name: "prefix", Type: &plugin.Identifier{Name: "text"}, NotNull: true},
		{Name: "record", EmbedTable: &plugin.Identifier{Schema: "public", Name: "records"}, NotNull: true},
		{Name: "suffix", Type: &plugin.Identifier{Name: "int4"}, NotNull: true},
	}
	source := compatibilitySource(t, req)
	for _, want := range []string{"result.columns.length !== 4", "if (index === 2) return text;", "record: {", "row[2]"} {
		if !strings.Contains(source, want) {
			t.Errorf("embedded array query lost %q:\n%s", want, source)
		}
	}
}

// TestRawArrayCodecKind retains the default scalar parser contract before a
// custom codec receives elements from an unparsed postgres.js array result.
func TestRawArrayCodecKind(t *testing.T) {
	req := compatibilityRequest(opts.Options{Driver: "postgres", Overrides: []opts.Override{{
		DBType: "int4", TSType: "string", Codec: &opts.Import{Path: "./codec.ts", Name: "idCodec"},
	}}})
	req.Queries[0].Columns = []*plugin.Column{{Name: "ids", Type: &plugin.Identifier{Name: "int4"}, IsArray: true, NotNull: true}}
	source := compatibilitySource(t, req)
	req.Queries[0].Params[0].Column.IsArray = true
	source = compatibilitySource(t, req)
	if !strings.Contains(source, `(_sqlcImportIdCodec, "number", args.authorId, 1, false)`) {
		t.Fatalf("array codec encoder lost its scalar kind:\n%s", source)
	}
	if !strings.Contains(source, `(_sqlcImportIdCodec, "number", row[0], 1, false, false)`) {
		t.Fatalf("raw array codec lost its scalar kind:\n%s", source)
	}
}
