package typescript

import (
	"fmt"
	"strconv"
	"strings"
)

// bindPart records either untouched SQL or a positional argument occurrence.
type bindPart struct {
	// text contains SQL that must keep its original spelling.
	text string
	// number identifies a bound argument; zero means this part is plain text.
	number int
}

// bindingPlan separates SQL syntax from values before runtime emission.
type bindingPlan struct {
	// parts preserves source order while separating placeholders from SQL.
	parts []bindPart
	// text contains dense placeholders and untouched compiler slice markers.
	text string
	// dynamic requires runtime SQL assembly because a slice changes bind count.
	dynamic bool
}

// planBindings rewrites real SQLite placeholders to dense positional bindings.
// Repeated and sparse parameter numbers retain their identity through number;
// quoted text and ordinary comments remain byte-for-byte unchanged.
func planBindings(sql string, parameters map[int]*queryParameter) (bindingPlan, error) {
	return planDialectBindings(sql, parameters, "sqlite")
}

// planDialectBindings rewrites placeholders to dense bindings in source order.
// The original parameter number stays in parts. PostgreSQL reuses each distinct
// binding number, which keeps type inference shared across repeated arguments;
// SQLite repeats the value at each anonymous placeholder instead.
// MySQL numbers each occurrence independently, including repeated slice names.
// PostgreSQL native arrays use one parameter and need no runtime SQL expansion.
func planDialectBindings(sql string, parameters map[int]*queryParameter, engine string) (bindingPlan, error) {
	var plan bindingPlan
	if engine != "sqlite" && engine != "postgresql" && engine != "mysql" {
		return plan, fmt.Errorf("unsupported SQL engine %q", engine)
	}
	var normalized strings.Builder
	named := map[string]int{}
	slices := map[string]int{}
	pgNumbers := map[int]int{}
	for number, parameter := range parameters {
		if number < 1 || parameter == nil || parameter.field.column == nil {
			return plan, fmt.Errorf("invalid metadata for %s parameter %d", engine, number)
		}
		if engine == "sqlite" && parameter.field.value.slice {
			name := parameter.field.column.Name
			if previous := slices[name]; previous != 0 && previous != number {
				return plan, fmt.Errorf("slice name %q identifies multiple parameters", name)
			}
			slices[name] = number
		}
	}
	highest := 0
	ordinal := 0
	start := 0
	for i := 0; i < len(sql); {
		marker := ""
		placeholderStart := i
		if engine != "postgresql" && strings.HasPrefix(sql[i:], "/*SLICE:") {
			if end := strings.Index(sql[i+8:], "*/"); end >= 0 {
				marker = sql[i+8 : i+8+end]
				i += 8 + end + 2
				if marker == "" || i >= len(sql) || sql[i] != '?' {
					i = placeholderStart
					marker = ""
				}
			}
		}
		if marker == "" {
			end, err := skipDialectSQL(sql, i, engine)
			if err != nil {
				return plan, err
			}
			if end > i {
				i = end
				continue
			}
			if sqlIdentifierStart(sql[i]) {
				// A dollar inside an unquoted identifier belongs to that name,
				// not to a bound parameter: amount$usd is one column name.
				i++
				for i < len(sql) && sqlNameByte(sql[i]) {
					i++
				}
				continue
			}
		}
		c := sql[i]
		if engine == "postgresql" && (c != '$' || i+1 == len(sql) || sql[i+1] < '0' || sql[i+1] > '9') ||
			engine == "mysql" && c != '?' ||
			engine == "sqlite" && c != '?' && c != ':' && c != '@' && c != '$' {
			i++
			continue
		}
		end := i + 1
		number := 0
		if engine == "mysql" {
			// MySQL has no numbered or shared named parameters. Even two
			// identical compiler slice markers each occupy a new ordinal.
			number = highest + 1
		} else if marker != "" {
			// The compiler deduplicates slice arguments but prints each slice
			// occurrence as an anonymous ?. Its marker is the authoritative
			// identity; counting repeated occurrences would shift later args.
			number = slices[marker]
			if number == 0 {
				return plan, fmt.Errorf("slice marker %q has no argument metadata", marker)
			}
			for end < len(sql) && sql[end] >= '0' && sql[end] <= '9' {
				end++
			}
		} else if c == '?' || engine == "postgresql" {
			for end < len(sql) && sql[end] >= '0' && sql[end] <= '9' {
				end++
			}
			if end > i+1 {
				var err error
				number, err = strconv.Atoi(sql[i+1 : end])
				if err != nil || number < 1 {
					return plan, fmt.Errorf("invalid %s parameter %q", engine, sql[i:end])
				}
			} else {
				number = highest + 1
			}
		} else {
			for end < len(sql) && sqlNameByte(sql[end]) {
				end++
			}
			if end == i+1 {
				i++
				continue
			}
			name := sql[i:end]
			number = named[name]
			if number == 0 {
				number = highest + 1
				named[name] = number
			}
		}
		if number > highest {
			highest = number
		}
		parameter := parameters[number]
		if parameter == nil {
			return plan, fmt.Errorf("%s parameter %s has no argument metadata", engine, sql[i:end])
		}
		if marker != "" && (!parameter.field.value.slice || parameter.field.column.Name != marker) {
			return plan, fmt.Errorf("slice marker %q does not match parameter %d", marker, number)
		}
		if engine != "postgresql" && marker == "" && parameter.field.value.slice {
			return plan, fmt.Errorf("slice parameter %d is missing its compiler marker", number)
		}
		text := sql[start:placeholderStart]
		plan.parts = append(plan.parts, bindPart{text: text}, bindPart{number: number})
		normalized.WriteString(text)
		if marker != "" {
			normalized.WriteString("/*SLICE:" + marker + "*/")
			plan.dynamic = true
		}
		ordinal++
		placeholderNumber := ordinal
		if engine == "postgresql" {
			placeholderNumber = pgNumbers[number]
			if placeholderNumber == 0 {
				placeholderNumber = len(pgNumbers) + 1
				pgNumbers[number] = placeholderNumber
			}
		}
		normalized.WriteString(dialectBindPlaceholder(parameter.field.value, engine, placeholderNumber))
		start = end
		i = end
	}
	plan.parts = append(plan.parts, bindPart{text: sql[start:]})
	normalized.WriteString(sql[start:])
	plan.text = normalized.String()
	return plan, nil
}

// dialectBindPlaceholder applies SQLite's numeric workaround only to SQLite.
// PostgreSQL needs the dense binding ordinal; MySQL uses an anonymous bind.
func dialectBindPlaceholder(value valueType, engine string, ordinal int) string {
	switch engine {
	case "postgresql":
		return "$" + strconv.Itoa(ordinal)
	case "mysql":
		return "?"
	default:
		return bindPlaceholder(value)
	}
}

// bindPlaceholder ensures built-in numeric arguments reach SQLite as REAL.
// The pinned driver binds integer-valued numbers through signed int64, which
// would wrap large finite doubles. Their encoder uses decimal text instead;
// CAST converts that text without changing binding count or SQL NULL behavior.
// Custom codecs retain control of their own SQLite representation.
func bindPlaceholder(value valueType) string {
	if value.kind == "number" && value.codec == nil {
		return "CAST(? AS REAL)"
	}
	return "?"
}

// sqlNameByte recognizes characters inside SQLite identifiers and parameter
// names. A dollar is valid inside both, even though it can also start a parameter.
func sqlNameByte(c byte) bool {
	return sqlIdentifierStart(c) || c >= '0' && c <= '9' || c == '$'
}

// sqlIdentifierStart distinguishes unquoted identifiers from parameter sigils.
func sqlIdentifierStart(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '_' || c >= 0x80
}

// skipSQL retains the SQLite scanner entry point for local callers and tests.
func skipSQL(sql string, start int) (int, error) {
	return skipDialectSQL(sql, start, "sqlite")
}

// skipDialectSQL skips one string, quoted identifier, or comment at start.
// SQL dialects disagree on quoting and comments: PostgreSQL permits nested
// comments and dollar quotes, while MySQL requires whitespace after "--" and
// permits backslash escapes in strings. Ignoring these rules can bind a value
// at the wrong place, so unterminated constructs fail before code emission.
func skipDialectSQL(sql string, start int, engine string) (int, error) {
	if start >= len(sql) {
		return start, nil
	}
	lineComment := strings.HasPrefix(sql[start:], "--")
	if lineComment && engine == "mysql" {
		lineComment = start+2 == len(sql) || sql[start+2] <= ' '
	}
	if lineComment || engine == "mysql" && sql[start] == '#' {
		if n := strings.IndexAny(sql[start:], "\r\n"); n >= 0 {
			return start + n + 1, nil
		}
		return len(sql), nil
	}
	if strings.HasPrefix(sql[start:], "/*") {
		depth := 1
		for i := start + 2; i+1 < len(sql); i++ {
			if engine == "postgresql" && strings.HasPrefix(sql[i:], "/*") {
				depth++
				i++
			} else if strings.HasPrefix(sql[i:], "*/") {
				depth--
				if depth == 0 {
					return i + 2, nil
				}
				i++
			}
		}
		return 0, fmt.Errorf("unterminated SQL comment")
	}
	if engine == "postgresql" && sql[start] == '$' {
		// A dollar-quote tag uses identifier characters except '$' itself,
		// and cannot start with a digit: $1 is a parameter, $tag$ is text.
		end := start + 1
		if end < len(sql) && sqlIdentifierStart(sql[end]) {
			end++
			for end < len(sql) && sql[end] != '$' && sqlNameByte(sql[end]) {
				end++
			}
		}
		if end < len(sql) && sql[end] == '$' {
			tag := sql[start : end+1]
			if n := strings.Index(sql[end+1:], tag); n >= 0 {
				return end + 1 + n + len(tag), nil
			}
			return 0, fmt.Errorf("unterminated PostgreSQL dollar quote")
		}
	}
	quote := sql[start]
	backslash := engine == "mysql" && (quote == '\'' || quote == '"')
	if engine == "postgresql" && (quote == 'e' || quote == 'E') && start+1 < len(sql) && sql[start+1] == '\'' {
		// E-prefixed strings alone treat a backslash as an escape in the
		// PostgreSQL default string mode. Ordinary quoted strings do not.
		start++
		quote = '\''
		backslash = true
	}
	if quote != '\'' && quote != '"' && !(quote == '`' && engine != "postgresql") && !(quote == '[' && engine == "sqlite") {
		return start, nil
	}
	endQuote := quote
	if quote == '[' {
		endQuote = ']'
	}
	for i := start + 1; i < len(sql); i++ {
		if backslash && sql[i] == '\\' {
			i++
			continue
		}
		if sql[i] == endQuote {
			if quote != '[' && i+1 < len(sql) && sql[i+1] == endQuote {
				i++
				continue
			}
			return i + 1, nil
		}
	}
	return 0, fmt.Errorf("unterminated SQL quote")
}
