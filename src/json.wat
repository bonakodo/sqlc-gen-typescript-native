;; Allocation-free JSON reader with Go encoding/json Unicode replacement. This is a module-body fragment.
;;
;; Memory ownership:
;;   * The caller owns writable UTF-8 input and must keep it alive while tokens
;;     are in use. In the complete program input lives at or above 4 MiB.
;;   * The fixed token table occupies [1048576, 1441792): 16384 * 24 bytes.
;;     Input MUST NOT overlap that table. No heap, memory.grow, or free exists.
;;   * String decoding writes only at or behind the cursor, inside the same
;;     string. Malformed raw UTF-8 uses checked scratch [1441792,2097152),
;;     because U+FFFD may occupy more bytes than the bad input it replaces.
;;     Neither path overwrites unread input. Token strings are therefore
;;     views into the caller's buffer, not copies or NUL-terminated strings.
;;   * A new parse invalidates every token from the previous parse. Already
;;     decoded source bytes cannot be parsed again as the original JSON.
;;
;; Each token contains six little-endian i32 words:
;;   kind, byte pointer, byte length, exclusive subtree end, child count, zero.
;; Kinds: object=1, array=2, string=3, number=4, true=5, false=6, null=7.
;; Object children alternate key and value; its child count is twice the number
;; of members. Container byte ranges retain their source range; strings point
;; at decoded bytes without quotes. Tokens use preorder, so skipping a subtree
;; requires only one table lookup. Duplicate object keys remain in the table;
;; json_get deliberately returns the LAST matching value, as Go JSON does.
;;
;; Errors: 11 = invalid JSON / nesting / input range; 12 = token capacity.
;; The host module supplies $fail(code) and fixed memory.

(global $json_token_count (mut i32) (i32.const 0))
(global $json_scratch_cursor (mut i32) (i32.const 1441792))
(global $json_cursor (mut i32) (i32.const 0))
(global $json_end (mut i32) (i32.const 0))

(func $json_error
  (call $fail (i32.const 11))
  unreachable)

(func $json_address (param $i i32) (result i32)
  (i32.add (i32.const 1048576) (i32.mul (local.get $i) (i32.const 24))))

;; Invalid indices have kind zero, allowing optional-property callers to test
;; a missing json_get/json_at result without touching memory outside the table.
(func $json_kind (param $i i32) (result i32)
  (if (result i32) (i32.lt_u (local.get $i) (global.get $json_token_count))
    (then (i32.load (call $json_address (local.get $i))))
    (else (i32.const 0))))

(func $json_ptr (param $i i32) (result i32)
  (if (result i32) (i32.lt_u (local.get $i) (global.get $json_token_count))
    (then (i32.load offset=4 (call $json_address (local.get $i))))
    (else (i32.const 0))))

(func $json_len (param $i i32) (result i32)
  (if (result i32) (i32.lt_u (local.get $i) (global.get $json_token_count))
    (then (i32.load offset=8 (call $json_address (local.get $i))))
    (else (i32.const 0))))

(func $json_new (param $kind i32) (param $p i32) (result i32)
  (local $i i32) (local $a i32)
  (local.set $i (global.get $json_token_count))
  (if (i32.ge_u (local.get $i) (i32.const 16384))
    (then (call $fail (i32.const 12)) unreachable))
  (global.set $json_token_count (i32.add (local.get $i) (i32.const 1)))
  (local.set $a (call $json_address (local.get $i)))
  (i32.store (local.get $a) (local.get $kind))
  (i32.store offset=4 (local.get $a) (local.get $p))
  (i32.store offset=8 (local.get $a) (i32.const 0))
  (i32.store offset=12 (local.get $a) (global.get $json_token_count))
  (i32.store offset=16 (local.get $a) (i32.const 0))
  (i32.store offset=20 (local.get $a) (i32.const 0))
  (local.get $i))

;; Peek uses -1 as an EOF marker. Every actual load has this range check.
(func $json_peek (result i32)
  (if (result i32) (i32.lt_u (global.get $json_cursor) (global.get $json_end))
    (then (i32.load8_u (global.get $json_cursor)))
    (else (i32.const -1))))

(func $json_take (result i32)
  (local $c i32)
  (local.set $c (call $json_peek))
  (if (i32.eq (local.get $c) (i32.const -1)) (then (call $json_error)))
  (global.set $json_cursor (i32.add (global.get $json_cursor) (i32.const 1)))
  (local.get $c))

(func $json_expect (param $c i32)
  (if (i32.ne (call $json_take) (local.get $c)) (then (call $json_error))))

(func $json_space
  (local $c i32)
  (block $done
    (loop $again
      (local.set $c (call $json_peek))
      (br_if $done
        (i32.eqz (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const 32))
                  (i32.eq (local.get $c) (i32.const 9)))
          (i32.or (i32.eq (local.get $c) (i32.const 10))
                  (i32.eq (local.get $c) (i32.const 13))))))
      (global.set $json_cursor (i32.add (global.get $json_cursor) (i32.const 1)))
      (br $again))))

(func $json_digit (param $c i32) (result i32)
  (i32.le_u (i32.sub (local.get $c) (i32.const 48)) (i32.const 9)))

;; Exactly four ASCII hex digits follow a JSON \u escape.
(func $json_hex4 (result i32)
  (local $n i32) (local $c i32) (local $v i32)
  (loop $digit
    (local.set $c (call $json_take))
    (if (call $json_digit (local.get $c))
      (then (local.set $c (i32.sub (local.get $c) (i32.const 48))))
      (else
        (local.set $c (i32.or (local.get $c) (i32.const 32)))
        (if (i32.gt_u (i32.sub (local.get $c) (i32.const 97)) (i32.const 5))
          (then (call $json_error)))
        (local.set $c (i32.sub (local.get $c) (i32.const 87)))))
    (local.set $v (i32.or (i32.shl (local.get $v) (i32.const 4)) (local.get $c)))
    (local.set $n (i32.add (local.get $n) (i32.const 1)))
    (br_if $digit (i32.lt_u (local.get $n) (i32.const 4))))
  (local.get $v))

;; Append one valid Unicode scalar to an in-place string. Escape spelling is
;; always at least as long as its UTF-8 result, so these stores remain behind
;; the read cursor. Raw non-ASCII bytes use json_utf8_width while decoding.
(func $json_put_scalar (param $p i32) (param $c i32) (result i32)
  (if (i32.lt_u (local.get $c) (i32.const 128))
    (then
      (i32.store8 (local.get $p) (local.get $c))
      (return (i32.add (local.get $p) (i32.const 1)))))
  (if (i32.lt_u (local.get $c) (i32.const 2048))
    (then
      (i32.store8 (local.get $p)
        (i32.or (i32.const 192) (i32.shr_u (local.get $c) (i32.const 6))))
      (i32.store8 offset=1 (local.get $p)
        (i32.or (i32.const 128) (i32.and (local.get $c) (i32.const 63))))
      (return (i32.add (local.get $p) (i32.const 2)))))
  (if (i32.lt_u (local.get $c) (i32.const 65536))
    (then
      (i32.store8 (local.get $p)
        (i32.or (i32.const 224) (i32.shr_u (local.get $c) (i32.const 12))))
      (i32.store8 offset=1 (local.get $p)
        (i32.or (i32.const 128)
          (i32.and (i32.shr_u (local.get $c) (i32.const 6)) (i32.const 63))))
      (i32.store8 offset=2 (local.get $p)
        (i32.or (i32.const 128) (i32.and (local.get $c) (i32.const 63))))
      (return (i32.add (local.get $p) (i32.const 3)))))
  (i32.store8 (local.get $p)
    (i32.or (i32.const 240) (i32.shr_u (local.get $c) (i32.const 18))))
  (i32.store8 offset=1 (local.get $p)
    (i32.or (i32.const 128)
      (i32.and (i32.shr_u (local.get $c) (i32.const 12)) (i32.const 63))))
  (i32.store8 offset=2 (local.get $p)
    (i32.or (i32.const 128)
      (i32.and (i32.shr_u (local.get $c) (i32.const 6)) (i32.const 63))))
  (i32.store8 offset=3 (local.get $p)
    (i32.or (i32.const 128) (i32.and (local.get $c) (i32.const 63))))
  (i32.add (local.get $p) (i32.const 4)))

(func $json_string_room (param $p i32) (param $n i32) (param $scratch i32)
  (if (local.get $scratch)
    (then
      (if (i32.or (i32.gt_u (local.get $p) (i32.const 2097152))
            (i32.gt_u (local.get $n) (i32.sub (i32.const 2097152) (local.get $p))))
        (then (call $fail (i32.const 12)) unreachable)))))

;; Return a well-formed UTF-8 sequence width, or zero for one malformed byte.
;; Like utf8.DecodeRune, malformed sequences consume only ONE byte; subsequent
;; bad continuation bytes each receive their own U+FFFD replacement.
(func $json_utf8_width (param $p i32) (result i32)
  (local $c i32) (local $b i32) (local $width i32) (local $j i32)
  (local.set $c (i32.load8_u (local.get $p)))
  (if (i32.lt_u (local.get $c) (i32.const 128)) (then (return (i32.const 1))))
  (if (i32.lt_u (local.get $c) (i32.const 194)) (then (return (i32.const 0))))
  (if (i32.gt_u (local.get $c) (i32.const 244)) (then (return (i32.const 0))))
  (local.set $width (select (i32.const 2)
    (select (i32.const 3) (i32.const 4) (i32.lt_u (local.get $c) (i32.const 240)))
    (i32.lt_u (local.get $c) (i32.const 224))))
  (if (i32.gt_u (local.get $width) (i32.sub (global.get $json_end) (local.get $p)))
    (then (return (i32.const 0))))
  (local.set $b (i32.load8_u offset=1 (local.get $p)))
  (if (i32.or
        (i32.and (i32.eq (local.get $c) (i32.const 224)) (i32.lt_u (local.get $b) (i32.const 160)))
        (i32.and (i32.eq (local.get $c) (i32.const 237)) (i32.ge_u (local.get $b) (i32.const 160))))
    (then (return (i32.const 0))))
  (if (i32.or
        (i32.and (i32.eq (local.get $c) (i32.const 240)) (i32.lt_u (local.get $b) (i32.const 144)))
        (i32.and (i32.eq (local.get $c) (i32.const 244)) (i32.ge_u (local.get $b) (i32.const 144))))
    (then (return (i32.const 0))))
  (local.set $j (i32.const 1))
  (block $done
    (loop $continuation
      (br_if $done (i32.ge_u (local.get $j) (local.get $width)))
      (if (i32.ne
            (i32.and (i32.load8_u (i32.add (local.get $p) (local.get $j))) (i32.const 192))
            (i32.const 128))
        (then (return (i32.const 0))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $continuation)))
  (local.get $width))

(func $json_string (result i32)
  (local $i i32) (local $start i32) (local $write i32)
  (local $c i32) (local $low i32) (local $saved i32)
  (local $scratch i32) (local $width i32)
  (call $json_expect (i32.const 34))
  (local.set $start (global.get $json_cursor))
  (local.set $write (local.get $start))
  (local.set $i (call $json_new (i32.const 3) (local.get $start)))
  (block $done
    (loop $byte
      (local.set $c (call $json_take))
      (br_if $done (i32.eq (local.get $c) (i32.const 34)))
      (if (i32.lt_u (local.get $c) (i32.const 32)) (then (call $json_error)))
      (if (i32.eq (local.get $c) (i32.const 92))
        (then
          (local.set $c (call $json_take))
          (if (i32.eq (local.get $c) (i32.const 117))
            (then
              (local.set $c (call $json_hex4))
              (if (i32.le_u (i32.sub (local.get $c) (i32.const 55296)) (i32.const 2047))
                (then
                  (local.set $low (i32.const 0))
                  (local.set $saved (global.get $json_cursor))
                  (if (i32.and
                        (i32.le_u (i32.sub (local.get $c) (i32.const 55296)) (i32.const 1023))
                        (i32.ge_u (i32.sub (global.get $json_end) (global.get $json_cursor)) (i32.const 6)))
                    (then
                      (if (i32.and
                            (i32.eq (i32.load8_u (global.get $json_cursor)) (i32.const 92))
                            (i32.eq (i32.load8_u offset=1 (global.get $json_cursor)) (i32.const 117)))
                        (then
                          (drop (call $json_take)) (drop (call $json_take))
                          (local.set $low (call $json_hex4))
                          (if (i32.gt_u (i32.sub (local.get $low) (i32.const 56320)) (i32.const 1023))
                            (then (local.set $low (i32.const 0))))))))
                  (if (local.get $low)
                    (then
                      (local.set $c (i32.add (i32.const 65536)
                        (i32.add
                          (i32.shl (i32.sub (local.get $c) (i32.const 55296)) (i32.const 10))
                          (i32.sub (local.get $low) (i32.const 56320))))))
                    (else
                      (global.set $json_cursor (local.get $saved))
                      (local.set $c (i32.const 65533))))))
              (local.set $width (select (i32.const 1)
                (select (i32.const 2)
                  (select (i32.const 3) (i32.const 4) (i32.lt_u (local.get $c) (i32.const 65536)))
                  (i32.lt_u (local.get $c) (i32.const 2048)))
                (i32.lt_u (local.get $c) (i32.const 128))))
              (call $json_string_room (local.get $write) (local.get $width) (local.get $scratch))
              (local.set $write (call $json_put_scalar (local.get $write) (local.get $c))))
            (else
              (block $escape
                (br_if $escape (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const 34))
                          (i32.eq (local.get $c) (i32.const 92)))
                  (i32.eq (local.get $c) (i32.const 47))))
                (if (i32.eq (local.get $c) (i32.const 98))
                  (then (local.set $c (i32.const 8)) (br $escape)))
                (if (i32.eq (local.get $c) (i32.const 102))
                  (then (local.set $c (i32.const 12)) (br $escape)))
                (if (i32.eq (local.get $c) (i32.const 110))
                  (then (local.set $c (i32.const 10)) (br $escape)))
                (if (i32.eq (local.get $c) (i32.const 114))
                  (then (local.set $c (i32.const 13)) (br $escape)))
                (if (i32.eq (local.get $c) (i32.const 116))
                  (then (local.set $c (i32.const 9)) (br $escape)))
                (call $json_error))
              (call $json_string_room (local.get $write) (i32.const 1) (local.get $scratch))
              (i32.store8 (local.get $write) (local.get $c))
              (local.set $write (i32.add (local.get $write) (i32.const 1))))))
        (else
          (local.set $width (call $json_utf8_width (i32.sub (global.get $json_cursor) (i32.const 1))))
          (if (i32.eqz (local.get $width))
            (then
              (if (i32.eqz (local.get $scratch))
                (then
                  (local.set $scratch (i32.const 1))
                  (local.set $low (i32.sub (local.get $write) (local.get $start)))
                  (call $json_string_room (global.get $json_scratch_cursor) (local.get $low) (i32.const 1))
                  (memory.copy (global.get $json_scratch_cursor) (local.get $start) (local.get $low))
                  (local.set $start (global.get $json_scratch_cursor))
                  (local.set $write (i32.add (local.get $start) (local.get $low)))
                  (i32.store offset=4 (call $json_address (local.get $i)) (local.get $start))))
              (call $json_string_room (local.get $write) (i32.const 3) (local.get $scratch))
              (local.set $write (call $json_put_scalar (local.get $write) (i32.const 65533))))
            (else
              (call $json_string_room (local.get $write) (local.get $width) (local.get $scratch))
              (i32.store8 (local.get $write) (local.get $c))
              (local.set $write (i32.add (local.get $write) (i32.const 1)))
              (loop $raw_sequence
                (local.set $width (i32.sub (local.get $width) (i32.const 1)))
                (if (local.get $width)
                  (then
                    (i32.store8 (local.get $write) (call $json_take))
                    (local.set $write (i32.add (local.get $write) (i32.const 1)))
                    (br $raw_sequence))))))))
      (br $byte)))
  (i32.store offset=8 (call $json_address (local.get $i))
    (i32.sub (local.get $write) (local.get $start)))
  (if (local.get $scratch) (then (global.set $json_scratch_cursor (local.get $write))))
  (local.get $i))

(func $json_number (result i32)
  (local $start i32) (local $i i32) (local $c i32)
  (local.set $start (global.get $json_cursor))
  (if (i32.eq (call $json_peek) (i32.const 45)) (then (drop (call $json_take))))
  (local.set $c (call $json_take))
  (if (i32.eq (local.get $c) (i32.const 48))
    (then (if (call $json_digit (call $json_peek)) (then (call $json_error))))
    (else
      (if (i32.gt_u (i32.sub (local.get $c) (i32.const 49)) (i32.const 8))
        (then (call $json_error)))
      (block $integer_done
        (loop $integer
          (br_if $integer_done (i32.eqz (call $json_digit (call $json_peek))))
          (drop (call $json_take)) (br $integer)))))
  (if (i32.eq (call $json_peek) (i32.const 46))
    (then
      (drop (call $json_take))
      (if (i32.eqz (call $json_digit (call $json_take))) (then (call $json_error)))
      (block $fraction_done
        (loop $fraction
          (br_if $fraction_done (i32.eqz (call $json_digit (call $json_peek))))
          (drop (call $json_take)) (br $fraction)))))
  (local.set $c (call $json_peek))
  (if (i32.or (i32.eq (local.get $c) (i32.const 101))
              (i32.eq (local.get $c) (i32.const 69)))
    (then
      (drop (call $json_take))
      (local.set $c (call $json_peek))
      (if (i32.or (i32.eq (local.get $c) (i32.const 43))
                  (i32.eq (local.get $c) (i32.const 45)))
        (then (drop (call $json_take))))
      (if (i32.eqz (call $json_digit (call $json_take))) (then (call $json_error)))
      (block $exponent_done
        (loop $exponent
          (br_if $exponent_done (i32.eqz (call $json_digit (call $json_peek))))
          (drop (call $json_take)) (br $exponent)))))
  (local.set $i (call $json_new (i32.const 4) (local.get $start)))
  (i32.store offset=8 (call $json_address (local.get $i))
    (i32.sub (global.get $json_cursor) (local.get $start)))
  (local.get $i))

;; Only objects and arrays increase the depth. With a limit of 128, even a
;; malicious input cannot consume an unbounded Wasm call stack.
(func $json_value (param $depth i32) (result i32)
  (local $c i32) (local $i i32) (local $start i32)
  (local $object i32) (local $close i32) (local $children i32)
  (call $json_space)
  (local.set $c (call $json_peek))
  (if (i32.eq (local.get $c) (i32.const 34)) (then (return (call $json_string))))
  (if (i32.or (i32.eq (local.get $c) (i32.const 45)) (call $json_digit (local.get $c)))
    (then (return (call $json_number))))
  (local.set $start (global.get $json_cursor))
  (if (i32.eq (local.get $c) (i32.const 116))
    (then
      (call $json_expect (i32.const 116)) (call $json_expect (i32.const 114))
      (call $json_expect (i32.const 117)) (call $json_expect (i32.const 101))
      (local.set $i (call $json_new (i32.const 5) (local.get $start)))
      (i32.store offset=8 (call $json_address (local.get $i)) (i32.const 4))
      (return (local.get $i))))
  (if (i32.eq (local.get $c) (i32.const 102))
    (then
      (call $json_expect (i32.const 102)) (call $json_expect (i32.const 97))
      (call $json_expect (i32.const 108)) (call $json_expect (i32.const 115))
      (call $json_expect (i32.const 101))
      (local.set $i (call $json_new (i32.const 6) (local.get $start)))
      (i32.store offset=8 (call $json_address (local.get $i)) (i32.const 5))
      (return (local.get $i))))
  (if (i32.eq (local.get $c) (i32.const 110))
    (then
      (call $json_expect (i32.const 110)) (call $json_expect (i32.const 117))
      (call $json_expect (i32.const 108)) (call $json_expect (i32.const 108))
      (local.set $i (call $json_new (i32.const 7) (local.get $start)))
      (i32.store offset=8 (call $json_address (local.get $i)) (i32.const 4))
      (return (local.get $i))))
  (local.set $object (i32.eq (local.get $c) (i32.const 123)))
  (if (i32.eqz (i32.or (local.get $object) (i32.eq (local.get $c) (i32.const 91))))
    (then (call $json_error)))
  (if (i32.ge_u (local.get $depth) (i32.const 128)) (then (call $json_error)))
  (local.set $close (select (i32.const 125) (i32.const 93) (local.get $object)))
  (local.set $i (call $json_new
    (select (i32.const 1) (i32.const 2) (local.get $object)) (local.get $start)))
  (drop (call $json_take))
  (call $json_space)
  (block $container_done
    (if (i32.eq (call $json_peek) (local.get $close))
      (then (drop (call $json_take)) (br $container_done)))
    (loop $member
      (if (local.get $object)
        (then
          (drop (call $json_string))
          (local.set $children (i32.add (local.get $children) (i32.const 1)))
          (call $json_space)
          (call $json_expect (i32.const 58))))
      (drop (call $json_value (i32.add (local.get $depth) (i32.const 1))))
      (local.set $children (i32.add (local.get $children) (i32.const 1)))
      (call $json_space)
      (local.set $c (call $json_take))
      (br_if $container_done (i32.eq (local.get $c) (local.get $close)))
      (if (i32.ne (local.get $c) (i32.const 44)) (then (call $json_error)))
      (call $json_space)
      ;; The next iteration requires a key/value, so trailing commas fail.
      (br $member)))
  (i32.store offset=8 (call $json_address (local.get $i))
    (i32.sub (global.get $json_cursor) (local.get $start)))
  (i32.store offset=12 (call $json_address (local.get $i)) (global.get $json_token_count))
  (i32.store offset=16 (call $json_address (local.get $i)) (local.get $children))
  (local.get $i))

(func $json_parse (param $p i32) (param $n i32) (result i32)
  (local $end i32) (local $root i32)
  (local.set $end (i32.add (local.get $p) (local.get $n)))
  (if (i32.or (i32.lt_u (local.get $end) (local.get $p))
        (i64.gt_u (i64.extend_i32_u (local.get $end))
          (i64.shl (i64.extend_i32_u (memory.size)) (i64.const 16))))
    (then (call $json_error)))
  (if (i32.and (i32.lt_u (local.get $p) (i32.const 2097152))
              (i32.gt_u (local.get $end) (i32.const 1048576)))
    (then (call $json_error)))
  ;; JSON bytes, unlike protobuf strings, replace malformed UTF-8 as Go does.
  ;; String decoding checks each sequence and consumes bad bytes individually.
  (global.set $json_scratch_cursor (i32.const 1441792))
  (global.set $json_token_count (i32.const 0))
  (global.set $json_cursor (local.get $p))
  (global.set $json_end (local.get $end))
  (local.set $root (call $json_value (i32.const 0)))
  (call $json_space)
  (if (i32.ne (global.get $json_cursor) (global.get $json_end)) (then (call $json_error)))
  (local.get $root))

;; Byte equality does not require NUL terminators and supports embedded NULs.
(func $json_eq (param $i i32) (param $p i32) (param $n i32) (result i32)
  (local $a i32) (local $offset i32)
  (if (i32.eqz (call $json_kind (local.get $i))) (then (return (i32.const 0))))
  (if (i32.ne (call $json_len (local.get $i)) (local.get $n)) (then (return (i32.const 0))))
  (local.set $a (call $json_ptr (local.get $i)))
  (block $done
    (loop $byte
      (br_if $done (i32.ge_u (local.get $offset) (local.get $n)))
      (if (i32.ne
            (i32.load8_u (i32.add (local.get $a) (local.get $offset)))
            (i32.load8_u (i32.add (local.get $p) (local.get $offset))))
        (then (return (i32.const 0))))
      (local.set $offset (i32.add (local.get $offset) (i32.const 1)))
      (br $byte)))
  (i32.const 1))

(func $json_get (param $object i32) (param $p i32) (param $n i32) (result i32)
  (local $i i32) (local $end i32) (local $found i32)
  (if (i32.ne (call $json_kind (local.get $object)) (i32.const 1))
    (then (return (i32.const -1))))
  (local.set $found (i32.const -1))
  (local.set $i (i32.add (local.get $object) (i32.const 1)))
  (local.set $end (i32.load offset=12 (call $json_address (local.get $object))))
  (block $done
    (loop $member
      (br_if $done (i32.ge_u (local.get $i) (local.get $end)))
      (if (call $json_eq (local.get $i) (local.get $p) (local.get $n))
        (then (local.set $found (i32.add (local.get $i) (i32.const 1)))))
      (local.set $i
        (i32.load offset=12 (call $json_address (i32.add (local.get $i) (i32.const 1)))))
      (br $member)))
  (local.get $found))

(func $json_at (param $array i32) (param $index i32) (result i32)
  (local $i i32) (local $n i32)
  (if (i32.ne (call $json_kind (local.get $array)) (i32.const 2))
    (then (return (i32.const -1))))
  (if (i32.ge_u (local.get $index)
        (i32.load offset=16 (call $json_address (local.get $array))))
    (then (return (i32.const -1))))
  (local.set $i (i32.add (local.get $array) (i32.const 1)))
  (block $done
    (loop $element
      (br_if $done (i32.eq (local.get $n) (local.get $index)))
      (local.set $i (i32.load offset=12 (call $json_address (local.get $i))))
      (local.set $n (i32.add (local.get $n) (i32.const 1)))
      (br $element)))
  (local.get $i))
