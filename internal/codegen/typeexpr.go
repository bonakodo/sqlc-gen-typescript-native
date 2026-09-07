package typescript

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/tsast"
)

// maxTypeSourceBytes bounds the text retained while validating one override.
const maxTypeSourceBytes = 64 * 1024

// maxTypeTokens bounds parser work and intermediate output for one override.
const maxTypeTokens = 8192

// maxTypeDepth bounds recursive generic, object, tuple, and parenthesis nesting.
const maxTypeDepth = 128

// typeToken is one token in the supported, declaration-free override grammar.
type typeToken struct {
	text string
	kind byte
}

// typeParser validates override types while renaming imported type references.
// Complex application types can always be supplied as named imports; this
// parser deliberately does not accept declarations, comments, or executable code.
type typeParser struct {
	tokens  []typeToken
	index   int
	renames map[string]string
	depth   int
}

// parseType accepts names, generic types, unions, intersections, arrays, tuples,
// literals, and object types. It rejects incomplete or unsupported syntax before
// emission instead of inserting unchecked source fragments into generated code.
func parseType(source string, renames map[string]string) (string, error) {
	tokens, err := typeTokens(source)
	if err != nil {
		return "", fmt.Errorf("invalid ts_type: %w", err)
	}
	for _, alias := range renames {
		if !tsast.Identifier(alias) {
			return "", fmt.Errorf("invalid ts_type import alias %q", alias)
		}
	}
	p := &typeParser{tokens: tokens, renames: renames}
	typ, err := p.union()
	if err == nil && p.index != len(tokens) {
		err = fmt.Errorf("unexpected token %q", p.peek())
	}
	if err != nil {
		return "", fmt.Errorf("invalid ts_type at token %d: %w; use a named imported type for complex types", p.index+1, err)
	}
	return typ, nil
}

// typeTokens scans type syntax without treating quoted text as code.
func typeTokens(source string) ([]typeToken, error) {
	if len(source) > maxTypeSourceBytes {
		return nil, fmt.Errorf("type exceeds %d bytes", maxTypeSourceBytes)
	}
	if !utf8.ValidString(source) {
		return nil, fmt.Errorf("type contains invalid UTF-8")
	}
	var tokens []typeToken
	for i := 0; i < len(source); {
		r, size := utf8.DecodeRuneInString(source[i:])
		if unicode.IsSpace(r) {
			i += size
			continue
		}
		if len(tokens) >= maxTypeTokens {
			return nil, fmt.Errorf("type exceeds %d tokens", maxTypeTokens)
		}
		start := i
		if unicode.IsLetter(r) || r == '_' || r == '$' {
			i += size
			for i < len(source) {
				r, size = utf8.DecodeRuneInString(source[i:])
				if !unicode.IsLetter(r) && !unicode.IsDigit(r) && !unicode.IsMark(r) && r != '_' && r != '$' {
					break
				}
				i += size
			}
			tokens = append(tokens, typeToken{text: source[start:i], kind: 'i'})
			continue
		}
		if r == '\'' || r == '"' {
			quote := byte(r)
			i++
			closed := false
			for i < len(source) {
				c := source[i]
				i++
				if c < 0x20 {
					return nil, fmt.Errorf("unescaped control character in type literal")
				}
				if c == quote {
					closed = true
					break
				}
				if c == '\\' {
					if i >= len(source) || !strings.ContainsRune("'\"\\bfnrtv0xu", rune(source[i])) {
						return nil, fmt.Errorf("invalid escape in type literal")
					}
					escape := source[i]
					i++
					count := 0
					if escape == 'x' {
						count = 2
					} else if escape == 'u' {
						count = 4
					}
					for n := 0; n < count; n++ {
						if i >= len(source) || !strings.ContainsRune("0123456789abcdefABCDEF", rune(source[i])) {
							return nil, fmt.Errorf("invalid hexadecimal escape in type literal")
						}
						i++
					}
					if escape == '0' && i < len(source) && source[i] >= '0' && source[i] <= '9' {
						return nil, fmt.Errorf("octal escape in type literal")
					}
				}
			}
			if !closed {
				return nil, fmt.Errorf("unterminated type literal")
			}
			tokens = append(tokens, typeToken{text: source[start:i], kind: 's'})
			continue
		}
		if r >= '0' && r <= '9' {
			i++
			for i < len(source) && source[i] >= '0' && source[i] <= '9' {
				i++
			}
			if i-start > 1 && source[start] == '0' {
				return nil, fmt.Errorf("leading zero in numeric type literal")
			}
			integer := true
			if i < len(source) && source[i] == '.' {
				integer = false
				i++
				for i < len(source) && source[i] >= '0' && source[i] <= '9' {
					i++
				}
			}
			if i < len(source) && (source[i] == 'e' || source[i] == 'E') {
				integer = false
				i++
				if i < len(source) && (source[i] == '+' || source[i] == '-') {
					i++
				}
				startExponent := i
				for i < len(source) && source[i] >= '0' && source[i] <= '9' {
					i++
				}
				if startExponent == i {
					return nil, fmt.Errorf("missing exponent in numeric type literal")
				}
			}
			if i < len(source) && source[i] == 'n' {
				if !integer {
					return nil, fmt.Errorf("bigint type literal must be an integer")
				}
				i++
			}
			tokens = append(tokens, typeToken{text: source[start:i], kind: 'n'})
			continue
		}
		if strings.ContainsRune("|&<>()[]{}:;?,.-", r) {
			tokens = append(tokens, typeToken{text: string(r), kind: 'p'})
			i += size
			continue
		}
		return nil, fmt.Errorf("unsupported character %q in ts_type", r)
	}
	return tokens, nil
}

// peek reports the next token's spelling without advancing the parser.
func (p *typeParser) peek() string {
	if p.index >= len(p.tokens) {
		return ""
	}
	return p.tokens[p.index].text
}

// eat consumes a matching punctuation or keyword token.
func (p *typeParser) eat(text string) bool {
	if p.peek() != text {
		return false
	}
	p.index++
	return true
}

// union parses the lowest-precedence type operator.
func (p *typeParser) union() (string, error) {
	left, err := p.intersection()
	parts := []string{left}
	for err == nil && p.eat("|") {
		var right string
		right, err = p.intersection()
		parts = append(parts, right)
	}
	return strings.Join(parts, " | "), err
}

// intersection parses refinements such as a primitive and its brand.
func (p *typeParser) intersection() (string, error) {
	left, err := p.primary()
	parts := []string{left}
	for err == nil && p.eat("&") {
		var right string
		right, err = p.primary()
		parts = append(parts, right)
	}
	return strings.Join(parts, " & "), err
}

// primary parses one type with optional array or indexed-access suffixes.
func (p *typeParser) primary() (string, error) {
	if p.depth >= maxTypeDepth {
		return "", fmt.Errorf("type nesting exceeds %d levels", maxTypeDepth)
	}
	p.depth++
	defer func() { p.depth-- }()
	if p.index >= len(p.tokens) {
		return "", fmt.Errorf("expected a type")
	}
	var result string
	var err error
	switch {
	case p.eat("("):
		result, err = p.union()
		if err != nil {
			return "", err
		}
		if !p.eat(")") {
			return "", fmt.Errorf("expected )")
		}
		result = "(" + result + ")"
	case p.eat("{"):
		result, err = p.object()
	case p.eat("["):
		var elements []string
		optional := false
		for p.peek() != "]" {
			element, e := p.union()
			if e != nil {
				return "", e
			}
			if p.eat("?") {
				element += "?"
				optional = true
			} else if optional {
				return "", fmt.Errorf("required tuple element follows an optional element")
			}
			elements = append(elements, element)
			if !p.eat(",") {
				break
			}
		}
		if !p.eat("]") {
			return "", fmt.Errorf("expected ]")
		}
		result = "[" + strings.Join(elements, ", ") + "]"
	case p.eat("-"):
		if p.index == len(p.tokens) || p.tokens[p.index].kind != 'n' {
			return "", fmt.Errorf("expected numeric literal")
		}
		result = "-" + p.tokens[p.index].text
		p.index++
	default:
		token := p.tokens[p.index]
		if token.kind != 'i' && token.kind != 's' && token.kind != 'n' {
			return "", fmt.Errorf("expected type name")
		}
		p.index++
		result = token.text
		if token.kind == 'i' {
			if token.text == "keyof" || token.text == "readonly" {
				operand, e := p.primary()
				if e == nil && token.text == "readonly" && !strings.HasPrefix(operand, "[") && !strings.HasSuffix(operand, "[]") {
					return "", fmt.Errorf("readonly requires an array or tuple type")
				}
				return token.text + " " + operand, e
			}
			if token.text == "typeof" {
				result, err = p.typeQuery()
				break
			}
			if !typeNameToken(token.text) {
				return "", fmt.Errorf("reserved or unsupported type keyword %q", token.text)
			}
			if typeKeyword(token.text) {
				if p.peek() == "." || p.peek() == "<" {
					return "", fmt.Errorf("type keyword %q cannot be qualified or take type arguments", token.text)
				}
				break
			}
			if replacement := p.renames[result]; replacement != "" {
				result = replacement
			}
			for p.eat(".") {
				if p.index == len(p.tokens) || p.tokens[p.index].kind != 'i' {
					return "", fmt.Errorf("expected qualified name")
				}
				if !typeNameToken(p.tokens[p.index].text) || typeKeyword(p.tokens[p.index].text) {
					return "", fmt.Errorf("expected qualified type name, got %q", p.tokens[p.index].text)
				}
				result += "." + p.tokens[p.index].text
				p.index++
			}
			if p.eat("<") {
				var arguments []string
				for {
					argument, e := p.union()
					if e != nil {
						return "", e
					}
					arguments = append(arguments, argument)
					if !p.eat(",") {
						break
					}
				}
				if !p.eat(">") {
					return "", fmt.Errorf("expected >")
				}
				result += "<" + strings.Join(arguments, ", ") + ">"
			}
		}
	}
	for err == nil && p.eat("[") {
		if p.eat("]") {
			result += "[]"
			continue
		}
		index, e := p.union()
		if e != nil {
			return "", e
		}
		if !p.eat("]") {
			return "", fmt.Errorf("invalid indexed access type")
		}
		result += "[" + index + "]"
	}
	return result, err
}

// object parses named properties while preserving property names during imports.
func (p *typeParser) object() (string, error) {
	var fields []string
	for p.peek() != "}" {
		prefix := ""
		if p.peek() == "readonly" && p.index+1 < len(p.tokens) && p.tokens[p.index+1].text != ":" && p.tokens[p.index+1].text != "?" {
			p.index++
			prefix = "readonly "
		}
		if p.index == len(p.tokens) {
			return "", fmt.Errorf("unterminated object type")
		}
		key := p.tokens[p.index]
		p.index++
		if key.kind != 'i' && key.kind != 's' && key.kind != 'n' {
			return "", fmt.Errorf("expected property name")
		}
		optional := ""
		if p.eat("?") {
			optional = "?"
		}
		if !p.eat(":") {
			return "", fmt.Errorf("expected property type")
		}
		typ, err := p.union()
		if err != nil {
			return "", err
		}
		fields = append(fields, prefix+key.text+optional+": "+typ+";")
		if !p.eat(";") && !p.eat(",") && p.peek() != "}" {
			return "", fmt.Errorf("expected property separator")
		}
	}
	p.eat("}")
	return "{ " + strings.Join(fields, " ") + " }", nil
}

// typeNameToken distinguishes type names from syntax that would require a
// declaration, conditional type, or other unsupported construct.
func typeNameToken(name string) bool {
	if typeKeyword(name) {
		return true
	}
	switch name {
	case "infer", "unique", "asserts", "is", "satisfies", "keyof", "readonly", "typeof":
		return false
	}
	return tsast.Identifier(name)
}

// typeKeyword recognizes primitive types and literal keywords whose meaning
// cannot be replaced by an imported name or extended with type arguments.
func typeKeyword(name string) bool {
	switch name {
	case "any", "unknown", "never", "void", "undefined", "null", "true", "false", "string", "number", "bigint", "boolean", "symbol", "object":
		return true
	}
	return false
}

// typeQuery parses typeof followed by a value's qualified name. It rejects
// arbitrary type expressions, which are not valid operands of typeof in types.
func (p *typeParser) typeQuery() (string, error) {
	if p.index >= len(p.tokens) || p.tokens[p.index].kind != 'i' || !tsast.Identifier(p.peek()) || typeKeyword(p.peek()) {
		return "", fmt.Errorf("typeof requires a value name")
	}
	name := p.peek()
	p.index++
	if replacement := p.renames[name]; replacement != "" {
		name = replacement
	}
	for p.eat(".") {
		if p.index >= len(p.tokens) || p.tokens[p.index].kind != 'i' {
			return "", fmt.Errorf("typeof requires a qualified value name")
		}
		name += "." + p.peek()
		p.index++
	}
	return "typeof " + name, nil
}
