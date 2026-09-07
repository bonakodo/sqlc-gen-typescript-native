package typescript

import (
	"fmt"
	"sort"
	"strings"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/tsast"
	"github.com/sqlc-dev/plugin-sdk-go/plugin"
)

// queryParameter pairs an argument field with the compiler's original bind index.
type queryParameter struct {
	number int
	field  field
}

// queryPlan allocates public names before imports or private helpers can collide.
type queryPlan struct {
	query      *plugin.Query
	function   string
	constant   string
	argsName   string
	rowName    string
	parameters []*queryParameter
	byNumber   map[int]*queryParameter
	fields     []field
	bindings   bindingPlan
}

// planQuery validates annotations and resolves all arguments and result fields.
func (m *module) planQuery(query *plugin.Query) (*queryPlan, error) {
	switch query.Cmd {
	case ":one", ":many", ":exec", ":execrows", ":execlastid", ":execresult":
	default:
		return nil, fmt.Errorf("unsupported TypeScript annotation %q", query.Cmd)
	}
	if m.gen.request.Settings.Engine == "postgresql" && query.Cmd == ":execlastid" {
		return nil, fmt.Errorf("PostgreSQL has no connection insert ID; use INSERT ... RETURNING with :one")
	}
	base := declarationName(query.Name)
	if m.gen.options.SQLiteTypeMode != "native" && tsast.Identifier(query.Name) {
		base = query.Name
	}
	plan := &queryPlan{query: query, byNumber: map[int]*queryParameter{}}
	plan.function = m.names.take(lowerFirst(base))
	plan.constant = m.names.take(plan.function + "Query")
	if len(query.Params) > 0 {
		plan.argsName = m.names.take(base + "Args")
	}
	if query.Cmd == ":one" || query.Cmd == ":many" {
		if len(query.Columns) == 0 {
			return nil, fmt.Errorf("%s requires result column metadata", query.Cmd)
		}
		plan.rowName = m.names.take(base + "Row")
	}
	names := nameSet{}
	params := append([]*plugin.Parameter(nil), query.Params...)
	for _, param := range params {
		if param == nil || param.Number < 1 || param.Column == nil {
			return nil, fmt.Errorf("invalid parameter metadata")
		}
	}
	sort.SliceStable(params, func(i, j int) bool { return params[i].Number < params[j].Number })
	for _, param := range params {
		if plan.byNumber[int(param.Number)] != nil {
			return nil, fmt.Errorf("duplicate parameter number %d", param.Number)
		}
		value, err := m.resolveType(param.Column, false)
		if err != nil {
			return nil, err
		}
		parameter := &queryParameter{number: int(param.Number), field: field{
			name: names.take(m.fieldName(param.Column.Name, fmt.Sprintf("arg%d", param.Number))), column: param.Column, value: value,
		}}
		plan.parameters = append(plan.parameters, parameter)
		plan.byNumber[parameter.number] = parameter
	}
	var err error
	if plan.rowName != "" {
		plan.fields, err = m.makeFields(m.embedColumns(query), false)
		if err != nil {
			return nil, err
		}
	}
	plan.bindings, err = planDialectBindings(query.Text, plan.byNumber, m.gen.request.Settings.Engine)
	if err != nil {
		return nil, err
	}
	used := map[int]bool{}
	for _, part := range plan.bindings.parts {
		used[part.number] = true
	}
	for _, parameter := range plan.parameters {
		if !used[parameter.number] {
			return nil, fmt.Errorf("parameter %d has no placeholder in the SQL", parameter.number)
		}
	}
	return plan, nil
}

// emitQuery prints public types, SQL, and a function using the selected driver.
func (m *module) emitQuery(plan *queryPlan) error {
	emitConstant := m.gen.options.EmitSQLAsConst == nil || *m.gen.options.EmitSQLAsConst
	if !m.gen.options.TypesOnly && (emitConstant || !plan.bindings.dynamic) {
		prefix := ""
		if emitConstant {
			prefix = "export "
		}
		m.body.Line("%s", tsast.Comment([]string{plan.constant + " is the SQL for " + plan.query.Name + "; values are bound separately."}))
		m.body.Line("%sconst %s = %s;", prefix, plan.constant, tsast.Template("-- name: "+plan.query.Name+" "+plan.query.Cmd+"\n"+plan.bindings.text))
		m.body.Line("")
	}
	if plan.argsName != "" {
		fields := make([]field, len(plan.parameters))
		for i, p := range plan.parameters {
			fields[i] = p.field
		}
		m.emitInterface(plan.argsName, "supplies the bound values for "+plan.query.Name+".", fields, true)
	}
	if plan.rowName != "" {
		m.emitInterface(plan.rowName, "contains one row returned by "+plan.query.Name+".", plan.fields, false)
	}
	if m.gen.options.TypesOnly {
		return nil
	}
	resultType := "void"
	switch plan.query.Cmd {
	case ":one":
		resultType = plan.rowName + " | " + m.nullText()
	case ":many":
		resultType = plan.rowName + "[]"
	case ":execrows", ":execlastid":
		resultType = "bigint"
		if plan.query.Cmd == ":execlastid" {
			switch m.gen.options.DriverName() {
			case "mysql2":
				resultType = "number"
				if m.gen.options.MySQL2.SupportBigNumbers {
					resultType = "number | string"
					if m.gen.options.MySQL2.BigNumberStrings {
						resultType = "string"
					}
				}
			case "@bonakodo/sqlite":
				if m.gen.options.SQLiteTypeMode != "native" {
					resultType = "number"
				}
			}
		}
	case ":execresult":
		resultType = m.runtimeImport("ExecResult", true)
	}
	var databaseType string
	if m.gen.options.DriverName() == "@bonakodo/sqlite" {
		databaseType = m.useImport(m.gen.driverSpecifier(), "Database", true)
	} else {
		databaseType = m.runtimeImport("Database", true)
	}
	args := ""
	if plan.argsName != "" {
		args = ", args: " + plan.argsName
	}
	synchronous := m.gen.options.DriverName() == "@bonakodo/sqlite" || (m.gen.options.DriverName() == "better-sqlite3" && m.gen.options.SQLiteTypeMode == "native")
	mode := "on the supplied connection."
	if synchronous {
		mode = "synchronously on the supplied connection."
	}
	comments := append([]string{plan.function + " executes " + plan.query.Name + " " + mode}, plan.query.Comments...)
	if m.gen.options.DriverName() == "@bonakodo/sqlite" {
		comments = append(comments, "Prepared statements are finalized on success or failure; this function can run inside Database.transaction.")
	}
	comments = append(comments, "@throws For database errors, invalid bound values, or invalid stored values.")
	if plan.query.Cmd == ":one" {
		if m.gen.request.Settings.Engine != "sqlite" {
			comments = append(comments, "@returns The row, or "+m.nullText()+" unless exactly one row matches.")
		} else {
			comments = append(comments, "@returns The first row, or "+m.nullText()+" when no row matches.")
		}
	}
	m.body.Line("%s", tsast.Comment(comments))
	async := ""
	if !synchronous {
		async = "async "
		resultType = "Promise<" + resultType + ">"
	}
	m.body.Line("export %sfunction %s(database: %s%s): %s {", async, plan.function, databaseType, args, resultType)
	m.body.Indent()
	bindings, sql := m.emitBindings(plan)
	m.emitDriverQuery(plan, bindings, sql)
	m.body.Dedent()
	m.body.Line("}")
	m.body.Line("")
	return nil
}

// emitBindings encodes each argument once and expands only compiler-marked slices.
// One outer array keeps encoded scalar values in positional binding order.
func (m *module) emitBindings(plan *queryPlan) (string, string) {
	used := map[int]bool{}
	for _, part := range plan.bindings.parts {
		if part.number != 0 {
			used[part.number] = true
		}
	}
	for _, parameter := range plan.parameters {
		if !used[parameter.number] {
			continue
		}
		access := tsast.Access("args", parameter.field.name)
		if parameter.field.value.slice {
			m.body.Line("const _sqlcParam%d = %s.map((value) => %s);", parameter.number, access, m.encode(parameter.field.value, "value"))
		} else {
			m.body.Line("const _sqlcParam%d = %s;", parameter.number, m.encode(parameter.field.value, access))
		}
	}
	if !plan.bindings.dynamic {
		var values []string
		seen := map[int]bool{}
		for _, part := range plan.bindings.parts {
			if part.number > 0 {
				// PostgreSQL repeats one slot to preserve server type inference.
				// SQLite and MySQL instead bind each positional occurrence.
				if m.gen.request.Settings.Engine == "postgresql" && seen[part.number] {
					continue
				}
				seen[part.number] = true
				values = append(values, fmt.Sprintf("_sqlcParam%d", part.number))
			}
		}
		if len(values) == 0 {
			return "", plan.constant
		}
		return "[" + strings.Join(values, ", ") + "]", plan.constant
	}
	valueType := "unknown"
	if m.gen.request.Settings.Engine == "sqlite" {
		valueType = m.runtimeImport("SqliteValue", true)
	}
	m.body.Line("const _sqlcBindings: %s[] = [];", valueType)
	parts := []string{tsast.Quote("-- name: " + plan.query.Name + " " + plan.query.Cmd + "\n")}
	for _, part := range plan.bindings.parts {
		if part.number == 0 {
			parts = append(parts, tsast.Quote(part.text))
			continue
		}
		parameter := plan.byNumber[part.number]
		variable := fmt.Sprintf("_sqlcParam%d", part.number)
		placeholder := tsast.Quote(dialectBindPlaceholder(parameter.field.value, m.gen.request.Settings.Engine, 1))
		if parameter.field.value.slice {
			parts = append(parts, fmt.Sprintf("(%s.length === 0 ? \"NULL\" : %s.map(() => %s).join(\", \"))", variable, variable, placeholder))
			m.body.Line("for (const value of %s) _sqlcBindings.push(value);", variable)
		} else {
			parts = append(parts, placeholder)
			m.body.Line("_sqlcBindings.push(%s);", variable)
		}
	}
	m.body.Line("const _sqlcSQL = %s;", strings.Join(parts, " + "))
	return "_sqlcBindings", "_sqlcSQL"
}

// fieldCount counts actual SQLite columns, expanding embedded table fields.
func fieldCount(fields []field) int {
	count := 0
	for _, field := range fields {
		if len(field.children) > 0 {
			count += fieldCount(field.children)
		} else {
			count++
		}
	}
	return count
}

// emitRow verifies the result width before converting positional columns.
func (m *module) emitRow(fields []field, prefix string, count int) {
	m.body.Line("if (row.length !== %d) throw new Error(\"SQL result column count does not match the generated query\");", count)
	m.body.Line("%s {", prefix)
	m.body.Indent()
	index := 0
	m.emitRowFields(fields, &index)
	m.body.Dedent()
	m.body.Line("};")
}

// emitRowFields reconstructs nested objects without relying on driver key names.
func (m *module) emitRowFields(fields []field, index *int) {
	for _, field := range fields {
		if len(field.children) > 0 {
			m.body.Line("%s: {", tsast.Property(field.name))
			m.body.Indent()
			m.emitRowFields(field.children, index)
			m.body.Dedent()
			m.body.Line("},")
			continue
		}
		expression := m.decode(field.value, fmt.Sprintf("row[%d]", *index))
		m.body.Line("%s: %s,", tsast.Property(field.name), expression)
		*index++
	}
}
