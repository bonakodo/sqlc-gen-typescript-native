package typescript

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/tsast"
)

// nameSet allocates stable names within one TypeScript declaration scope.
type nameSet map[string]bool

// reservedNames includes syntax keywords and globals used by emitted code.
const reservedNames = "abstract arguments as asserts async await boolean break case catch class const constructor continue debugger declare default delete do else enum eval export extends false finally for from function get global if implements import in infer instanceof interface intrinsic is keyof let module namespace never new null number object of out override package private protected public readonly require return satisfies set static string super switch symbol this throw true try type typeof undefined unique unknown using var void while with yield any bigint Array BigInt Boolean Database Date Error JSON Map Number Object Promise RangeError ReadonlyArray Record Set String Symbol TextDecoder TextEncoder TypeError Uint8Array"

// newNameSet reserves language keywords and runtime globals before naming users' SQL.
func newNameSet() nameSet {
	s := nameSet{}
	for _, name := range strings.Fields(reservedNames) {
		s[name] = true
	}
	return s
}

// take returns an unused name, adding a numeric suffix when the base is reserved.
func (s nameSet) take(base string) string {
	name := base
	for n := 2; s[name]; n++ {
		name = fmt.Sprintf("%s_%d", base, n)
	}
	s[name] = true
	return name
}

// fieldName preserves camelCase and converts underscore-separated SQL names.
func fieldName(name, fallback string) string {
	if name == "" {
		return fallback
	}
	if !strings.Contains(name, "_") || strings.HasPrefix(name, "__") {
		return name
	}
	parts := strings.Split(name, "_")
	for i := range parts {
		if strings.ToUpper(parts[i]) == parts[i] {
			parts[i] = strings.ToLower(parts[i])
		}
		if i == 0 {
			parts[i] = lowerFirst(parts[i])
		} else {
			parts[i] = upperFirst(parts[i])
		}
	}
	if result := strings.Join(parts, ""); result != "" {
		return result
	}
	return fallback
}

// upperFirst capitalizes the first Unicode letter without changing the rest.
func upperFirst(s string) string {
	r := []rune(s)
	if len(r) != 0 {
		r[0] = unicode.ToUpper(r[0])
	}
	return string(r)
}

// lowerFirst lowercases the first Unicode letter without changing the rest.
func lowerFirst(s string) string {
	r := []rune(s)
	if len(r) != 0 {
		r[0] = unicode.ToLower(r[0])
	}
	return string(r)
}

// declarationName converts SQL names into readable, valid declaration identifiers.
func declarationName(s string) string {
	var b strings.Builder
	capitalize := true
	for _, r := range s {
		if unicode.IsMark(r) && b.Len() > 0 {
			b.WriteRune(r)
			continue
		}
		if r != '$' && r != '_' && !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			capitalize = true
			continue
		}
		if r == '_' {
			capitalize = true
			continue
		}
		if capitalize {
			r = unicode.ToUpper(r)
			capitalize = false
		}
		b.WriteRune(r)
	}
	name := b.String()
	if name == "" {
		return "Query"
	}
	if !tsast.Identifier(name) {
		name = "_" + name
	}
	return name
}

// fieldName applies the same property naming rules for every driver and value
// mode. Lowercasing an entire SQL name would discard existing camelCase; property
// quoting and collision allocation handle names that are not valid identifiers.
func (m *module) fieldName(name, fallback string) string {
	return fieldName(name, fallback)
}
