package typescript

import (
	"fmt"
	"sort"
	"strings"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/tsast"
	"github.com/sqlc-dev/plugin-sdk-go/plugin"
)

// enumKey keeps schema and type names separate: quoted SQL identifiers may
// themselves contain dots and must not collide with qualified identifiers.
type enumKey struct {
	schema string
	name   string
}

// catalogEnum owns the two public names for a SQL enum and its ordered labels.
// Values are copied from the request so generation never changes catalog data.
type catalogEnum struct {
	key        enumKey
	name       string
	valuesName string
	values     []string
}

// buildEnums allocates names in a stable order, including enums unused by any
// query. Models keep their existing names. Both enum exports must avoid model,
// JSON helper, and other enum names because index.ts exports them together.
func (g *generator) buildEnums() error {
	names := newNameSet()
	for _, model := range g.models {
		names[model.name] = true
	}
	if g.request.Settings.Engine != "sqlite" {
		for _, name := range []string{"JsonValue", "JsonObject", "JsonArray"} {
			names[name] = true
		}
	}
	g.byEnum = map[enumKey]*catalogEnum{}
	for _, schema := range g.request.Catalog.Schemas {
		if schema.Name == "pg_catalog" || schema.Name == "information_schema" {
			continue
		}
		for _, entry := range schema.Enums {
			if entry == nil || entry.Name == "" {
				return fmt.Errorf("typescript: missing enum name in schema %q", schema.Name)
			}
			key := enumKey{schema: schema.Name, name: entry.Name}
			if g.byEnum[key] != nil {
				return fmt.Errorf("typescript: duplicate enum %q in schema %q", entry.Name, schema.Name)
			}
			enum := &catalogEnum{key: key}
			seen := map[string]bool{}
			for _, value := range entry.Vals {
				if !seen[value] {
					enum.values = append(enum.values, value)
					seen[value] = true
				}
			}
			g.enums = append(g.enums, enum)
			g.byEnum[key] = enum
		}
	}
	sort.Slice(g.enums, func(i, j int) bool {
		a, b := g.enums[i].key, g.enums[j].key
		if a.schema != b.schema {
			return a.schema < b.schema
		}
		return a.name < b.name
	})
	for _, enum := range g.enums {
		base := enum.key.name
		if enum.key.schema != "" && enum.key.schema != g.request.Catalog.DefaultSchema {
			base = enum.key.schema + "_" + base
		}
		base = declarationName(base)
		// Allocate the alias and value list as a pair. A prior table or enum
		// may occupy either name; suffix the alias until both names are free.
		name := base
		for n := 2; names[name] || names[name+"Values"]; n++ {
			name = fmt.Sprintf("%s_%d", base, n)
		}
		enum.name, enum.valuesName = name, name+"Values"
		names[enum.name], names[enum.valuesName] = true, true
	}
	return nil
}

// enumForColumn resolves modern schema metadata and older dotted type names.
// Prefer an exact catalog name before splitting dots so a quoted type name in
// the default schema retains its identity. Bare MySQL enum metadata, without
// catalog labels, continues to use the driver's string fallback.
func (g *generator) enumForColumn(column *plugin.Column) *catalogEnum {
	if column.GetType() == nil {
		return nil
	}
	name, schema := column.Type.Name, column.Type.Schema
	if schema != "" {
		return g.byEnum[enumKey{schema: schema, name: name}]
	}
	if enum := g.byEnum[enumKey{schema: g.request.Catalog.DefaultSchema, name: name}]; enum != nil {
		return enum
	}
	if dot := strings.LastIndexByte(name, '.'); dot >= 0 {
		return g.byEnum[enumKey{schema: name[:dot], name: name[dot+1:]}]
	}
	return nil
}

// emitEnum derives the union from a readonly tuple so runtime labels and static
// types have one definition. An empty catalog enum naturally derives never.
// These dependency-free values also remain available with types_only enabled.
func (m *module) emitEnum(enum *catalogEnum) {
	values := make([]string, len(enum.values))
	for i, value := range enum.values {
		values[i] = tsast.Quote(value)
	}
	m.body.Line("%s", tsast.Comment([]string{enum.valuesName + " lists the database labels for " + enum.key.schema + "." + enum.key.name + " in catalog order."}))
	m.body.Line("export const %s = [%s] as const;", enum.valuesName, strings.Join(values, ", "))
	m.body.Line("%s", tsast.Comment([]string{enum.name + " is a database label from " + enum.valuesName + "."}))
	m.body.Line("export type %s = (typeof %s)[number];", enum.name, enum.valuesName)
	m.body.Line("")
}
