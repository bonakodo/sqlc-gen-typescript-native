package typescript

import "reflect"

// Compare all fields, including unknown bytes and malformed strings used by
// fuzz cases. Encoding could reject those strings even when nothing changed.
func wireEqual(a, b any) bool { return reflect.DeepEqual(a, b) }
