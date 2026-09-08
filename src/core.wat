;; Hand-written WASI and Protocol Buffer support.
;;
;; This file is a module-body fragment. The build script puts it inside one
;; (module ...) with the generator fragments. Imports must precede definitions.
;; There is no malloc, free, garbage collector, memory.grow, or hidden parser
;; cursor. Each parser call receives its own byte bounds and returns its next
;; byte position, so a caller may parse nested messages without saving globals.
;;
;; The module has exactly 1024 WebAssembly pages: 64 MiB at startup and at most
;; 64 MiB for its entire life. A byte range has an exclusive end, as in [p,end).
;; All address comparisons are unsigned, and every variable-size access checks
;; the range before an addition can wrap.
;;
;; Fixed memory ownership:
;;       0..8191     generator literals
;;    8192..16383    this file's diagnostics, WASI records, and group stack
;;   16384..33554431 generator scratch, literals, and fixed record tables
;; 33554432..50331647 request bytes, compacted in place by the generator
;; 50331648..67108863 output buffer
;;
;; The core only writes in its scratch range and in the initial input range.
;; A request byte is not changed by any protobuf helper. The generator may
;; reuse bytes once its own records no longer refer to them.

(import "wasi_snapshot_preview1" "fd_read"
  (func $wasi_fd_read (param i32 i32 i32 i32) (result i32)))
(import "wasi_snapshot_preview1" "fd_write"
  (func $wasi_fd_write (param i32 i32 i32 i32) (result i32)))
(import "wasi_snapshot_preview1" "proc_exit"
  (func $wasi_proc_exit (param i32)))

(memory (export "memory") 1024 1024)
(global $input_base i32 (i32.const 33554432))
(global $input_limit i32 (i32.const 50331648))
(global $output_base i32 (i32.const 50331648))
(global $memory_limit i32 (i32.const 67108864))

;; Exact protobuf diagnostics match the released plugin. Slots are128bytes,
;; avoiding overlap with iovecs at9216 even when an error contains long text.
;; Depth has its own code18 so malformed groups still report wire errors.
(data (i32.const 8192) "error generating output: invalid protobuf wire data\0a")
(data (i32.const 8320) "error generating output: protobuf string contains invalid UTF-8\0a")
(data (i32.const 8448) "error generating output: protobuf nesting exceeds 100 levels\0a")
(data (i32.const 8576) "error generating output: input read failed\0a")
(data (i32.const 8704) "error generating output: input exceeds fixed memory capacity\0a")
(data (i32.const 8832) "error generating output: output write failed\0a")
(data (i32.const 8960) "error generating output: request exceeds fixed memory capacity\0a")

;; Report directly instead of calling write_all, which itself uses fail. Retry
;; short stderr writes, but exit if stderr fails or makes no forward progress.
(func $fail (param $code i32)
  (local $p i32) (local $n i32) (local $written i32)
  (local.set $p (i32.const 8960)) (local.set $n (i32.const 63))
  (if (i32.le_u (i32.sub (local.get $code) (i32.const 4)) (i32.const 4))
    (then (local.set $p (i32.const 8192)) (local.set $n (i32.const 52))))
  (if (i32.eq (local.get $code) (i32.const 9))
    (then (local.set $p (i32.const 8320)) (local.set $n (i32.const 64))))
  (if (i32.eq (local.get $code) (i32.const 18))
    (then (local.set $p (i32.const 8448)) (local.set $n (i32.const 61))))
  (if (i32.eq (local.get $code) (i32.const 1))
    (then (local.set $p (i32.const 8576)) (local.set $n (i32.const 43))))
  (if (i32.eq (local.get $code) (i32.const 2))
    (then (local.set $p (i32.const 8704)) (local.set $n (i32.const 61))))
  (if (i32.eq (local.get $code) (i32.const 3))
    (then (local.set $p (i32.const 8832)) (local.set $n (i32.const 45))))
  (block $done (loop $write
    (br_if $done (i32.eqz (local.get $n)))
    (i32.store (i32.const 9216) (local.get $p)) (i32.store (i32.const 9220) (local.get $n))
    (i32.store (i32.const 9232) (i32.const 0))
    (br_if $done (call $wasi_fd_write (i32.const 2) (i32.const 9216) (i32.const 1) (i32.const 9232)))
    (local.set $written (i32.load (i32.const 9232)))
    (br_if $done (i32.or (i32.eqz (local.get $written)) (i32.gt_u (local.get $written) (local.get $n))))
    (local.set $p (i32.add (local.get $p) (local.get $written)))
    (local.set $n (i32.sub (local.get $n) (local.get $written))) (br $write)))
  (call $wasi_proc_exit (i32.const 2)) unreachable)

;; Write every requested byte, including when a host accepts only part of an
;; iovec. A successful zero-byte write would make no progress, so fail instead
;; of looping forever. The caller keeps [p,p+n) alive until this returns.
;; WASI scratch: one eight-byte iovec at 9216, byte count at 9232.
(func $write_all (param $fd i32) (param $p i32) (param $n i32)
  (local $written i32)
  (if (i32.gt_u (local.get $p) (i32.const 67108864))
    (then (call $fail (i32.const 3))))
  (if (i32.gt_u (local.get $n) (i32.sub (i32.const 67108864) (local.get $p)))
    (then (call $fail (i32.const 3))))
  (block $done
    (loop $again
      (br_if $done (i32.eqz (local.get $n)))
      (i32.store (i32.const 9216) (local.get $p))
      (i32.store (i32.const 9220) (local.get $n))
      (i32.store (i32.const 9232) (i32.const 0))
      (if (call $wasi_fd_write
        (local.get $fd) (i32.const 9216) (i32.const 1) (i32.const 9232))
        (then (call $fail (i32.const 3))))
      (local.set $written (i32.load (i32.const 9232)))
      (if (i32.or (i32.eqz (local.get $written))
        (i32.gt_u (local.get $written) (local.get $n)))
        (then (call $fail (i32.const 3))))
      (local.set $p (i32.add (local.get $p) (local.get $written)))
      (local.set $n (i32.sub (local.get $n) (local.get $written)))
      (br $again))))

;; Read stdin into its single final buffer and return its byte length. There
;; is no intermediate buffer and no copying when the host returns short reads.
;; The buffer has 16,777,216 bytes. If it fills exactly, read one probe byte into
;; scratch at 9248 to tell an exact-fit request from an oversized request.
;; The probe never overwrites input, generator records, or the group stack.
(func $read_input (result i32)
  (local $total i32) (local $room i32) (local $n i32)
  (loop $again
    (local.set $room (i32.sub (i32.const 16777216) (local.get $total)))
    (if (i32.eqz (local.get $room))
      (then
        (i32.store (i32.const 9216) (i32.const 9248))
        (i32.store (i32.const 9220) (i32.const 1)))
      (else
        (i32.store (i32.const 9216) (i32.add (i32.const 33554432) (local.get $total)))
        (i32.store (i32.const 9220) (local.get $room))))
    (i32.store (i32.const 9232) (i32.const 0))
    (if (call $wasi_fd_read
      (i32.const 0) (i32.const 9216) (i32.const 1) (i32.const 9232))
      (then (call $fail (i32.const 1))))
    (local.set $n (i32.load (i32.const 9232)))
    (if (i32.eqz (local.get $n)) (then (return (local.get $total))))
    (if (i32.eqz (local.get $room)) (then (call $fail (i32.const 2))))
    (if (i32.gt_u (local.get $n) (local.get $room))
      (then (call $fail (i32.const 1))))
    (local.set $total (i32.add (local.get $total) (local.get $n)))
    (br $again))
  unreachable)

;; Decode one unsigned protobuf varint. Results appear on the Wasm stack in
;; declaration order: next position, then value. A caller normally stores
;; them in reverse order, for example: call $varint; local.set $v; local.set $p.
;; Signed protobuf int32/int64 fields use the same raw bits. Their caller is
;; responsible for the field's signed interpretation or zig-zag conversion.
;;
;; Protobuf accepts an overlong encoding, but never more than ten bytes, and
;; the tenth byte must be 0 or 1. Checking that byte before the shift avoids
;; silently discarding high bits at the 64-bit boundary.
(func $varint (param $p i32) (param $end i32) (result i32 i64)
  (local $value i64) (local $b i32) (local $index i32)
  (if (i32.or (i32.gt_u (local.get $p) (local.get $end))
    (i32.gt_u (local.get $end) (i32.const 67108864)))
    (then (call $fail (i32.const 4))))
  (loop $again
    (if (i32.ge_u (local.get $p) (local.get $end))
      (then (call $fail (i32.const 4))))
    (local.set $b (i32.load8_u (local.get $p)))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (if (i32.and (i32.eq (local.get $index) (i32.const 9))
      (i32.gt_u (local.get $b) (i32.const 1)))
      (then (call $fail (i32.const 5))))
    (local.set $value (i64.or (local.get $value)
      (i64.shl (i64.extend_i32_u (i32.and (local.get $b) (i32.const 127)))
        (i64.extend_i32_u (i32.mul (local.get $index) (i32.const 7))))))
    (if (i32.eqz (i32.and (local.get $b) (i32.const 128)))
      (then (return (local.get $p) (local.get $value))))
    (local.set $index (i32.add (local.get $index) (i32.const 1)))
    (br $again))
  unreachable)

;; Check a decoded tag and return its field number and wire type. A field
;; number is in 1..536870911. Tags are at most 32 bits even though their wire
;; representation uses the general 64-bit varint reader. Reserved schema
;; field numbers are still legal unknown wire fields and are not rejected.
(func $tag_parts (param $tag i64) (result i32 i32)
  (local $n i32)
  (if (i64.gt_u (local.get $tag) (i64.const 4294967295))
    (then (call $fail (i32.const 6))))
  (local.set $n (i32.shr_u (i32.wrap_i64 (local.get $tag)) (i32.const 3)))
  (if (i32.eqz (local.get $n)) (then (call $fail (i32.const 6))))
  (local.get $n)
  (i32.and (i32.wrap_i64 (local.get $tag)) (i32.const 7)))

;; Skip an unknown start-group field through its matching end-group tag.
;; Groups are deprecated protobuf syntax but remain legal in unknown data.
;; Use a fixed 100-entry stack of field numbers at 12288, rather than recurse
;; or allocate. The stack exists only during this call. skip_group never calls
;; field or itself, so parsing a later nested message cannot disturb a live
;; group stack. Each end-group must match the most recent start-group number.
(func $skip_group (param $p i32) (param $end i32) (param $number i32) (param $nesting i32) (result i32)
  (local $depth i32) (local $v i64) (local $n i32) (local $wire i32) (local $size i32)
  (if (i32.ge_u (local.get $nesting) (i32.const 100))
    (then (call $fail (i32.const 18))))
  (local.set $depth (i32.const 1))
  (i32.store (i32.const 12288) (local.get $number))
  (loop $again
    (call $varint (local.get $p) (local.get $end))
    local.set $v
    local.set $p
    (call $tag_parts (local.get $v))
    local.set $wire
    local.set $n
    (if (i32.eq (local.get $wire) (i32.const 3))
      (then
        (if (i32.ge_u (local.get $depth) (i32.sub (i32.const 100) (local.get $nesting)))
          (then (call $fail (i32.const 18))))
        (i32.store (i32.add (i32.const 12288) (i32.shl (local.get $depth) (i32.const 2)))
          (local.get $n))
        (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
        (br $again)))
    (if (i32.eq (local.get $wire) (i32.const 4))
      (then
        (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
        (if (i32.ne (local.get $n)
          (i32.load (i32.add (i32.const 12288) (i32.shl (local.get $depth) (i32.const 2)))))
          (then (call $fail (i32.const 6))))
        (if (i32.eqz (local.get $depth)) (then (return (local.get $p))))
        (br $again)))
    (if (i32.eqz (local.get $wire))
      (then
        (call $varint (local.get $p) (local.get $end))
        drop
        local.set $p
        (br $again)))
    (local.set $size (i32.const 0))
    (if (i32.eq (local.get $wire) (i32.const 1))
      (then (local.set $size (i32.const 8)))
      (else (if (i32.eq (local.get $wire) (i32.const 5))
        (then (local.set $size (i32.const 4)))
        (else (if (i32.eq (local.get $wire) (i32.const 2))
          (then
            (call $varint (local.get $p) (local.get $end))
            local.set $v
            local.set $p
            (if (i64.gt_u (local.get $v) (i64.extend_i32_u (i32.sub (local.get $end) (local.get $p))))
              (then (call $fail (i32.const 8))))
            (local.set $size (i32.wrap_i64 (local.get $v))))
          (else (call $fail (i32.const 7))))))))
    (if (i32.gt_u (local.get $size) (i32.sub (local.get $end) (local.get $p)))
      (then (call $fail (i32.const 8))))
    (local.set $p (i32.add (local.get $p) (local.get $size)))
    (br $again))
  unreachable)

;; Read one complete field and return:
;;   next, field number, wire type, integer value, payload pointer, payload size
;; The integer result matters only for wire type 0. The pointer and length
;; matter only for wire type 2; they borrow the original input bytes and stay
;; valid until the caller overwrites those bytes. Fixed-width unknown values
;; and groups are safely skipped. An end-group outside skip_group is invalid.
;;
;; The helper does not know schema types. A known field number with a wrong
;; wire type is still a legal unknown field; the caller must match both.
(func $field (param $p i32) (param $end i32) (result i32 i32 i32 i64 i32 i32)
  (call $field_depth (local.get $p) (local.get $end) (i32.const 1)))

;; A containing message consumes one level of the shared protobuf nesting
;; budget. The root message has nesting=1. Schema decoders must pass nesting+1
;; when entering another message. This explicit form lets groups and messages
;; share the same 100-level limit without any global recursion counter.
(func $field_depth (param $p i32) (param $end i32) (param $nesting i32) (result i32 i32 i32 i64 i32 i32)
  (local $number i32) (local $wire i32) (local $value i64)
  (local $payload i32) (local $size i32)
  (if (i32.or (i32.eqz (local.get $nesting)) (i32.gt_u (local.get $nesting) (i32.const 100)))
    (then (call $fail (i32.const 18))))
  (call $varint (local.get $p) (local.get $end))
  local.set $value
  local.set $p
  (call $tag_parts (local.get $value))
  local.set $wire
  local.set $number
  (local.set $value (i64.const 0))
  (if (i32.eqz (local.get $wire))
    (then
      (call $varint (local.get $p) (local.get $end))
      local.set $value
      local.set $p)
    (else (if (i32.eq (local.get $wire) (i32.const 2))
      (then
        (call $varint (local.get $p) (local.get $end))
        local.set $value
        local.set $p
        (if (i64.gt_u (local.get $value) (i64.extend_i32_u (i32.sub (local.get $end) (local.get $p))))
          (then (call $fail (i32.const 8))))
        (local.set $payload (local.get $p))
        (local.set $size (i32.wrap_i64 (local.get $value)))
        (local.set $p (i32.add (local.get $p) (local.get $size)))
        (local.set $value (i64.const 0)))
      (else (if (i32.eq (local.get $wire) (i32.const 3))
        (then (local.set $p (call $skip_group (local.get $p) (local.get $end) (local.get $number) (local.get $nesting))))
        (else
          (if (i32.eq (local.get $wire) (i32.const 4))
            (then (call $fail (i32.const 6))))
          (if (i32.eq (local.get $wire) (i32.const 1))
            (then (local.set $size (i32.const 8)))
            (else (if (i32.eq (local.get $wire) (i32.const 5))
              (then (local.set $size (i32.const 4)))
              (else (call $fail (i32.const 7))))))
          (if (i32.gt_u (local.get $size) (i32.sub (local.get $end) (local.get $p)))
            (then (call $fail (i32.const 8))))
          (local.set $p (i32.add (local.get $p) (local.get $size)))
          (local.set $size (i32.const 0))))))))
  (local.get $p)
  (local.get $number)
  (local.get $wire)
  (local.get $value)
  (local.get $payload)
  (local.get $size))

;; Find the last length-delimited occurrence of a field in an entire message.
;; Return (0,0) when absent; an empty present field has a nonzero input pointer
;; with length zero. Unknown fields and same-number/wrong-wire fields are
;; skipped. Scan to the end even after a match so malformed trailing bytes
;; cannot be hidden behind an otherwise usable value.
;;
;; This is appropriate for protobuf bytes/string scalar fields. A singular
;; MESSAGE field must instead merge all its occurrences, and repeated fields
;; need a caller-owned loop over field; find deliberately does neither.
(func $find (param $p i32) (param $len i32) (param $number i32) (result i32 i32)
  (local $end i32) (local $n i32) (local $wire i32) (local $ptr i32) (local $size i32)
  (local $found i32) (local $found_size i32)
  (if (i32.gt_u (local.get $p) (i32.const 67108864))
    (then (call $fail (i32.const 8))))
  (if (i32.gt_u (local.get $len) (i32.sub (i32.const 67108864) (local.get $p)))
    (then (call $fail (i32.const 8))))
  (local.set $end (i32.add (local.get $p) (local.get $len)))
  (block $done
    (loop $again
      (br_if $done (i32.eq (local.get $p) (local.get $end)))
      (call $field (local.get $p) (local.get $end))
      local.set $size
      local.set $ptr
      drop
      local.set $wire
      local.set $n
      local.set $p
      (if (i32.and (i32.eq (local.get $n) (local.get $number))
        (i32.eq (local.get $wire) (i32.const 2)))
        (then (local.set $found (local.get $ptr)) (local.set $found_size (local.get $size))))
      (br $again)))
  (local.get $found)
  (local.get $found_size))

;; Validate UTF-8 without copying, normalizing, or building strings. Reject
;; overlong forms, lone continuation bytes, UTF-16 surrogate code points,
;; and values above U+10FFFF. Zero bytes and the Unicode replacement character
;; are valid scalar values. Length tests precede each multibyte read.
(func $utf8 (param $p i32) (param $len i32)
  (local $end i32) (local $b i32) (local $b1 i32) (local $b2 i32) (local $b3 i32)
  (if (i32.gt_u (local.get $p) (i32.const 67108864))
    (then (call $fail (i32.const 9))))
  (if (i32.gt_u (local.get $len) (i32.sub (i32.const 67108864) (local.get $p)))
    (then (call $fail (i32.const 9))))
  (local.set $end (i32.add (local.get $p) (local.get $len)))
  (block $done
    (loop $again
      (br_if $done (i32.eq (local.get $p) (local.get $end)))
      (local.set $b (i32.load8_u (local.get $p)))
      (if (i32.lt_u (local.get $b) (i32.const 128))
        (then (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $again)))
      (if (i32.and (i32.ge_u (local.get $b) (i32.const 194))
        (i32.le_u (local.get $b) (i32.const 223)))
        (then
          (if (i32.lt_u (i32.sub (local.get $end) (local.get $p)) (i32.const 2))
            (then (call $fail (i32.const 9))))
          (local.set $b1 (i32.load8_u offset=1 (local.get $p)))
          (if (i32.ne (i32.and (local.get $b1) (i32.const 192)) (i32.const 128))
            (then (call $fail (i32.const 9))))
          (local.set $p (i32.add (local.get $p) (i32.const 2)))
          (br $again)))
      (if (i32.and (i32.ge_u (local.get $b) (i32.const 224))
        (i32.le_u (local.get $b) (i32.const 239)))
        (then
          (if (i32.lt_u (i32.sub (local.get $end) (local.get $p)) (i32.const 3))
            (then (call $fail (i32.const 9))))
          (local.set $b1 (i32.load8_u offset=1 (local.get $p)))
          (local.set $b2 (i32.load8_u offset=2 (local.get $p)))
          (if (i32.or
            (i32.ne (i32.and (local.get $b1) (i32.const 192)) (i32.const 128))
            (i32.ne (i32.and (local.get $b2) (i32.const 192)) (i32.const 128)))
            (then (call $fail (i32.const 9))))
          (if (i32.and (i32.eq (local.get $b) (i32.const 224))
            (i32.lt_u (local.get $b1) (i32.const 160)))
            (then (call $fail (i32.const 9))))
          (if (i32.and (i32.eq (local.get $b) (i32.const 237))
            (i32.gt_u (local.get $b1) (i32.const 159)))
            (then (call $fail (i32.const 9))))
          (local.set $p (i32.add (local.get $p) (i32.const 3)))
          (br $again)))
      (if (i32.and (i32.ge_u (local.get $b) (i32.const 240))
        (i32.le_u (local.get $b) (i32.const 244)))
        (then
          (if (i32.lt_u (i32.sub (local.get $end) (local.get $p)) (i32.const 4))
            (then (call $fail (i32.const 9))))
          (local.set $b1 (i32.load8_u offset=1 (local.get $p)))
          (local.set $b2 (i32.load8_u offset=2 (local.get $p)))
          (local.set $b3 (i32.load8_u offset=3 (local.get $p)))
          (if (i32.or
            (i32.ne (i32.and (local.get $b1) (i32.const 192)) (i32.const 128))
            (i32.or
              (i32.ne (i32.and (local.get $b2) (i32.const 192)) (i32.const 128))
              (i32.ne (i32.and (local.get $b3) (i32.const 192)) (i32.const 128))))
            (then (call $fail (i32.const 9))))
          (if (i32.and (i32.eq (local.get $b) (i32.const 240))
            (i32.lt_u (local.get $b1) (i32.const 144)))
            (then (call $fail (i32.const 9))))
          (if (i32.and (i32.eq (local.get $b) (i32.const 244))
            (i32.gt_u (local.get $b1) (i32.const 143)))
            (then (call $fail (i32.const 9))))
          (local.set $p (i32.add (local.get $p) (i32.const 4)))
          (br $again)))
      (call $fail (i32.const 9)))))
