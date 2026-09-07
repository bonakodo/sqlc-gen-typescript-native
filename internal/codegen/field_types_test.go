package typescript

import (
	"context"
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"
	"github.com/sqlc-dev/plugin-sdk-go/plugin"
)

// TestFieldNamesAcrossDrivers checks arguments, rows, and catalog models together.
// A fix confined to interface declarations would leave argument access or the
// constructed row using a different name. Snake case must still normalize, and
// names that normalize to the same property must remain distinct.
func TestFieldNamesAcrossDrivers(t *testing.T) {
	for _, driver := range []string{"pg", "postgres", "mysql2", "better-sqlite3", "@bonakodo/sqlite"} {
		t.Run(driver, func(t *testing.T) {
			req := compatibilityRequest(opts.Options{Runtime: "deno", Driver: driver})
			query := req.Queries[0]
			query.Params[0].Column.Name = "authorID"
			query.Columns = []*plugin.Column{
				{Name: "firstName", Type: &plugin.Identifier{Name: "text"}, NotNull: true},
				{Name: "first_name", Type: &plugin.Identifier{Name: "text"}, NotNull: true},
				{Name: "LAST_NAME", Type: &plugin.Identifier{Name: "text"}, NotNull: true},
			}
			req.Catalog.Schemas = []*plugin.Schema{{Name: "public", Tables: []*plugin.Table{{
				Rel: &plugin.Identifier{Name: "authors"}, Columns: query.Columns,
			}}}}
			response, err := Generate(context.Background(), req)
			if err != nil {
				t.Fatal(err)
			}
			source := typesTestFile(t, response, "query_sql.ts")
			if !strings.Contains(source, "authorID:") || !strings.Contains(source, "args.authorID") {
				t.Fatalf("camelCase argument was changed:\n%s", source)
			}
			for _, name := range []string{"firstName", "firstName_2", "lastName"} {
				if strings.Count(source, name+":") != 2 {
					t.Errorf("row declaration and value must both use %s:\n%s", name, source)
				}
				models := typesTestFile(t, response, "models.ts")
				if !strings.Contains(models, name+": string;") {
					t.Errorf("model lost property %s:\n%s", name, models)
				}
			}
		})
	}
}

// TestSQLiteTextAffinity checks both drivers and declared text spellings. The
// driver returns text for these columns, so generated arguments must reject
// arbitrary objects and result properties must expose string methods safely.
func TestSQLiteTextAffinity(t *testing.T) {
	for _, driver := range []string{"better-sqlite3", "@bonakodo/sqlite"} {
		for _, declaration := range []string{"TEXT", "varchar(255)", "Character(12)", "NCHAR", "NATIVE CHARACTER", "varying character", "CLOB", "NVARCHAR"} {
			t.Run(driver+"/"+declaration, func(t *testing.T) {
				req := compatibilityRequest(opts.Options{Runtime: "deno", Driver: driver})
				query := req.Queries[0]
				column := &plugin.Column{Name: "displayName", Type: &plugin.Identifier{Name: declaration}}
				query.Params[0].Column = column
				query.Columns = []*plugin.Column{column}
				source := compatibilitySource(t, req)
				if strings.Count(source, "displayName: string | null;") != 2 {
					t.Fatalf("text arguments and results must use string:\n%s", source)
				}
				if !strings.Contains(source, `("string", args.displayName`) {
					t.Fatalf("text binding bypassed its string check:\n%s", source)
				}
			})
		}
	}
}
