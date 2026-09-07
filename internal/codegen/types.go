package typescript

import (
	"fmt"
	"strings"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"
	"github.com/bonakodo/sqlc-gen-typescript-native/internal/tsast"
	"github.com/sqlc-dev/plugin-sdk-go/plugin"
	"github.com/sqlc-dev/plugin-sdk-go/sdk"
)

// valueType describes the declared application type and its runtime conversion.
type valueType struct {
	// typeName is the validated non-null, non-slice application type.
	typeName string
	// kind selects the built-in SQL value conversion.
	kind string
	// codec identifies an optional custom conversion; imports wait until use.
	codec *opts.Import
	// nullable allows SQL NULL, including an outer join's absent values.
	nullable bool
	// arrayDims records native PostgreSQL dimensions, distinct from expanded
	// SQLite/MySQL sqlc.slice parameters. SQL array elements may contain NULL.
	arrayDims int
	// slice wraps the application value in a bound sqlc.slice array.
	slice bool
	// jsonStatic records a codec-free JSON shape supplied by the application.
	// The shape is a TypeScript contract, not a runtime schema validator.
	jsonStatic bool
}

// field describes a named argument, model member, or nested query result.
type field struct {
	// name is the allocated TypeScript property key.
	name string
	// column supplies source identity and SQL documentation.
	column *plugin.Column
	// value defines the field's application type and conversion.
	value valueType
	// children expands an embedded table into positional result columns.
	children []field
}

// sqliteKind mirrors Go's SQLite mappings using TypeScript's native value types.
func sqliteKind(column *plugin.Column) (string, string) {
	name := strings.ToLower(column.GetType().GetName())
	if i := strings.IndexByte(name, '('); i >= 0 {
		name = name[:i]
	}
	name = strings.Join(strings.Fields(name), "")
	switch name {
	case "int", "integer", "tinyint", "smallint", "mediumint", "bigint", "unsignedbigint", "int2", "int8":
		return "integer", "bigint"
	case "real", "double", "doubleprecision", "float", "decimal", "numeric":
		return "number", "number"
	case "boolean", "bool":
		return "boolean", "boolean"
	case "date", "datetime", "timestamp":
		return "date", "Date"
	case "blob":
		return "bytes", "Uint8Array"
	case "json", "jsonb":
		return "json", "Uint8Array"
	case "text", "char", "clob":
		return "string", "string"
	}
	for _, prefix := range []string{"character", "varchar", "varyingcharacter", "nchar", "nativecharacter", "nvarchar"} {
		if strings.HasPrefix(name, prefix) {
			return "string", "string"
		}
	}
	return "unknown", "unknown"
}

// columnOverride finds the first column override, then the first matching type
// override. Catalog identity and OriginalName survive aliases and generated names.
func (g *generator) columnOverride(column *plugin.Column) *opts.Override {
	name := column.GetOriginalName()
	if name == "" {
		name = column.GetName()
	}
	for i := range g.options.Overrides {
		o := &g.options.Overrides[i]
		if o.Column == "" || column.Table == nil {
			continue
		}
		parts := strings.Split(o.Column, ".")
		schema := column.Table.Schema
		if schema == "" {
			schema = g.request.Catalog.DefaultSchema
		}
		actual := []string{column.Table.Catalog, schema, column.Table.Name, name}
		if len(parts) < 2 || len(parts) > 4 {
			continue
		}
		if len(parts) == 2 && schema != g.request.Catalog.DefaultSchema {
			continue
		}
		matches := true
		for j, pattern := range parts {
			if !sdk.MatchString(pattern, actual[4-len(parts)+j]) {
				matches = false
				break
			}
		}
		if matches {
			return o
		}
	}
	for i := range g.options.Overrides {
		o := &g.options.Overrides[i]
		qualified := column.GetType().GetName()
		if schema := column.GetType().GetSchema(); schema != "" {
			qualified = schema + "." + qualified
		}
		if o.DBType != "" && (strings.EqualFold(o.DBType, column.GetType().GetName()) || strings.EqualFold(o.DBType, qualified)) && o.Nullable == !column.NotNull {
			return o
		}
	}
	return nil
}

// resolveType selects conversions and imports before applying null and slice
// wrapping. Codec-free custom types must refine the default runtime type.
func (m *module) resolveType(column *plugin.Column, forceNullable bool) (valueType, error) {
	if column == nil {
		column = &plugin.Column{}
	}
	// PostgreSQL permits at most six array dimensions. Reject corrupt compiler
	// metadata before source generation can allocate nested type expressions.
	if column.ArrayDims < 0 || column.ArrayDims > 6 {
		return valueType{}, fmt.Errorf("column %q has invalid array dimensions %d; expected 0 through 6", column.Name, column.ArrayDims)
	}
	if m.gen.request.Settings.Engine == "postgresql" && column.IsSqlcSlice {
		return valueType{}, fmt.Errorf("PostgreSQL sqlc.slice parameter %q is unsupported; use a native array with = ANY($1::type[]) instead", column.Name)
	}
	kind, base := m.sqlType(column)
	value := valueType{kind: kind, typeName: base, nullable: !column.NotNull || forceNullable, slice: column.IsSqlcSlice}
	if m.gen.request.Settings.Engine == "postgresql" && (column.IsArray || column.ArrayDims > 0) {
		value.arrayDims = max(1, int(column.ArrayDims))
		value.slice = false
	} else if (column.IsArray || column.ArrayDims > 0) && !column.IsSqlcSlice {
		return value, fmt.Errorf("%s array column %q requires sqlc.slice or a JSON codec", m.gen.request.Settings.Engine, column.Name)
	}
	override := m.gen.columnOverride(column)
	if override != nil {
		typeName, err := parseType(override.TSType, nil)
		if err != nil {
			return value, fmt.Errorf("override for %q: %w", column.Name, err)
		}
		if override.Import != nil {
			if !tsast.Identifier(override.Import.Name) {
				return value, fmt.Errorf("invalid type import name %q", override.Import.Name)
			}
			// An import supplied for a different override shape need not appear
			// in this type. Probe references before allocating an import, so
			// strict noUnusedLocals checks do not fail on a needless import.
			probe, _ := parseType(override.TSType, map[string]string{override.Import.Name: override.Import.Name + "$sqlcReference"})
			if probe != typeName {
				alias := m.useImport(override.Import.Path, override.Import.Name, true)
				typeName, _ = parseType(override.TSType, map[string]string{override.Import.Name: alias})
			}
		}
		value.typeName = typeName
		if override.Codec != nil {
			if !tsast.Identifier(override.Codec.Name) {
				return value, fmt.Errorf("invalid codec import name %q", override.Codec.Name)
			}
			value.codec = override.Codec
		} else if typeName != base && kind == "json" && m.gen.request.Settings.Engine != "sqlite" {
			// Parsed server JSON can use a domain interface without a codec.
			// Interfaces need not have JsonObject's string index signature, so
			// do not impose a structural extends-JsonValue constraint here.
			// Runtime code still checks JSON values and handles SQL NULL, but
			// only an explicit codec can validate the supplied domain shape.
			value.jsonStatic = true
		} else if typeName != base {
			// An unknown SQL type has no stable runtime representation. A
			// TypeScript constraint against unknown would accept even Date or
			// object types without producing those values at runtime.
			if base == "unknown" || base == "any" || primitiveType(typeName) {
				return value, fmt.Errorf("override %q changes %s to %s and requires a codec", column.Name, base, typeName)
			}
			m.compatible = true
			value.typeName = fmt.Sprintf("_sqlcCompatible<%s, %s>", base, typeName)
		}
	}
	m.importSQLType(&value, column)
	return value, nil
}

// primitiveType identifies known runtime representations for early codec errors.
func primitiveType(name string) bool {
	switch name {
	case "string", "number", "bigint", "boolean", "Date", "Uint8Array", "Buffer", "unknown", "any", "object", "null", "undefined", "symbol", "void":
		return true
	}
	return false
}

// typeText wraps a resolved application type with SQL array dimensions and
// outer nullability. Native arrays can contain null elements even when the
// column itself is NOT NULL; a sqlc.slice instead inherits element nullability
// from the compiler's scalar parameter and always requires the outer array.
func (m *module) typeText(value valueType) string {
	var typ tsast.TypeExpr = tsast.NameType(value.typeName)
	missing := tsast.NameType(m.nullText())
	for i := 0; i < value.arrayDims; i++ {
		element := typ
		if value.typeName != "unknown" || i > 0 {
			element = tsast.UnionType{element, missing}
		}
		typ = tsast.NameType("ReadonlyArray<" + element.TypeScript() + ">")
	}
	if value.nullable && (value.typeName != "unknown" || value.arrayDims > 0) {
		typ = tsast.UnionType{typ, missing}
	}
	if value.slice {
		return "ReadonlyArray<" + typ.TypeScript() + ">"
	}
	return typ.TypeScript()
}

// makeFields allocates properties once so interface and row access agree.
func (m *module) makeFields(columns []*plugin.Column, forceNullable bool) ([]field, error) {
	names := nameSet{}
	fields := make([]field, 0, len(columns))
	for i, col := range columns {
		if col == nil {
			return nil, fmt.Errorf("missing column metadata at position %d", i+1)
		}
		f := field{name: names.take(m.fieldName(col.Name, fmt.Sprintf("col%d", i+1))), column: col}
		if col.EmbedTable != nil {
			model := m.gen.byTable[m.gen.tableKey(col.EmbedTable)]
			if model == nil {
				return nil, fmt.Errorf("embedded table %q is absent from the catalog", col.EmbedTable.Name)
			}
			alias := m.useImport("./models.ts", model.name, true)
			f.value = valueType{typeName: alias}
			nullable := !col.NotNull || forceNullable
			if nullable {
				null := "null"
				if m.gen.options.EmitNullAsUndefined {
					null = "undefined"
				}
				f.value.typeName = fmt.Sprintf("{ [K in keyof %s]: %s[K] | %s }", alias, alias, null)
			}
			if !m.gen.options.TypesOnly {
				children, err := m.makeFields(model.columns, nullable)
				if err != nil {
					return nil, err
				}
				f.children = children
			}
		} else {
			value, err := m.resolveType(col, forceNullable)
			if err != nil {
				return nil, err
			}
			f.value = value
		}
		fields = append(fields, f)
	}
	return fields, nil
}

// emitInterface documents public fields and emits their resolved types.
func (m *module) emitInterface(name, description string, fields []field, args bool) {
	declaration := tsast.InterfaceDecl{
		Name: name, Export: true, Doc: []string{name + " " + description},
	}
	for _, field := range fields {
		comment := field.name + " contains a value selected by the SQL expression."
		if args {
			comment = field.name + " supplies a bound SQL parameter."
		} else if field.column.EmbedTable != nil {
			comment = field.name + " contains the embedded " + field.column.EmbedTable.Name + " row."
			if !field.column.NotNull {
				comment += " An unmatched join retains this object with absent fields."
			}
		} else if field.column.Name != "" {
			comment = field.name + " corresponds to SQL column " + field.column.Name + "."
		}
		if field.column.Comment != "" {
			comment += " " + field.column.Comment
		}
		if field.value.codec != nil {
			comment += " The configured codec converts its non-null values."
		} else if field.value.jsonStatic {
			comment += " The configured JSON type is a static contract; no runtime check validates its shape."
		} else if m.gen.request.Settings.Engine == "sqlite" {
			switch field.value.kind {
			case "integer":
				comment += " Integers retain SQLite's signed 64-bit precision."
			case "date":
				if args {
					comment += " Dates bind as UTC ISO text with millisecond precision."
				} else {
					comment += " Dates use UTC when no zone is stored and retain millisecond precision."
				}
			case "boolean":
				if args {
					comment += " False and true bind as SQLite 0 and 1."
				} else {
					comment += " SQLite 0 and 1 convert to false and true."
				}
			case "json":
				if args {
					comment += " JSON bytes bind unchanged without parsing."
				} else {
					comment += " JSON remains raw bytes; stored text becomes UTF-8 without parsing."
				}
			case "bytes":
				comment += " Empty bytes remain distinct from SQL NULL."
			}
		}
		if field.value.arrayDims > 0 {
			comment += " Native SQL arrays bind as one parameter and can contain absent elements."
		}
		if field.value.slice {
			comment += " Elements bind separately; an empty slice emits SQL NULL."
		}
		if field.value.nullable && !field.value.slice {
			comment += " SQL NULL is represented by " + m.nullText() + "."
			if args && m.gen.options.EmitNullAsUndefined {
				comment += " Omitting this property binds SQL NULL."
			}
		}
		declaration.Properties = append(declaration.Properties, tsast.PropertyDecl{
			Name:     field.name,
			Type:     tsast.NameType(m.typeText(field.value)),
			Optional: args && field.value.nullable && !field.value.slice && m.gen.options.EmitNullAsUndefined,
			Doc:      []string{comment},
		})
	}
	declaration.Emit(&m.body)
	m.body.Line("")
}

// emitModel emits a complete table model even when no query references it.
func (m *module) emitModel(model *model) error {
	fields, err := m.makeFields(model.columns, false)
	if err != nil {
		return fmt.Errorf("model %s: %w", model.name, err)
	}
	m.emitInterface(model.name, "describes a row in the "+model.table.Name+" table.", fields, false)
	return nil
}

// nullText selects the configured missing-value representation.
func (m *module) nullText() string {
	if m.gen.options.EmitNullAsUndefined {
		return "undefined"
	}
	return "null"
}

// encode emits a checked conversion for a scalar argument or slice element.
func (m *module) encode(value valueType, expression string) string {
	if value.arrayDims > 0 {
		if value.codec != nil {
			name := m.runtimeImport("encodeArrayCustom", false)
			codec := m.useImport(value.codec.Path, value.codec.Name, false)
			return fmt.Sprintf("%s(%s, %s, %s, %d, %t)", name, codec, tsast.Quote(value.kind), expression, value.arrayDims, value.nullable)
		}
		name := m.runtimeImport("encodeArray", false)
		return fmt.Sprintf("%s(%s, %s, %d)", name, tsast.Quote(value.kind), expression, value.arrayDims)
	}
	if value.codec != nil {
		name := m.runtimeImport("encodeCustom", false)
		codec := m.useImport(value.codec.Path, value.codec.Name, false)
		return fmt.Sprintf("%s(%s, %s, %t)", name, codec, expression, value.nullable)
	}
	name := m.runtimeImport("encodeValue", false)
	if m.gen.request.Settings.Engine != "sqlite" {
		return fmt.Sprintf("%s(%s, %s, %t)", name, tsast.Quote(value.kind), expression, value.nullable)
	}
	return fmt.Sprintf("%s(%s, %s)", name, tsast.Quote(value.kind), expression)
}

// decode emits a checked conversion for a scalar result, including SQL NULL.
func (m *module) decode(value valueType, expression string) string {
	typ := m.typeText(value)
	if value.arrayDims > 0 {
		if value.codec != nil {
			name := m.runtimeImport("decodeArrayCustom", false)
			codec := m.useImport(value.codec.Path, value.codec.Name, false)
			return fmt.Sprintf("%s<%s>(%s, %s, %s, %d, %t, %t)", name, typ, codec, tsast.Quote(value.kind), expression, value.arrayDims, value.nullable, m.gen.options.EmitNullAsUndefined)
		}
		name := m.runtimeImport("decodeArray", false)
		return fmt.Sprintf("%s<%s>(%s, %s, %d, %t, %t)", name, typ, tsast.Quote(value.kind), expression, value.arrayDims, value.nullable, m.gen.options.EmitNullAsUndefined)
	}
	if value.codec != nil {
		name := m.runtimeImport("decodeCustom", false)
		codec := m.useImport(value.codec.Path, value.codec.Name, false)
		return fmt.Sprintf("%s<%s>(%s, %s, %t, %t)", name, typ, codec, expression, value.nullable, m.gen.options.EmitNullAsUndefined)
	}
	name := m.runtimeImport("decodeValue", false)
	return fmt.Sprintf("%s<%s>(%s, %s, %t, %t)", name, typ, tsast.Quote(value.kind), expression, value.nullable, m.gen.options.EmitNullAsUndefined)
}
