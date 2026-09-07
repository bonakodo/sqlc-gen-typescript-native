package protocol

import "errors"

// Limit message and unknown-group nesting together. The pinned schema has no
// recursive messages, but a future field may contain groups of any depth.
const maxDepth = 100

var (
	errMalformed = errors.New("invalid protobuf wire data")
	errUTF8      = errors.New("protobuf string contains invalid UTF-8")
	errDepth     = errors.New("protobuf nesting exceeds 100 levels")
	errNil       = errors.New("cannot unmarshal into a nil protobuf message")
)

func appendVarint(b []byte, v uint64) []byte {
	for v >= 0x80 {
		b = append(b, byte(v)|0x80)
		v >>= 7
	}
	return append(b, byte(v))
}

func appendBytes(b, v []byte) []byte {
	b = appendVarint(b, uint64(len(v)))
	return append(b, v...)
}

func consumeVarint(b []byte) (uint64, int, error) {
	var v uint64
	for i := 0; i < 10 && i < len(b); i++ {
		c := b[i]
		if i == 9 && c > 1 {
			return 0, 0, errMalformed
		}
		v |= uint64(c&0x7f) << (7 * i)
		if c < 0x80 {
			return v, i + 1, nil
		}
	}
	return 0, 0, errMalformed
}

func consumeTag(b []byte) (uint32, byte, int, error) {
	v, n, err := consumeVarint(b)
	if err != nil || v>>3 == 0 || v>>3 > 1<<29-1 {
		return 0, 0, 0, errMalformed
	}
	return uint32(v >> 3), byte(v & 7), n, nil
}

func consumeBytes(b []byte) ([]byte, int, error) {
	v, n, err := consumeVarint(b)
	if err != nil || v > uint64(len(b)-n) {
		return nil, 0, errMalformed
	}
	end := n + int(v)
	return b[n:end], end, nil
}

// skipField validates unknown fields while leaving their exact bytes intact.
// Known fields with a different wire type also follow this path, as required by
// protobuf's forward-compatibility rules.
func skipField(b []byte, number uint32, wire byte, depth int) (int, error) {
	switch wire {
	case 0:
		_, n, err := consumeVarint(b)
		return n, err
	case 1:
		if len(b) < 8 {
			return 0, errMalformed
		}
		return 8, nil
	case 2:
		_, n, err := consumeBytes(b)
		return n, err
	case 3:
		if depth <= 1 {
			return 0, errDepth
		}
		offset := 0
		for offset < len(b) {
			inner, kind, n, err := consumeTag(b[offset:])
			if err != nil {
				return 0, err
			}
			offset += n
			if kind == 4 {
				if inner != number {
					return 0, errMalformed
				}
				return offset, nil
			}
			n, err = skipField(b[offset:], inner, kind, depth-1)
			if err != nil {
				return 0, err
			}
			offset += n
		}
	case 5:
		if len(b) < 4 {
			return 0, errMalformed
		}
		return 4, nil
	}
	return 0, errMalformed
}

func cloneBytes(b []byte) []byte {
	if b == nil {
		return nil
	}
	return append([]byte{}, b...)
}

// appendUnknown checks the remaining depth budget again because callers can
// move a decoded message under another message before encoding it.
func appendUnknown(b, unknown []byte, depth int) ([]byte, error) {
	for rest := unknown; len(rest) > 0; {
		number, wire, n, err := consumeTag(rest)
		if err != nil {
			return nil, err
		}
		rest = rest[n:]
		n, err = skipField(rest, number, wire, depth)
		if err != nil {
			return nil, err
		}
		rest = rest[n:]
	}
	return append(b, unknown...), nil
}
