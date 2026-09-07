package protocol_test

import (
	"bytes"
	"math"
	"reflect"
	"strconv"
	"strings"
	"testing"

	oracle "github.com/bonakodo/sqlc-gen-typescript-native/internal/testpb"
	"github.com/bonakodo/sqlc-gen-typescript-native/protocol"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

type wireMessage interface {
	Marshal() ([]byte, error)
	Unmarshal([]byte) error
}

type messageCase struct {
	name      string
	newLocal  func() wireMessage
	newOracle func() proto.Message
	clone     func(wireMessage) wireMessage
}

func messageCases() []messageCase {
	return []messageCase{
		{"File", func() wireMessage { return &protocol.File{} }, func() proto.Message { return &oracle.File{} }, func(m wireMessage) wireMessage { return m.(*protocol.File).Clone() }},
		{"Settings", func() wireMessage { return &protocol.Settings{} }, func() proto.Message { return &oracle.Settings{} }, func(m wireMessage) wireMessage { return m.(*protocol.Settings).Clone() }},
		{"Codegen", func() wireMessage { return &protocol.Codegen{} }, func() proto.Message { return &oracle.Codegen{} }, func(m wireMessage) wireMessage { return m.(*protocol.Codegen).Clone() }},
		{"Catalog", func() wireMessage { return &protocol.Catalog{} }, func() proto.Message { return &oracle.Catalog{} }, func(m wireMessage) wireMessage { return m.(*protocol.Catalog).Clone() }},
		{"Schema", func() wireMessage { return &protocol.Schema{} }, func() proto.Message { return &oracle.Schema{} }, func(m wireMessage) wireMessage { return m.(*protocol.Schema).Clone() }},
		{"CompositeType", func() wireMessage { return &protocol.CompositeType{} }, func() proto.Message { return &oracle.CompositeType{} }, func(m wireMessage) wireMessage { return m.(*protocol.CompositeType).Clone() }},
		{"Enum", func() wireMessage { return &protocol.Enum{} }, func() proto.Message { return &oracle.Enum{} }, func(m wireMessage) wireMessage { return m.(*protocol.Enum).Clone() }},
		{"Table", func() wireMessage { return &protocol.Table{} }, func() proto.Message { return &oracle.Table{} }, func(m wireMessage) wireMessage { return m.(*protocol.Table).Clone() }},
		{"Identifier", func() wireMessage { return &protocol.Identifier{} }, func() proto.Message { return &oracle.Identifier{} }, func(m wireMessage) wireMessage { return m.(*protocol.Identifier).Clone() }},
		{"Column", func() wireMessage { return &protocol.Column{} }, func() proto.Message { return &oracle.Column{} }, func(m wireMessage) wireMessage { return m.(*protocol.Column).Clone() }},
		{"Query", func() wireMessage { return &protocol.Query{} }, func() proto.Message { return &oracle.Query{} }, func(m wireMessage) wireMessage { return m.(*protocol.Query).Clone() }},
		{"Parameter", func() wireMessage { return &protocol.Parameter{} }, func() proto.Message { return &oracle.Parameter{} }, func(m wireMessage) wireMessage { return m.(*protocol.Parameter).Clone() }},
		{"GenerateRequest", func() wireMessage { return &protocol.GenerateRequest{} }, func() proto.Message { return &oracle.GenerateRequest{} }, func(m wireMessage) wireMessage { return m.(*protocol.GenerateRequest).Clone() }},
		{"GenerateResponse", func() wireMessage { return &protocol.GenerateResponse{} }, func() proto.Message { return &oracle.GenerateResponse{} }, func(m wireMessage) wireMessage { return m.(*protocol.GenerateResponse).Clone() }},
		{"Codegen_Process", func() wireMessage { return &protocol.Codegen_Process{} }, func() proto.Message { return &oracle.Codegen_Process{} }, func(m wireMessage) wireMessage { return m.(*protocol.Codegen_Process).Clone() }},
		{"Codegen_WASM", func() wireMessage { return &protocol.Codegen_WASM{} }, func() proto.Message { return &oracle.Codegen_WASM{} }, func(m wireMessage) wireMessage { return m.(*protocol.Codegen_WASM).Clone() }},
	}
}

func bytesField(number protowire.Number, value []byte) []byte {
	return protowire.AppendBytes(protowire.AppendTag(nil, number, protowire.BytesType), value)
}

func varintField(number protowire.Number, value uint64) []byte {
	return protowire.AppendVarint(protowire.AppendTag(nil, number, protowire.VarintType), value)
}

func concat(parts ...[]byte) []byte { return bytes.Join(parts, nil) }

// Include every legal wire form, unused field 100, the largest legal
// field number, and a group. Unknown bytes must survive without normalization.
func unknownFields() []byte {
	return concat(
		varintField(100, math.MaxUint64),
		protowire.AppendFixed64(protowire.AppendTag(nil, 101, protowire.Fixed64Type), math.MaxUint64),
		bytesField(102, []byte{0, 0xff, 0x80}),
		protowire.AppendTag(nil, 103, protowire.StartGroupType),
		varintField(1, 7),
		protowire.AppendTag(nil, 103, protowire.EndGroupType),
		protowire.AppendFixed32(protowire.AppendTag(nil, 104, protowire.Fixed32Type), math.MaxUint32),
		varintField(protowire.MaxValidNumber, 1),
		// Non-minimal but valid varint encoding is preserved for unknown fields.
		append(protowire.AppendTag(nil, 105, protowire.VarintType), 0x81, 0),
	)
}

// Build cases from the pinned oracle descriptors so a missed schema field or
// message cannot silently disappear from the coverage of the custom codec.
func fillOracle(m protoreflect.Message) {
	fields := m.Descriptor().Fields()
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		if field.IsList() {
			list := m.Mutable(field).List()
			for item := 0; item < 2; item++ {
				value := list.NewElement()
				if field.Kind() == protoreflect.MessageKind {
					if item == 0 {
						fillOracle(value.Message())
					}
				} else if item == 0 {
					value = sampleValue(field)
				}
				list.Append(value)
			}
		} else if field.Kind() == protoreflect.MessageKind {
			fillOracle(m.Mutable(field).Message())
		} else {
			m.Set(field, sampleValue(field))
		}
	}
	m.SetUnknown(unknownFields())
}

func sampleValue(field protoreflect.FieldDescriptor) protoreflect.Value {
	switch field.Kind() {
	case protoreflect.StringKind:
		return protoreflect.ValueOfString(string(field.FullName()) + " 日本語\x00")
	case protoreflect.BytesKind:
		return protoreflect.ValueOfBytes([]byte{0, 127, 128, 255})
	case protoreflect.Int32Kind:
		return protoreflect.ValueOfInt32(math.MinInt32)
	case protoreflect.BoolKind:
		return protoreflect.ValueOfBool(true)
	default:
		panic("add a sample for schema field " + string(field.FullName()))
	}
}

func marshalOracle(t testing.TB, m proto.Message) []byte {
	t.Helper()
	wire, err := proto.MarshalOptions{Deterministic: true}.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func marshalLocal(t testing.TB, m wireMessage) []byte {
	t.Helper()
	wire, err := m.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func compareDecode(t testing.TB, tc messageCase, wire []byte) {
	t.Helper()
	want, got := tc.newOracle(), tc.newLocal()
	wantErr := (proto.UnmarshalOptions{RecursionLimit: 100}).Unmarshal(wire, want)
	gotErr := got.Unmarshal(wire)
	if (wantErr != nil) != (gotErr != nil) {
		t.Fatalf("%s: error mismatch for %x: oracle=%v local=%v", tc.name, wire, wantErr, gotErr)
	}
	if wantErr != nil {
		return
	}
	gotWire := marshalLocal(t, got)
	decoded := tc.newOracle()
	if err := proto.Unmarshal(gotWire, decoded); err != nil {
		t.Fatalf("local marshal produced invalid protobuf: %v", err)
	}
	if !proto.Equal(want, decoded) {
		t.Fatalf("%s: decoded values differ for %x\nwant %v\ngot  %v", tc.name, wire, want, decoded)
	}
	// Canonical inputs retain canonical encoding. For arbitrary inputs, the
	// oracle normalizes unknown field tags while this codec preserves their
	// exact bytes, so semantic comparison above is the applicable check.
	if wantWire := marshalOracle(t, want); bytes.Equal(wire, wantWire) && !bytes.Equal(gotWire, wantWire) {
		t.Fatalf("%s: canonical bytes differ\nwant %x\ngot  %x", tc.name, wantWire, gotWire)
	}
}

func TestUnknownFieldsKeepOriginalTagEncoding(t *testing.T) {
	inputs := [][]byte{
		{0xa0, 0x86, 0, 0x81, 0},             // Non-minimal field 100 tag and varint value.
		{0xa3, 0x86, 0, 8, 1, 0xa4, 0x86, 0}, // Non-minimal group boundaries.
	}
	for _, tc := range messageCases() {
		for _, wire := range inputs {
			local := tc.newLocal()
			if err := local.Unmarshal(wire); err != nil {
				t.Fatalf("%s: %v", tc.name, err)
			}
			if got := marshalLocal(t, local); !bytes.Equal(got, wire) {
				t.Fatalf("%s changed unknown wire bytes: want %x, got %x", tc.name, wire, got)
			}
			compareDecode(t, tc, wire)
		}
	}
}

func TestWireAllMessagesAndFields(t *testing.T) {
	for _, tc := range messageCases() {
		t.Run(tc.name, func(t *testing.T) {
			full := tc.newOracle()
			fillOracle(full.ProtoReflect())
			for _, input := range [][]byte{nil, marshalOracle(t, full), unknownFields()} {
				compareDecode(t, tc, input)
			}
		})
	}
}

func TestUnmarshalResetsExistingMessage(t *testing.T) {
	for _, tc := range messageCases() {
		t.Run(tc.name, func(t *testing.T) {
			full, got := tc.newOracle(), tc.newLocal()
			fillOracle(full.ProtoReflect())
			if err := got.Unmarshal(marshalOracle(t, full)); err != nil {
				t.Fatal(err)
			}
			if err := got.Unmarshal(nil); err != nil {
				t.Fatal(err)
			}
			if wire := marshalLocal(t, got); len(wire) != 0 {
				t.Fatalf("Unmarshal retained old fields: %x", wire)
			}
		})
	}
}

func TestWireDuplicateAndScalarRules(t *testing.T) {
	cases := []struct {
		name string
		kind int
		wire []byte
	}{
		{"last string wins", 8, concat(bytesField(3, []byte("first")), bytesField(3, []byte("last")))},
		{"zero string overwrites", 8, concat(bytesField(3, []byte("first")), bytesField(3, nil))},
		{"last bytes wins", 0, concat(bytesField(2, []byte("first")), bytesField(2, []byte("last")))},
		{"zero bytes overwrites", 0, concat(bytesField(2, []byte("first")), bytesField(2, nil))},
		{"last integer wins", 11, concat(varintField(1, 1), varintField(1, 2))},
		{"zero integer overwrites", 11, concat(varintField(1, 1), varintField(1, 0))},
		{"boolean accepts nonzero", 9, varintField(3, 42)},
		{"boolean zero overwrites", 9, concat(varintField(3, 1), varintField(3, 0))},
		{"negative int32", 11, varintField(1, math.MaxUint64)},
		{"int32 truncates high bits", 11, varintField(1, 1<<32+17)},
		{"maximum int32", 11, varintField(1, math.MaxInt32)},
		{"nonminimal known varint", 11, []byte{8, 0x81, 0}},
		{"repeated strings append", 1, concat(bytesField(3, []byte("one")), bytesField(3, nil), bytesField(3, []byte("two")))},
		{"repeated messages append", 13, concat(bytesField(1, bytesField(1, []byte("one.ts"))), bytesField(1, nil))},
		{"nested messages merge", 12, concat(bytesField(1, bytesField(1, []byte("v1"))), bytesField(1, bytesField(2, []byte("sqlite"))))},
		{"nested scalar overwrite", 12, concat(bytesField(1, bytesField(2, []byte("sqlite"))), bytesField(1, bytesField(2, nil)))},
		{"empty nested keeps earlier fields", 12, concat(bytesField(1, bytesField(2, []byte("sqlite"))), bytesField(1, nil))},
		{"nested lists append on merge", 12, concat(bytesField(1, bytesField(3, []byte("one"))), bytesField(1, bytesField(3, []byte("two"))))},
		{"nested unknown fields append", 12, concat(bytesField(1, varintField(100, 1)), bytesField(1, varintField(100, 2)))},
		{"known string with wrong wire is unknown", 8, varintField(3, 7)},
		{"known integer with wrong wire is unknown", 11, bytesField(1, []byte("seven"))},
		{"known message with wrong wire is unknown", 12, varintField(1, 7)},
		{"known string with group wire is unknown", 8, concat(protowire.AppendTag(nil, 3, protowire.StartGroupType), varintField(1, 7), protowire.AppendTag(nil, 3, protowire.EndGroupType))},
		{"forward request field", 12, bytesField(127, []byte("future metadata"))},
		{"reserved historical field retained", 1, bytesField(5, []byte("legacy settings"))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) { compareDecode(t, messageCases()[tc.kind], tc.wire) })
	}
}

func TestWireRejectsMalformedInput(t *testing.T) {
	cases := []struct {
		name string
		wire []byte
	}{
		{"zero field number", []byte{0}},
		{"field number above maximum", varintField(protowire.MaxValidNumber+1, 0)},
		{"invalid wire type six", []byte{0x0e}},
		{"invalid wire type seven", []byte{0x0f}},
		{"truncated tag", []byte{0x80}},
		{"overflow tag", bytes.Repeat([]byte{0x80}, 10)},
		{"truncated varint", []byte{0x08, 0x80}},
		{"overflow varint", append([]byte{0x08}, bytes.Repeat([]byte{0xff}, 10)...)},
		{"truncated length", []byte{0x0a, 0x80}},
		{"overflow length", append([]byte{0x0a}, bytes.Repeat([]byte{0xff}, 10)...)},
		{"huge length", concat([]byte{0x0a}, protowire.AppendVarint(nil, math.MaxUint64))},
		{"truncated bytes", []byte{0x0a, 3, 1, 2}},
		{"truncated fixed64", []byte{0x09, 1, 2, 3}},
		{"truncated fixed32", []byte{0x0d, 1, 2, 3}},
		{"unexpected end group", []byte{0x0c}},
		{"unterminated group", []byte{0x0b}},
		{"mismatched end group", []byte{0x0b, 0x14}},
		{"malformed group contents", []byte{0x0b, 0, 0x0c}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, message := range messageCases() {
				if err := message.newLocal().Unmarshal(tc.wire); err == nil {
					t.Errorf("%s accepted malformed input %x", message.name, tc.wire)
				}
				compareDecode(t, message, tc.wire)
			}
		})
	}
}

func TestWireValidatesUTF8(t *testing.T) {
	invalid := []byte{0xff, 0xc0, 0x80}
	for _, tc := range messageCases() {
		fields := tc.newOracle().ProtoReflect().Descriptor().Fields()
		for i := 0; i < fields.Len(); i++ {
			field := fields.Get(i)
			if field.Kind() != protoreflect.StringKind {
				continue
			}
			t.Run(tc.name+"/"+string(field.Name()), func(t *testing.T) {
				if err := tc.newLocal().Unmarshal(bytesField(protowire.Number(field.Number()), invalid)); err == nil {
					t.Fatal("Unmarshal accepted invalid UTF-8 string")
				}
				local := tc.newLocal()
				value := reflect.ValueOf(local).Elem().FieldByName(oracleFieldName(tc.newOracle(), field.Number()))
				if field.IsList() {
					value.Set(reflect.ValueOf([]string{string(invalid)}))
				} else {
					value.SetString(string(invalid))
				}
				if _, err := local.Marshal(); err == nil {
					t.Fatal("Marshal accepted invalid UTF-8 string")
				}
			})
		}
	}
	// Byte fields and future fields are arbitrary bytes, not UTF-8 strings.
	compareDecode(t, messageCases()[0], bytesField(2, invalid))
	compareDecode(t, messageCases()[12], bytesField(100, invalid))
	request := &protocol.GenerateRequest{Settings: &protocol.Settings{Engine: string(invalid)}}
	if _, err := request.Marshal(); err == nil {
		t.Fatal("Marshal accepted invalid UTF-8 in nested message")
	}
	if err := request.Unmarshal(bytesField(1, bytesField(2, invalid))); err == nil {
		t.Fatal("Unmarshal accepted invalid UTF-8 in nested message")
	}
}

func nestedGroups(depth int) []byte {
	var wire []byte
	for i := 0; i < depth; i++ {
		wire = protowire.AppendTag(wire, 100, protowire.StartGroupType)
	}
	for i := 0; i < depth; i++ {
		wire = protowire.AppendTag(wire, 100, protowire.EndGroupType)
	}
	return wire
}

func TestWireDepthLimit(t *testing.T) {
	// Count the root message as depth 1. The schema has no recursive messages,
	// but unknown groups can nest without bound unless the codec caps them.
	if err := (&protocol.GenerateRequest{}).Unmarshal(nestedGroups(99)); err != nil {
		t.Fatalf("100 total levels should fit: %v", err)
	}
	for _, depth := range []int{100, 101, 1000} {
		if err := (&protocol.GenerateRequest{}).Unmarshal(nestedGroups(depth)); err == nil {
			t.Fatalf("accepted %d total levels", depth+1)
		}
	}
	if err := (&protocol.GenerateRequest{}).Unmarshal(bytesField(1, nestedGroups(99))); err == nil {
		t.Fatal("nested messages did not consume the same depth budget as groups")
	}
}

func TestMarshalRespectsUnknownGroupDepth(t *testing.T) {
	for _, groups := range []int{98, 99} {
		identifier := &protocol.Identifier{}
		if err := identifier.Unmarshal(nestedGroups(groups)); err != nil {
			t.Fatal(err)
		}
		// Reusing a decoded message deeper in another object must account for
		// its unknown groups, as well as its known message fields.
		column := &protocol.Column{Type: identifier}
		wire, err := column.Marshal()
		if groups == 99 {
			if err == nil {
				t.Fatal("Marshal accepted 101 levels after nesting decoded unknown groups")
			}
			continue
		}
		if err != nil {
			t.Fatalf("100 levels should fit: %v", err)
		}
		if err := (&protocol.Column{}).Unmarshal(wire); err != nil {
			t.Fatalf("Marshal produced output its own decoder rejects: %v", err)
		}
	}
}

func TestCloneAndInputOwnership(t *testing.T) {
	for _, tc := range messageCases() {
		t.Run(tc.name, func(t *testing.T) {
			nilMessage := reflect.Zero(reflect.TypeOf(tc.newLocal())).Interface().(wireMessage)
			if !reflect.ValueOf(tc.clone(nilMessage)).IsNil() {
				t.Fatal("Clone of nil message must remain nil")
			}
			full := tc.newOracle()
			fillOracle(full.ProtoReflect())
			input := marshalOracle(t, full)
			want := bytes.Clone(input)
			original := tc.newLocal()
			if err := original.Unmarshal(input); err != nil {
				t.Fatal(err)
			}
			clear(input)
			if got := marshalLocal(t, original); !bytes.Equal(got, want) {
				t.Fatal("Unmarshal retained an alias to its input")
			}
			clone := tc.clone(original)
			if !reflect.DeepEqual(original, clone) {
				t.Fatal("Clone changed message fields or presence")
			}
			mutateExported(reflect.ValueOf(original))
			if got := marshalLocal(t, clone); !bytes.Equal(got, want) {
				t.Fatal("Clone shares mutable fields with the original")
			}
			output := marshalLocal(t, clone)
			clear(output)
			if got := marshalLocal(t, clone); !bytes.Equal(got, want) {
				t.Fatal("Marshal returned an alias to message storage")
			}
		})
	}
	var absent *protocol.GenerateRequest
	if absent.Clone() != nil {
		t.Fatal("Clone of nil message must remain nil")
	}
	request := &protocol.GenerateRequest{Settings: &protocol.Settings{}, Queries: []*protocol.Query{nil, {Params: []*protocol.Parameter{nil}}}}
	copy := request.Clone()
	if !reflect.DeepEqual(request, copy) || copy.Settings == request.Settings || copy.Queries[1] == request.Queries[1] {
		t.Fatal("Clone failed to preserve nil, empty, or present nested messages")
	}
}

func mutateExported(value reflect.Value) {
	if value.Kind() == reflect.Pointer {
		if !value.IsNil() {
			mutateExported(value.Elem())
		}
		return
	}
	switch value.Kind() {
	case reflect.Struct:
		for i := 0; i < value.NumField(); i++ {
			if value.Field(i).CanSet() {
				mutateExported(value.Field(i))
			}
		}
	case reflect.Slice:
		for i := 0; i < value.Len(); i++ {
			mutateExported(value.Index(i))
		}
	case reflect.String:
		value.SetString("changed")
	case reflect.Bool:
		value.SetBool(!value.Bool())
	case reflect.Int32:
		value.SetInt(17)
	case reflect.Uint8:
		value.SetUint(value.Uint() ^ 0xff)
	}
}

func FuzzWireOracle(f *testing.F) {
	cases := messageCases()
	for i, tc := range cases {
		full := tc.newOracle()
		fillOracle(full.ProtoReflect())
		f.Add(uint8(i), marshalOracle(f, full))
		f.Add(uint8(i), []byte{})
		f.Add(uint8(i), unknownFields())
	}
	f.Add(uint8(12), concat(bytesField(1, bytesField(1, []byte("v1"))), bytesField(1, bytesField(2, []byte("sqlite")))))
	f.Fuzz(func(t *testing.T, index uint8, wire []byte) {
		// v1.31's oracle applies its depth option to known messages, but its
		// unknown-group skipper has a separate 10,000-level limit. Reserve
		// ten levels for known messages (the pinned schema needs at most six)
		// and keep this differential test below our group limit. The exact
		// limit has its own test above.
		if tooManyPossibleGroups(wire) {
			t.Skip()
		}
		if len(wire) > 1<<16 {
			t.Skip()
		}
		compareDecode(t, cases[int(index)%len(cases)], wire)
	})
}

// This conservative scan may skip byte payloads that resemble groups. It does
// not grant malformed input any special acceptance in the codec itself.
func tooManyPossibleGroups(wire []byte) bool {
	count := 0
	for _, b := range wire {
		if b&7 == byte(protowire.StartGroupType) {
			count++
			if count >= 90 {
				return true
			}
		}
	}
	return false
}

func oracleFieldName(message proto.Message, number protoreflect.FieldNumber) string {
	value := reflect.TypeOf(message).Elem()
	want := strconv.FormatInt(int64(number), 10)
	for i := 0; i < value.NumField(); i++ {
		field := value.Field(i)
		tag := strings.Split(field.Tag.Get("protobuf"), ",")
		if len(tag) >= 2 && tag[1] == want {
			return field.Name
		}
	}
	panic("missing Go field in generated oracle")
}
