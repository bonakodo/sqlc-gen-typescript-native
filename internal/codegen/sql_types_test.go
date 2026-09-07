package typescript

import (
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"
	"github.com/bonakodo/sqlc-gen-typescript-native/protocol"
)

// driverTypeModule resolves types in isolation from SQL and query emission.
func driverTypeModule(driver, engine string) *module {
	g := &generator{
		request: &protocol.GenerateRequest{
			Settings: &protocol.Settings{Engine: engine},
			Catalog:  &protocol.Catalog{DefaultSchema: "public"},
		},
		options: opts.Options{Runtime: "deno", Driver: driver},
	}
	return g.newModule("queries.ts")
}

// TestDriverScalarTypes fixes result types to actual driver defaults, including
// types for which pg and postgres.js use distinct parsers.
func TestDriverScalarTypes(t *testing.T) {
	for _, test := range []struct{ driver, engine, sql, kind, typ string }{
		{"pg", "postgresql", "int2", "number", "number"},
		{"pg", "postgresql", "pg_catalog.int4", "number", "number"},
		{"pg", "postgresql", "int8", "string", "string"},
		{"pg", "postgresql", "numeric(30, 8)", "string", "string"},
		{"pg", "postgresql", "bytea", "buffer", "_sqlcImportBuffer"},
		{"pg", "postgresql", "bool", "boolean", "boolean"},
		{"pg", "postgresql", "timestamptz", "date", "Date"},
		{"pg", "postgresql", "timetz", "string", "string"},
		{"pg", "postgresql", "jsonb", "json", "_sqlcImportJsonValue"},
		{"pg", "postgresql", "point", "point", "{ x: number; y: number }"},
		{"pg", "postgresql", "circle", "circle", "{ x: number; y: number; radius: number }"},
		{"pg", "postgresql", "interval", "interval", "_sqlcImportIPostgresInterval"},
		{"postgres", "postgresql", "int8", "string", "string"},
		{"postgres", "postgresql", "interval", "string", "string"},
		{"postgres", "postgresql", "point", "string", "string"},
		{"postgres", "postgresql", "time", "string", "string"},
		{"mysql2", "mysql", "tinyint", "number", "number"},
		{"mysql2", "mysql", "boolean", "number", "number"},
		{"mysql2", "mysql", "bigint unsigned", "number", "number"},
		{"mysql2", "mysql", "decimal(30, 8)", "string", "string"},
		{"mysql2", "mysql", "date", "date", "Date"},
		{"mysql2", "mysql", "time", "string", "string"},
		{"mysql2", "mysql", "bit", "buffer", "_sqlcImportBuffer"},
		{"mysql2", "mysql", "json", "json", "_sqlcImportJsonValue"},
		{"mysql2", "mysql", "geometry", "unknown", "unknown"},
		{"@bonakodo/sqlite", "sqlite", "INTEGER", "sqlite-integer", "number | bigint"},
		{"better-sqlite3", "sqlite", "INTEGER", "number", "number"},
		{"better-sqlite3", "sqlite", "boolean", "boolean", "boolean"},
		{"better-sqlite3", "sqlite", "date", "date", "Date"},
		{"better-sqlite3", "sqlite", "char(12)", "string", "string"},
		{"better-sqlite3", "sqlite", "blob", "bytes", "_sqlcImportBuffer"},
	} {
		t.Run(test.driver+"/"+test.sql, func(t *testing.T) {
			m := driverTypeModule(test.driver, test.engine)
			value, err := m.resolveType(&protocol.Column{Name: "value", Type: &protocol.Identifier{Name: test.sql}, NotNull: true}, false)
			if err != nil {
				t.Fatal(err)
			}
			if test.kind == "interval" && !strings.Contains(m.source(), `from "postgres-interval"`) {
				t.Fatalf("interval type does not use a bare import:\n%s", m.source())
			}
			if value.kind != test.kind || value.typeName != test.typ {
				t.Fatalf("type = %s / %s, want %s / %s", value.kind, value.typeName, test.kind, test.typ)
			}
		})
	}
}

// TestMySQLBigNumberTypes mirrors the connection's two independent settings.
func TestMySQLBigNumberTypes(t *testing.T) {
	for _, test := range []struct {
		options   opts.MySQL2Options
		kind, typ string
	}{
		{opts.MySQL2Options{}, "number", "number"},
		{opts.MySQL2Options{BigNumberStrings: true}, "number", "number"},
		{opts.MySQL2Options{SupportBigNumbers: true}, "number-or-string", "number | string"},
		{opts.MySQL2Options{SupportBigNumbers: true, BigNumberStrings: true}, "string", "string"},
	} {
		m := driverTypeModule("mysql2", "mysql")
		m.gen.options.MySQL2 = test.options
		kind, typ := m.mysqlType(&protocol.Column{Type: &protocol.Identifier{Name: "bigint"}})
		if kind != test.kind || typ != test.typ {
			t.Errorf("%+v: got %s / %s, want %s / %s", test.options, kind, typ, test.kind, test.typ)
		}
	}
}

// TestPostgresArrayTypes distinguishes native arrays from expanded slices,
// preserves rank and element nulls, and checks pg's numeric array parser quirk.
func TestPostgresArrayTypes(t *testing.T) {
	for _, driver := range []string{"pg", "postgres"} {
		m := driverTypeModule(driver, "postgresql")
		value, err := m.resolveType(&protocol.Column{Type: &protocol.Identifier{Name: "int8"}, IsArray: true, ArrayDims: 2}, false)
		if err != nil {
			t.Fatal(err)
		}
		if got := m.typeText(value); got != "ReadonlyArray<ReadonlyArray<string | null> | null> | null" {
			t.Fatalf("array type = %q", got)
		}
		if got := m.encode(value, "args.ids"); !strings.Contains(got, `("string", args.ids, 2)`) {
			t.Fatalf("array encoder = %s", got)
		}
		m.gen.options.EmitNullAsUndefined = true
		if got := m.typeText(value); got != "ReadonlyArray<ReadonlyArray<string | undefined> | undefined> | undefined" {
			t.Fatalf("undefined array type = %q", got)
		}
		_, err = m.resolveType(&protocol.Column{Type: &protocol.Identifier{Name: "int4"}, IsSqlcSlice: true, NotNull: true}, false)
		if err == nil || !strings.Contains(err.Error(), "ANY($1::type[])") {
			t.Fatalf("PostgreSQL sqlc.slice requires an actionable error, got %v", err)
		}
		value, err = m.resolveType(&protocol.Column{Type: &protocol.Identifier{Name: "numeric"}, IsArray: true, NotNull: true}, false)
		if err != nil {
			t.Fatal(err)
		}
		want := "string"
		if driver == "pg" {
			want = "number"
		}
		if value.kind != want || value.typeName != want {
			t.Fatalf("%s numeric[] = %+v", driver, value)
		}
	}
}

// TestCatalogEnumTypes checks shared schema-qualified aliases and enum arrays.
func TestCatalogEnumTypes(t *testing.T) {
	m := driverTypeModule("pg", "postgresql")
	m.gen.request.Catalog.Schemas = []*protocol.Schema{
		{Name: "public", Enums: []*protocol.Enum{{Name: "state", Vals: []string{"open", "has\"quote", "open"}}}},
		{Name: "archive", Enums: []*protocol.Enum{{Name: "state", Vals: []string{"closed"}}}},
	}
	if err := m.gen.buildEnums(); err != nil {
		t.Fatal(err)
	}
	value, err := m.resolveType(&protocol.Column{Type: &protocol.Identifier{Name: "state"}, NotNull: true, IsArray: true}, false)
	if err != nil {
		t.Fatal(err)
	}
	if got := m.typeText(value); got != `ReadonlyArray<_sqlcImportState | null>` {
		t.Fatalf("enum array type = %q", got)
	}
	value, err = m.resolveType(&protocol.Column{Type: &protocol.Identifier{Schema: "archive", Name: "state"}, NotNull: true}, false)
	if err != nil || value.typeName != `_sqlcImportArchiveState` {
		t.Fatalf("schema-qualified enum = %+v, %v", value, err)
	}
}

// TestDriverTypeImports omits driver-specific types replaced by codec overrides
// and aliases the remaining types when declarations reserve their public names.
func TestDriverTypeImports(t *testing.T) {
	m := driverTypeModule("pg", "postgresql")
	m.names["Buffer"] = true
	value, err := m.resolveType(&protocol.Column{Type: &protocol.Identifier{Name: "bytea"}, NotNull: true}, false)
	if err != nil || value.typeName == "Buffer" {
		t.Fatalf("Buffer import did not avoid a declaration: %+v, %v", value, err)
	}
	if !strings.Contains(m.source(), `from "node:buffer"`) {
		t.Fatalf("missing Buffer import: %s", m.source())
	}
	m = driverTypeModule("pg", "postgresql")
	m.gen.options.Overrides = []opts.Override{{DBType: "bytea", TSType: "string", Codec: &opts.Import{Path: "./codecs.ts", Name: "hex"}}}
	if _, err := m.resolveType(&protocol.Column{Type: &protocol.Identifier{Name: "bytea"}, NotNull: true}, false); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(m.source(), "node:buffer") {
		t.Fatalf("replaced binary type imported Buffer: %s", m.source())
	}
}

// TestArrayCodecs applies custom conversion to each non-null scalar element.
func TestArrayCodecs(t *testing.T) {
	m := driverTypeModule("pg", "postgresql")
	m.gen.options.Overrides = []opts.Override{{DBType: "int8", TSType: "bigint", Codec: &opts.Import{Path: "./codecs.ts", Name: "bigInteger"}}}
	value, err := m.resolveType(&protocol.Column{Type: &protocol.Identifier{Name: "int8"}, IsArray: true, NotNull: true}, false)
	if err != nil {
		t.Fatal(err)
	}
	if got := m.encode(value, "args.ids"); !strings.Contains(got, "EncodeArrayCustom") || !strings.Contains(got, "args.ids, 1, false)") {
		t.Fatalf("custom array encoder = %s", got)
	}
	if got := m.decode(value, "row[0]"); !strings.Contains(got, "DecodeArrayCustom<ReadonlyArray<bigint | null>>") {
		t.Fatalf("custom array decoder = %s", got)
	}
}

// TestSQLiteNativeTypes retains the source generator's application conversions
// only when callers select native mode explicitly.
func TestSQLiteNativeTypes(t *testing.T) {
	for _, driver := range []string{"@bonakodo/sqlite", "better-sqlite3"} {
		m := driverTypeModule(driver, "sqlite")
		m.gen.options.SQLiteTypeMode = "native"
		for _, test := range []struct{ sql, kind, typ string }{
			{"integer", "integer", "bigint"}, {"boolean", "boolean", "boolean"},
			{"date", "date", "Date"}, {"numeric", "number", "number"},
			{"blob", "bytes", "Uint8Array"}, {"json", "json", "Uint8Array"},
		} {
			value, err := m.resolveType(&protocol.Column{Type: &protocol.Identifier{Name: test.sql}, NotNull: true}, false)
			if err != nil || value.kind != test.kind || value.typeName != test.typ {
				t.Fatalf("%s %s = %+v, %v", driver, test.sql, value, err)
			}
		}
	}
}

// TestInvalidArrayDimensions rejects corrupt metadata before nested type output.
func TestInvalidArrayDimensions(t *testing.T) {
	m := driverTypeModule("pg", "postgresql")
	for _, dims := range []int32{-1, 7, 1<<31 - 1} {
		if _, err := m.resolveType(&protocol.Column{Type: &protocol.Identifier{Name: "int4"}, IsArray: true, ArrayDims: dims}, false); err == nil {
			t.Errorf("accepted invalid array rank %d", dims)
		}
	}
	if _, err := m.resolveType(&protocol.Column{Type: &protocol.Identifier{Name: "int4"}, IsArray: true, ArrayDims: 6}, false); err != nil {
		t.Fatalf("rejected PostgreSQL's maximum array rank: %v", err)
	}
}

// TestQualifiedDriverOverrides preserves the driver base import while applying
// a schema-qualified override that refines its runtime representation.
func TestQualifiedDriverOverrides(t *testing.T) {
	m := driverTypeModule("pg", "postgresql")
	m.gen.options.Overrides = []opts.Override{{
		DBType: "pg_catalog.bytea", TSType: "ImageBytes",
		Import: &opts.Import{Path: "./types.ts", Name: "ImageBytes"},
	}}
	value, err := m.resolveType(&protocol.Column{Type: &protocol.Identifier{Schema: "pg_catalog", Name: "bytea"}, NotNull: true}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(value.typeName, "_sqlcCompatible<_sqlcImportBuffer, _sqlcImportImageBytes>") {
		t.Fatalf("refined binary type = %s", value.typeName)
	}
	if !strings.Contains(m.source(), `from "node:buffer"`) || !strings.Contains(m.source(), `from "./types.ts"`) {
		t.Fatalf("refinement lost an import: %s", m.source())
	}
}
