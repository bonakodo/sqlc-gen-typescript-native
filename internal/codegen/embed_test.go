package typescript

import (
	"context"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"
	"github.com/bonakodo/sqlc-gen-typescript-native/internal/testpb"
	"github.com/bonakodo/sqlc-gen-typescript-native/protocol"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// TestStockEmbedNullability uses metadata captured from released sqlc, including
// its missing embed nullability. Keeping the real request avoids accidentally
// testing only a patched host's richer metadata again.
func TestStockEmbedNullability(t *testing.T) {
	data, err := os.ReadFile("testdata/stock_embed/request.json")
	if err != nil {
		t.Fatal(err)
	}
	req := new(protocol.GenerateRequest)
	var reference testpb.GenerateRequest
	if err := protojson.Unmarshal(data, &reference); err != nil {
		t.Fatal(err)
	}
	wire, err := proto.Marshal(&reference)
	if err != nil {
		t.Fatal(err)
	}
	if err := req.Unmarshal(wire); err != nil {
		t.Fatal(err)
	}
	before := req.Clone()
	g := &generator{request: req, options: opts.Options{Driver: "pg"}, byTable: map[string]*model{}}
	if err := g.buildModels(); err != nil {
		t.Fatal(err)
	}
	m := g.newModule("query_sql.ts")
	want := map[string][]bool{
		"InnerScores": {true, true}, "LeftScores": {true, false},
		"RightScores": {false, true}, "FullScores": {false, false},
		"AliasScores": {true, false}, "SelfJoin": {true, false},
	}
	for _, query := range req.Queries {
		t.Run(query.Name, func(t *testing.T) {
			columns := m.embedColumns(query)
			var got []bool
			for _, column := range columns {
				got = append(got, column.NotNull)
			}
			if !reflect.DeepEqual(got, want[query.Name]) {
				t.Fatalf("embedded relation nullability = %v; want %v", got, want[query.Name])
			}
		})
	}
	response, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	source := typesTestFile(t, response, "query_sql.ts")
	inner := source[strings.Index(source, "export interface InnerScoresRow"):]
	inner = inner[:strings.Index(inner, "\n}")]
	for _, want := range []string{"students: _sqlcImportStudent;", "testScores: _sqlcImportTestScore;"} {
		if !strings.Contains(inner, want) {
			t.Errorf("inner join lost model assignability: %s", inner)
		}
	}
	// A required relation does not make its nullable catalog fields required.
	if !strings.Contains(source, `nickname: _sqlcImportDecodeValue<string | null>("string", row[2], true, false)`) {
		t.Fatal("inner join discarded catalog column nullability")
	}
	if !wireEqual(req, before) {
		t.Fatal("embed inference mutated the caller's request")
	}
}

func TestEmbedJoinParser(t *testing.T) {
	for _, tt := range []struct {
		name, sql string
		want      map[string]bool
	}{
		{"inner", "SELECT a.id, b.id FROM a INNER JOIN b ON a.id=b.id", map[string]bool{"a": true, "b": true}},
		{"left", "SELECT a.id, b.id FROM a LEFT OUTER JOIN b USING (id)", map[string]bool{"a": true, "b": false}},
		{"right", "SELECT a.id, b.id FROM a RIGHT JOIN b ON a.id=b.id", map[string]bool{"a": false, "b": true}},
		{"full", "SELECT a.id, b.id FROM a FULL OUTER JOIN b ON a.id=b.id", map[string]bool{"a": false, "b": false}},
		{"cross", "SELECT a.id FROM a CROSS JOIN b, c", map[string]bool{"a": true, "b": true, "c": true}},
		{"natural", "SELECT a.id FROM a NATURAL LEFT JOIN b", map[string]bool{"a": true, "b": false}},
		{"nested right", "SELECT a.id FROM (a LEFT JOIN b ON a.id=b.id) RIGHT JOIN c ON a.id=c.id", map[string]bool{"a": false, "b": false, "c": true}},
		{"nested left", "SELECT a.id FROM a LEFT JOIN (b JOIN c ON b.id=c.id) ON a.id=b.id", map[string]bool{"a": true, "b": false, "c": false}},
		{"right precedence", "SELECT a.id FROM a, b RIGHT JOIN c ON b.id=c.id", map[string]bool{"a": true, "b": false, "c": true}},
		{"quoted", `SELECT "Left".id FROM "table" AS "Left" LEFT JOIN b AS "join" ON true`, map[string]bool{"Left": true, "join": false}},
		{"comments", "/* LEFT JOIN missing */ SELECT a.id FROM a -- RIGHT JOIN ignored\n JOIN b ON b.id=a.id /* outer /* nested */ join */", map[string]bool{"a": true, "b": true}},
		{"strings", "SELECT $$FROM fake LEFT JOIN a$$, a.id FROM a JOIN b ON b.name = E'left \\' join' WHERE a.id IN (SELECT id FROM c)", map[string]bool{"a": true, "b": true}},
		{"predicate function", "SELECT a.id FROM a JOIN b ON left(a.name, 1) = right(b.name, 1)", map[string]bool{"a": true, "b": true}},
		{"derived", "SELECT a.id FROM (SELECT * FROM a) AS a", nil},
		{"cte", "WITH a AS (SELECT * FROM b) SELECT a.id FROM a", nil},
		{"union", "SELECT a.id FROM a UNION SELECT a.id FROM a RIGHT JOIN b ON true", nil},
		{"union all", "SELECT a.id FROM a UNION ALL SELECT null", nil},
		{"function", "SELECT a.id FROM a LEFT JOIN generate_series(1,2) b ON true", nil},
		{"lateral", "SELECT a.id FROM a, LATERAL (SELECT 1) b", nil},
		{"join alias", "SELECT all_tables.id FROM (a JOIN b ON true) all_tables", nil},
		{"table alias columns", "SELECT a.id FROM a AS b (id)", nil},
		{"sample", "SELECT a.id FROM a TABLESAMPLE SYSTEM (1)", nil},
		{"only", "SELECT a.id FROM ONLY a", nil},
		{"multiple statements", "SELECT a.id FROM a; SELECT b.id FROM b", nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			tokens, ok := embedTokens(tt.sql, "postgresql")
			if !ok {
				t.Fatal("invalid test SQL")
			}
			relations, _, ok := selectEmbedRelations(tokens, "postgresql")
			if !ok {
				if tt.want != nil {
					t.Fatal("supported join was not recognized")
				}
				return
			}
			if tt.want == nil {
				t.Fatal("unsupported query must retain conservative nullability")
			}
			got := map[string]bool{}
			for _, relation := range relations {
				got[relation.alias] = relation.required
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("relations = %v; want %v", got, tt.want)
			}
		})
	}
}

func TestEmbedRichMetadata(t *testing.T) {
	for _, engine := range []string{"postgresql", "sqlite", "mysql"} {
		t.Run(engine, func(t *testing.T) {
			req := compatibilityRequest(opts.Options{Driver: "pg"})
			req.Settings.Engine = engine
			req.Catalog.Schemas = []*protocol.Schema{{Name: "public", Tables: []*protocol.Table{{
				Rel:     &protocol.Identifier{Name: "students"},
				Columns: []*protocol.Column{{Name: "id", NotNull: true, Type: &protocol.Identifier{Name: "integer"}}},
			}}}}
			g := &generator{request: req, options: opts.Options{Driver: "pg"}, byTable: map[string]*model{}}
			if err := g.buildModels(); err != nil {
				t.Fatal(err)
			}
			m := g.newModule("query_sql.ts")
			for _, column := range []*protocol.Column{
				{Name: "student", EmbedTable: &protocol.Identifier{Name: "students"}, Table: &protocol.Identifier{Name: "students"}},
				{Name: "student", EmbedTable: &protocol.Identifier{Name: "students"}, TableAlias: "students"},
			} {
				query := &protocol.Query{Text: "SELECT students.id FROM students", Columns: []*protocol.Column{column}}
				if m.embedColumns(query)[0].NotNull {
					t.Fatal("inference replaced the host's explicit nullable metadata")
				}
			}
			column := &protocol.Column{Name: "student", EmbedTable: &protocol.Identifier{Name: "students"}, NotNull: true}
			query := &protocol.Query{Text: "WITH students AS (SELECT 1) SELECT * FROM students", Columns: []*protocol.Column{column}}
			if !m.embedColumns(query)[0].NotNull {
				t.Fatal("unsupported SQL discarded the host's explicit non-null metadata")
			}
		})
	}
}

// TestPostgreSQLSliceDiagnostic prevents an apparently valid array interface
// from generating IN ($1), which PostgreSQL treats as one scalar expression.
func TestPostgreSQLSliceDiagnostic(t *testing.T) {
	for _, driver := range []string{"pg", "postgres"} {
		for _, typesOnly := range []bool{false, true} {
			req := compatibilityRequest(opts.Options{Driver: driver, TypesOnly: typesOnly})
			req.Queries[0].Text = "SELECT author_id, first_name, bio FROM authors WHERE author_id IN ($1)"
			req.Queries[0].Params[0].Column.IsSqlcSlice = true
			response, err := Generate(context.Background(), req)
			if response != nil || err == nil || !strings.Contains(err.Error(), "sqlc.slice") || !strings.Contains(err.Error(), "ANY($1::type[])") {
				t.Fatalf("driver=%s typesOnly=%v: expected actionable slice error, got response=%v err=%v", driver, typesOnly, response, err)
			}
		}
	}
}

// TestEmbedSQLiteJoinPrecedence checks the difference that matters for null
// extension: SQLite joins the accumulated comma-list before a later RIGHT/FULL
// JOIN, whereas PostgreSQL/MySQL bind the explicit join more tightly.
func TestEmbedSQLiteJoinPrecedence(t *testing.T) {
	for _, tt := range []struct {
		sql           string
		sqlite, other map[string]bool
	}{
		{"SELECT a.id FROM a, b RIGHT JOIN c ON b.id=c.id", map[string]bool{"a": false, "b": false, "c": true}, map[string]bool{"a": true, "b": false, "c": true}},
		{"SELECT a.id FROM a, b FULL JOIN c ON b.id=c.id", map[string]bool{"a": false, "b": false, "c": false}, map[string]bool{"a": true, "b": false, "c": false}},
		{"SELECT a.id FROM (a, b) RIGHT JOIN c ON b.id=c.id", map[string]bool{"a": false, "b": false, "c": true}, map[string]bool{"a": false, "b": false, "c": true}},
		{"SELECT a.id FROM a, (b RIGHT JOIN c ON b.id=c.id)", map[string]bool{"a": true, "b": false, "c": true}, map[string]bool{"a": true, "b": false, "c": true}},
		{"SELECT a.id FROM a LEFT JOIN b ON a.id=b.id, c RIGHT JOIN d ON c.id=d.id", map[string]bool{"a": false, "b": false, "c": false, "d": true}, map[string]bool{"a": true, "b": false, "c": false, "d": true}},
	} {
		for _, engine := range []string{"sqlite", "postgresql", "mysql"} {
			t.Run(engine+"/"+tt.sql, func(t *testing.T) {
				tokens, ok := embedTokens(tt.sql, engine)
				if !ok {
					t.Fatal("invalid test SQL")
				}
				relations, _, ok := selectEmbedRelations(tokens, engine)
				if !ok {
					t.Fatal("supported join was not recognized")
				}
				got := map[string]bool{}
				for _, relation := range relations {
					got[relation.alias] = relation.required
				}
				want := tt.other
				if engine == "sqlite" {
					want = tt.sqlite
				}
				if !reflect.DeepEqual(got, want) {
					t.Errorf("relations = %v; want %v", got, want)
				}
			})
		}
	}
}
