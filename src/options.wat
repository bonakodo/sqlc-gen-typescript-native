;; Full option contract for the hand-written generator. All string results are
;; views into JSON input or the fixed text range. No host parser or allocator is
;; used. The JSON token's final word links earlier occurrences of merged struct
;; and map objects; opt_get follows those links. Repeated slices replace rather
;; than merge. Mapping names remain case-sensitive; struct fields follow Go's
;; encoding/json case folding, including long s and the Kelvin sign.
;;
;; Literal bytes are reserved at [2621440,2686976). Schema validation happens
;; before semantic validation, matching encoding/json's unknown-field checks.
;; $error(ptr,len), supplied by the generator, reports the complete message.

(global $opt_root (mut i32) (i32.const -1))
(global $opt_runtime (mut i32) (i32.const 1))
(global $opt_driver (mut i32) (i32.const 0))
(global $opt_driver_ptr (mut i32) (i32.const 0))
(global $opt_driver_len (mut i32) (i32.const 0))
(global $opt_mode_native (mut i32) (i32.const 0))
(global $opt_types_only (mut i32) (i32.const 0))
(global $opt_null_undefined (mut i32) (i32.const 0))
(global $opt_optional_args (mut i32) (i32.const 0))
(global $opt_factory (mut i32) (i32.const 0))
(global $opt_sql_const (mut i32) (i32.const 1))
(global $opt_mysql_support (mut i32) (i32.const 0))
(global $opt_mysql_strings (mut i32) (i32.const 0))
(global $opt_mysql_insert_unsigned (mut i32) (i32.const -1))
(global $opt_error_prefix (mut i32) (i32.const 0))
(global $opt_error_prefix_len (mut i32) (i32.const 0))

;; The caller can read an option struct through this helper after validation.
;; It also walks prior object occurrences linked by the schema pass.
(func $opt_get (param $obj i32) (param $p i32) (param $n i32) (result i32)
  (local $v i32)
  (loop $object
    (if (i32.ne (call $json_kind (local.get $obj)) (i32.const 1))
      (then (return (i32.const -1))))
    (local.set $v (call $json_get (local.get $obj) (local.get $p) (local.get $n)))
    (if (i32.ge_s (local.get $v) (i32.const 0)) (then (return (local.get $v))))
    (local.set $obj (i32.sub
      (i32.load offset=20 (call $json_address (local.get $obj))) (i32.const 1)))
    (br $object))
  (i32.const -1))

;; Strings and ordinary bools ignore JSON null, including a later null value.
;; Pointer bools use kind 7 to retain explicit null/unset semantics.
(func $opt_string (param $obj i32) (param $p i32) (param $n i32) (result i32 i32)
  (local $v i32)
  (local.set $v (call $opt_get (local.get $obj) (local.get $p) (local.get $n)))
  (if (result i32 i32) (i32.eq (call $json_kind (local.get $v)) (i32.const 3))
    (then (call $json_ptr (local.get $v)) (call $json_len (local.get $v)))
    (else (i32.const 0) (i32.const 0))))

(func $opt_bool (param $obj i32) (param $p i32) (param $n i32) (result i32)
  (i32.eq (call $json_kind (call $opt_get (local.get $obj) (local.get $p) (local.get $n))) (i32.const 5)))

(func $opt_count (param $token i32) (result i32)
  (if (result i32) (i32.eq (call $json_kind (local.get $token)) (i32.const 2))
    (then (i32.load offset=16 (call $json_address (local.get $token))))
    (else (i32.const 0))))

(func $opt_prefix (param $p i32) (param $n i32)
  (global.set $opt_error_prefix (local.get $p))
  (global.set $opt_error_prefix_len (local.get $n)))

(func $opt_error (param $p i32) (param $n i32)
  (call $concat (global.get $opt_error_prefix) (global.get $opt_error_prefix_len)
    (local.get $p) (local.get $n))
  (call $error)
  unreachable)

(func $opt_error_quote (param $p i32) (param $n i32) (param $v i32)
  (local $mark i32) (local $qp i32) (local $qn i32)
  (call $go_quote (call $json_ptr (local.get $v)) (call $json_len (local.get $v)))
  (local.set $qn) (local.set $qp)
  (local.set $mark (call $text_mark))
  (call $text_append (local.get $p) (local.get $n))
  (call $text_append (local.get $qp) (local.get $qn))
  (call $opt_error (local.get $mark) (i32.sub (global.get $txt_cursor) (local.get $mark))))

(func $opt_qerror_tail (param $prefix i32) (param $prefixn i32)
    (param $v i32) (param $tail i32) (param $tailn i32)
  (local $mark i32) (local $qp i32) (local $qn i32)
  (call $go_quote (call $json_ptr (local.get $v)) (call $json_len (local.get $v)))
  (local.set $qn) (local.set $qp)
  (local.set $mark (call $text_mark))
  (call $text_append (local.get $prefix) (local.get $prefixn))
  (call $text_append (local.get $qp) (local.get $qn))
  (call $text_append (local.get $tail) (local.get $tailn))
  (call $opt_error (local.get $mark) (i32.sub (global.get $txt_cursor) (local.get $mark))))

;; Fold only characters that can compare equal to an ASCII struct-field name.
;; Go's Unicode simple-fold classes add U+017F to S and U+212A to K.
(func $opt_keyeq (param $key i32) (param $p i32) (param $n i32) (result i32)
  (local $kp i32) (local $end i32) (local $j i32) (local $c i32)
  (local.set $kp (call $json_ptr (local.get $key)))
  (local.set $end (i32.add (local.get $kp) (call $json_len (local.get $key))))
  (block $done
    (loop $byte
      (br_if $done (i32.ge_u (local.get $kp) (local.get $end)))
      (if (i32.ge_u (local.get $j) (local.get $n)) (then (return (i32.const 0))))
      (local.set $c (i32.load8_u (local.get $kp)))
      (local.set $kp (i32.add (local.get $kp) (i32.const 1)))
      (if (i32.le_u (i32.sub (local.get $c) (i32.const 65)) (i32.const 25))
        (then (local.set $c (i32.add (local.get $c) (i32.const 32)))))
      (if (i32.and (i32.eq (local.get $c) (i32.const 197)) (i32.lt_u (local.get $kp) (local.get $end)))
        (then
          (if (i32.eq (i32.load8_u (local.get $kp)) (i32.const 191))
            (then (local.set $c (i32.const 115)) (local.set $kp (i32.add (local.get $kp) (i32.const 1)))))))
      (if (i32.and (i32.eq (local.get $c) (i32.const 226))
            (i32.ge_u (i32.sub (local.get $end) (local.get $kp)) (i32.const 2)))
        (then
          (if (i32.and (i32.eq (i32.load8_u (local.get $kp)) (i32.const 132))
                (i32.eq (i32.load8_u offset=1 (local.get $kp)) (i32.const 170)))
            (then (local.set $c (i32.const 107)) (local.set $kp (i32.add (local.get $kp) (i32.const 2)))))))
      (if (i32.ne (local.get $c) (i32.load8_u (i32.add (local.get $p) (local.get $j))))
        (then (return (i32.const 0))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $byte)))
  (i32.eq (local.get $j) (local.get $n)))

;; Record a matched field's canonical spelling without touching source bytes.
(func $opt_key (param $key i32) (param $p i32) (param $n i32) (param $id i32) (result i32)
  (if (call $opt_keyeq (local.get $key) (local.get $p) (local.get $n))
    (then
      (i32.store offset=4 (call $json_address (local.get $key)) (local.get $p))
      (i32.store offset=8 (call $json_address (local.get $key)) (local.get $n))
      (return (local.get $id))))
  (i32.const 0))

;; Field shapes: 1 string, 2 bool, 3 pointer bool, 4 mysql2 object,
;; 5 override array, 6 mapping map, 7 query array, 8 string array,
;; 9 import/codec object. Schema IDs are 1..6 (see opt_schema_name).
;;
;; Keep policy in read-only tables, with one bounded lookup below. Each schema
;; descriptor is {field-table byte offset:u16, byte length:u16}; each field is
;; {literal offset:u16, name length:u8, shape:u8}. All words are little-endian.
;; TypeMapping shares Override's first four entries. QueryOverride repeats the
;; common fields so every lookup scans one contiguous span without extra state.
(global $opt_shape_ranges i32 (i32.const 2624512))
(global $opt_shape_fields i32 (i32.const 2624536))
(data (i32.const 2624512)
  "\00\00\34\00" ;; Options
  "\34\00\0c\00" ;; MySQL2Options
  "\48\00\28\00" ;; Override
  "\48\00\10\00" ;; TypeMapping
  "\70\00\24\00" ;; QueryOverride
  "\40\00\08\00" ;; Import/Codec
)
(data (i32.const 2624536)
  ;; Options
  "\00\00\03\01" ;; out, shape 1
  "\03\00\07\01" ;; runtime, shape 1
  "\0a\00\06\01" ;; driver, shape 1
  "\10\00\10\01" ;; sqlite_type_mode, shape 1
  "\20\00\06\04" ;; mysql2, shape 4
  "\26\00\0a\02" ;; types_only, shape 2
  "\30\00\16\02" ;; emit_null_as_undefined, shape 2
  "\46\00\16\03" ;; optional_nullable_args, shape 3
  "\5c\00\12\02" ;; emit_query_factory, shape 2
  "\6e\00\11\03" ;; emit_sql_as_const, shape 3
  "\7f\00\09\05" ;; overrides, shape 5
  "\88\00\0d\06" ;; type_mappings, shape 6
  "\95\00\0f\07" ;; query_overrides, shape 7
  ;; MySQL2Options
  "\a4\00\13\02" ;; support_big_numbers, shape 2
  "\b7\00\12\02" ;; big_number_strings, shape 2
  "\c9\00\12\03" ;; insert_id_unsigned, shape 3
  ;; Import/Codec
  "\db\00\04\01" ;; path, shape 1
  "\df\00\04\01" ;; name, shape 1
  ;; Override (first four also TypeMapping)
  "\e3\00\07\01" ;; ts_type, shape 1
  "\ea\00\06\01" ;; preset, shape 1
  "\f0\00\06\09" ;; import, shape 9
  "\f6\00\05\09" ;; codec, shape 9
  "\fb\00\06\01" ;; column, shape 1
  "\01\01\07\01" ;; mapping, shape 1
  "\08\01\07\08" ;; columns, shape 8
  "\0f\01\07\01" ;; db_type, shape 1
  "\16\01\08\02" ;; nullable, shape 2
  "\1e\01\0c\02" ;; nullable_all, shape 2
  ;; QueryOverride
  "\e3\00\07\01" ;; ts_type, shape 1
  "\ea\00\06\01" ;; preset, shape 1
  "\f0\00\06\09" ;; import, shape 9
  "\f6\00\05\09" ;; codec, shape 9
  "\fb\00\06\01" ;; column, shape 1
  "\01\01\07\01" ;; mapping, shape 1
  "\2a\01\05\01" ;; query, shape 1
  "\2f\01\09\01" ;; parameter, shape 1
  "\16\01\08\03" ;; nullable, shape 3
)

;; Match and canonicalize the key, or return zero without changing it. Only
;; schema-owned entries reach opt_key, preserving unknown-field diagnostics.
(func $opt_shape_id (param $schema i32) (param $key i32) (result i32)
  (local $at i32) (local $end i32) (local $v i32)
  (if (i32.gt_u (i32.sub (local.get $schema) (i32.const 1)) (i32.const 5))
    (then (return (i32.const 0))))
  (local.set $at (i32.add (global.get $opt_shape_ranges)
    (i32.shl (i32.sub (local.get $schema) (i32.const 1)) (i32.const 2))))
  (local.set $end (i32.load16_u offset=2 (local.get $at)))
  (local.set $at (i32.add (global.get $opt_shape_fields) (i32.load16_u (local.get $at))))
  (local.set $end (i32.add (local.get $at) (local.get $end)))
  (loop $fields
    (local.set $v (call $opt_key (local.get $key)
      (i32.add (i32.const 2621440) (i32.load16_u (local.get $at)))
      (i32.load8_u offset=2 (local.get $at)) (i32.load8_u offset=3 (local.get $at))))
    (if (local.get $v) (then (return (local.get $v))))
    (local.set $at (i32.add (local.get $at) (i32.const 4)))
    (br_if $fields (i32.lt_u (local.get $at) (local.get $end))))
  (i32.const 0))

;; Find the last earlier occurrence inside this object, then follow merged
;; prior objects. All earlier field keys already have their canonical spelling.
(func $opt_previous (param $obj i32) (param $stop i32) (param $key i32) (result i32)
  (local $i i32) (local $found i32)
  (local.set $found (i32.const -1))
  (local.set $i (i32.add (local.get $obj) (i32.const 1)))
  (block $done
    (loop $field
      (br_if $done (i32.ge_u (local.get $i) (local.get $stop)))
      (if (call $json_eq (local.get $i) (call $json_ptr (local.get $key)) (call $json_len (local.get $key)))
        (then (local.set $found (i32.add (local.get $i) (i32.const 1)))))
      (local.set $i (i32.load offset=12 (call $json_address (i32.add (local.get $i) (i32.const 1)))))
      (br $field)))
  (if (i32.ge_s (local.get $found) (i32.const 0)) (then (return (local.get $found))))
  (call $opt_get
    (i32.sub (i32.load offset=20 (call $json_address (local.get $obj))) (i32.const 1))
    (call $json_ptr (local.get $key)) (call $json_len (local.get $key))))

(func $opt_array_previous (param $arr i32) (param $index i32) (result i32)
  (local $v i32)
  (loop $array
    (if (i32.ne (call $json_kind (local.get $arr)) (i32.const 2)) (then (return (i32.const -1))))
    (local.set $v (call $json_at (local.get $arr) (local.get $index)))
    (if (i32.ge_s (local.get $v) (i32.const 0)) (then (return (local.get $v))))
    (local.set $arr (i32.sub (i32.load offset=20 (call $json_address (local.get $arr))) (i32.const 1)))
    (br $array))
  (i32.const -1))

(func $opt_schema_name (param $schema i32) (result i32 i32)
  (if (i32.eq (local.get $schema) (i32.const 1)) (then (return (i32.const 2621752) (i32.const 7))))
  (if (i32.eq (local.get $schema) (i32.const 2)) (then (return (i32.const 2621759) (i32.const 13))))
  (if (i32.eq (local.get $schema) (i32.const 3)) (then (return (i32.const 2621772) (i32.const 8))))
  (if (i32.eq (local.get $schema) (i32.const 4)) (then (return (i32.const 2621780) (i32.const 11))))
  (if (i32.eq (local.get $schema) (i32.const 5)) (then (return (i32.const 2621791) (i32.const 13))))
  (i32.const 2621804) (i32.const 6))

;; Build encoding/json's type mismatch message. Field path bytes are borrowed
;; from the text buffer until this recursive schema check returns.
(func $opt_type_error (param $v i32) (param $schema i32) (param $path i32)
    (param $pathn i32) (param $want i32) (param $wantn i32)
  (local $m i32) (local $k i32)
  (local.set $m (call $text_mark))
  (call $text_append (i32.const 2621810) (i32.const 43))
  (local.set $k (call $json_kind (local.get $v)))
  (if (i32.eq (local.get $k) (i32.const 1)) (then (call $text_append (i32.const 2621853) (i32.const 6))))
  (if (i32.eq (local.get $k) (i32.const 2)) (then (call $text_append (i32.const 2621859) (i32.const 5))))
  (if (i32.eq (local.get $k) (i32.const 3)) (then (call $text_append (i32.const 2621864) (i32.const 6))))
  (if (i32.eq (local.get $k) (i32.const 4))
    (then (call $text_append (i32.const 2621870) (i32.const 6))))
  (if (i32.or (i32.eq (local.get $k) (i32.const 5)) (i32.eq (local.get $k) (i32.const 6)))
    (then (call $text_append (i32.const 2621876) (i32.const 4))))
  (if (local.get $pathn)
    (then
      (call $text_append (i32.const 2621880) (i32.const 22))
      (call $opt_schema_name (local.get $schema)) (call $text_append)
      (call $text_append (i32.const 2621902) (i32.const 1))
      (call $text_append (local.get $path) (local.get $pathn)))
    (else (call $text_append (i32.const 2621903) (i32.const 14))))
  (call $text_append (i32.const 2621917) (i32.const 9))
  (call $text_append (local.get $want) (local.get $wantn))
  (call $error (local.get $m) (i32.sub (global.get $txt_cursor) (local.get $m)))
  unreachable)

(func $opt_shape (param $obj i32) (param $schema i32) (param $path i32) (param $pathn i32) (param $parent i32)
  (local $i i32) (local $v i32) (local $end i32) (local $shape i32)
  (local $k i32) (local $previous i32) (local $j i32) (local $child i32)
  (local $p i32) (local $n i32) (local $mark i32) (local $oldchild i32)
  (if (i32.eq (call $json_kind (local.get $obj)) (i32.const 7)) (then (return)))
  (if (i32.ne (call $json_kind (local.get $obj)) (i32.const 1))
    (then
      (call $opt_schema_name (local.get $schema)) (local.set $n) (local.set $p)
      (call $concat (i32.const 2621926) (i32.const 5) (local.get $p) (local.get $n)) (local.set $n) (local.set $p)
      (call $opt_type_error (local.get $obj) (local.get $parent) (local.get $path) (local.get $pathn) (local.get $p) (local.get $n))))
  (local.set $i (i32.add (local.get $obj) (i32.const 1)))
  (local.set $end (i32.load offset=12 (call $json_address (local.get $obj))))
  (block $done
    (loop $field
      (br_if $done (i32.ge_u (local.get $i) (local.get $end)))
      (local.set $v (i32.add (local.get $i) (i32.const 1)))
      (local.set $shape (call $opt_shape_id (local.get $schema) (local.get $i)))
      (if (i32.eqz (local.get $shape))
        (then
          (call $opt_prefix (i32.const 2621931) (i32.const 20))
          (call $opt_error_quote (i32.const 2621951) (i32.const 20) (local.get $i))))
      (local.set $mark (call $text_mark))
      (if (local.get $pathn)
        (then (call $text_append (local.get $path) (local.get $pathn)) (call $text_append (i32.const 2621902) (i32.const 1))))
      (call $text_append (call $json_ptr (local.get $i)) (call $json_len (local.get $i)))
      (local.set $p (local.get $mark))
      (local.set $n (i32.sub (global.get $txt_cursor) (local.get $mark)))
      (local.set $previous (call $opt_previous (local.get $obj) (local.get $i) (local.get $i)))
      (local.set $k (call $json_kind (local.get $v)))
      ;; null leaves a non-pointer Go field unchanged. Copy only scalar token
      ;; payload words; subtree boundaries remain the current token's own.
      (if (i32.and (i32.eq (local.get $k) (i32.const 7))
            (i32.or (i32.le_u (local.get $shape) (i32.const 2)) (i32.eq (local.get $shape) (i32.const 4))))
        (then
          (if (i32.gt_u (call $json_kind (local.get $previous)) (i32.const 0))
            (then
              (if (i32.eq (local.get $shape) (i32.const 4))
                (then
                  (i32.store (call $json_address (local.get $v)) (i32.const 1))
                  (i32.store offset=20 (call $json_address (local.get $v)) (i32.add (local.get $previous) (i32.const 1))))
                (else (memory.copy (call $json_address (local.get $v)) (call $json_address (local.get $previous)) (i32.const 12))))))))
      (local.set $k (call $json_kind (local.get $v)))
      (block $validated
        (br_if $validated (i32.eq (local.get $k) (i32.const 7)))
        (if (i32.eq (local.get $shape) (i32.const 1))
          (then
            (if (i32.ne (local.get $k) (i32.const 3))
              (then (call $opt_type_error (local.get $v) (local.get $schema) (local.get $p) (local.get $n) (i32.const 2621864) (i32.const 6))))
            (br $validated)))
        (if (i32.le_u (local.get $shape) (i32.const 3))
          (then
            (if (i32.eqz (i32.or (i32.eq (local.get $k) (i32.const 5)) (i32.eq (local.get $k) (i32.const 6))))
              (then (call $opt_type_error (local.get $v) (local.get $schema) (local.get $p) (local.get $n) (i32.const 2621876) (i32.const 4))))
            (br $validated)))
        (if (i32.or (i32.eq (local.get $shape) (i32.const 4)) (i32.eq (local.get $shape) (i32.const 9)))
          (then
            (if (i32.and (i32.eq (local.get $k) (i32.const 1))
                  (i32.eq (call $json_kind (local.get $previous)) (i32.const 1)))
              (then (i32.store offset=20 (call $json_address (local.get $v)) (i32.add (local.get $previous) (i32.const 1)))))
            (call $opt_shape (local.get $v)
              (select (i32.const 2) (i32.const 6) (i32.eq (local.get $shape) (i32.const 4))) (local.get $p) (local.get $n) (local.get $schema))
            (br $validated)))
        (if (i32.eq (local.get $shape) (i32.const 6))
          (then
            (if (i32.ne (local.get $k) (i32.const 1))
              (then (call $opt_type_error (local.get $v) (local.get $schema) (local.get $p) (local.get $n) (i32.const 2621971) (i32.const 27))))
            (if (i32.eq (call $json_kind (local.get $previous)) (i32.const 1))
              (then (i32.store offset=20 (call $json_address (local.get $v)) (i32.add (local.get $previous) (i32.const 1)))))
            (local.set $j (i32.add (local.get $v) (i32.const 1)))
            (block $map_done
              (loop $mapping
                (br_if $map_done (i32.ge_u (local.get $j) (i32.load offset=12 (call $json_address (local.get $v)))))
                (call $opt_shape (i32.add (local.get $j) (i32.const 1)) (i32.const 4) (local.get $p) (local.get $n) (local.get $schema))
                (local.set $j (i32.load offset=12 (call $json_address (i32.add (local.get $j) (i32.const 1)))))
                (br $mapping)))
            (br $validated)))
        (if (i32.ne (local.get $k) (i32.const 2))
          (then
            (if (i32.eq (local.get $shape) (i32.const 5))
              (then (call $opt_type_error (local.get $v) (local.get $schema) (local.get $p) (local.get $n) (i32.const 2621998) (i32.const 15))))
            (if (i32.eq (local.get $shape) (i32.const 7))
              (then (call $opt_type_error (local.get $v) (local.get $schema) (local.get $p) (local.get $n) (i32.const 2622013) (i32.const 20))))
            (call $opt_type_error (local.get $v) (local.get $schema) (local.get $p) (local.get $n) (i32.const 2622033) (i32.const 8))))
        ;; Go's slice decoder reuses existing elements when a duplicate array
        ;; field has backing capacity. Keep earlier arrays linked for that
        ;; reuse; an explicit empty array resets the capacity and breaks it.
        (if (i32.and (call $opt_count (local.get $v))
              (i32.eq (call $json_kind (local.get $previous)) (i32.const 2)))
          (then (i32.store offset=20 (call $json_address (local.get $v)) (i32.add (local.get $previous) (i32.const 1)))))
        (local.set $j (i32.const 0))
        (block $array_done
          (loop $element
            (br_if $array_done (i32.ge_u (local.get $j) (call $opt_count (local.get $v))))
            (local.set $child (call $json_at (local.get $v) (local.get $j)))
            (local.set $oldchild (call $opt_array_previous (local.get $previous) (local.get $j)))
            (if (i32.ge_s (local.get $oldchild) (i32.const 0))
              (then
                (if (i32.eq (local.get $shape) (i32.const 8))
                  (then
                    (if (i32.eq (call $json_kind (local.get $child)) (i32.const 7))
                      (then (memory.copy (call $json_address (local.get $child)) (call $json_address (local.get $oldchild)) (i32.const 12)))))
                  (else
                    (if (i32.eq (call $json_kind (local.get $oldchild)) (i32.const 1))
                      (then
                        (if (i32.eq (call $json_kind (local.get $child)) (i32.const 7))
                          (then (i32.store (call $json_address (local.get $child)) (i32.const 1))))
                        (if (i32.eq (call $json_kind (local.get $child)) (i32.const 1))
                          (then (i32.store offset=20 (call $json_address (local.get $child)) (i32.add (local.get $oldchild) (i32.const 1)))))))))))
            (if (i32.eq (local.get $shape) (i32.const 8))
              (then
                (if (i32.eqz (i32.or (i32.eq (call $json_kind (local.get $child)) (i32.const 3))
                                     (i32.eq (call $json_kind (local.get $child)) (i32.const 7))))
                  (then (call $opt_type_error (local.get $child) (local.get $schema) (local.get $p) (local.get $n) (i32.const 2621864) (i32.const 6)))))
              (else (call $opt_shape (local.get $child)
                (select (i32.const 3) (i32.const 5) (i32.eq (local.get $shape) (i32.const 5))) (local.get $p) (local.get $n) (local.get $schema))))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $element))))
      (call $text_reset (local.get $mark))
      (local.set $i (i32.load offset=12 (call $json_address (local.get $v))))
      (br $field))))

(func $opt_nonempty (param $obj i32) (param $p i32) (param $n i32) (result i32)
  (call $opt_string (local.get $obj) (local.get $p) (local.get $n))
  (local.set $n) (drop)
  (i32.ne (local.get $n) (i32.const 0)))

(func $opt_nonblank (param $obj i32) (param $p i32) (param $n i32) (result i32)
  (call $opt_string (local.get $obj) (local.get $p) (local.get $n))
  (call $trim_space) (local.set $n) (drop)
  (i32.ne (local.get $n) (i32.const 0)))

(func $opt_is (param $obj i32) (param $key i32) (param $keyn i32) (param $p i32) (param $n i32) (result i32)
  (call $opt_string (local.get $obj) (local.get $key) (local.get $keyn))
  (local.get $p) (local.get $n) (call $eq))

(func $opt_present_object (param $obj i32) (param $p i32) (param $n i32) (result i32)
  (i32.eq (call $json_kind (call $opt_get (local.get $obj) (local.get $p) (local.get $n))) (i32.const 1)))

;; Parse the driver grammar directly. This preserves versioned import strings
;; while providing stable numeric driver identities for generation.
(func $opt_version_char (param $c i32) (result i32)
  (if (i32.le_u (i32.sub (local.get $c) (i32.const 48)) (i32.const 9)) (then (return (i32.const 1))))
  (if (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const 97)) (i32.const 25)) (then (return (i32.const 1))))
  (if (i32.eq (local.get $c) (i32.const 46)) (then (return (i32.const 1))))
  (if (i32.eq (local.get $c) (i32.const 42)) (then (return (i32.const 1))))
  (if (i32.eq (local.get $c) (i32.const 94)) (then (return (i32.const 1))))
  (if (i32.eq (local.get $c) (i32.const 126)) (then (return (i32.const 1))))
  (if (i32.eq (local.get $c) (i32.const 43)) (then (return (i32.const 1))))
  (if (i32.eq (local.get $c) (i32.const 95)) (then (return (i32.const 1))))
  (i32.eq (local.get $c) (i32.const 45)))

(func $opt_driver_parse (param $token i32)
  (local $p i32) (local $n i32) (local $base i32) (local $basen i32)
  (local $prefix i32) (local $promise i32) (local $version i32)
  (local $i i32) (local $at i32) (local $c i32)
  (local.set $p (call $json_ptr (local.get $token)))
  (local.set $n (call $json_len (local.get $token)))
  (global.set $opt_driver_ptr (local.get $p))
  (global.set $opt_driver_len (local.get $n))
  (if (i32.ge_u (local.get $n) (i32.const 4))
    (then
      (if (call $eq (local.get $p) (i32.const 4) (i32.const 2622041) (i32.const 4))
        (then (local.set $prefix (i32.const 1))))
      (if (call $eq (local.get $p) (i32.const 4) (i32.const 2622045) (i32.const 4))
        (then (local.set $prefix (i32.const 2))))
      (if (local.get $prefix)
        (then (local.set $p (i32.add (local.get $p) (i32.const 4)))
              (local.set $n (i32.sub (local.get $n) (i32.const 4)))))))
  (if (i32.ge_u (local.get $n) (i32.const 8))
    (then
      (if (call $eq (i32.add (local.get $p) (i32.sub (local.get $n) (i32.const 8))) (i32.const 8) (i32.const 2622049) (i32.const 8))
        (then (local.set $promise (i32.const 1)) (local.set $n (i32.sub (local.get $n) (i32.const 8)))))))
  (local.set $at (i32.const -1))
  (local.set $i (i32.const 1))
  (block $at_done
    (loop $at_loop
      (br_if $at_done (i32.ge_u (local.get $i) (local.get $n)))
      (if (i32.eq (i32.load8_u (i32.add (local.get $p) (local.get $i))) (i32.const 64))
        (then (local.set $at (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $at_loop)))
  (local.set $basen (local.get $n))
  (if (i32.ge_s (local.get $at) (i32.const 0))
    (then (local.set $version (i32.const 1)) (local.set $basen (local.get $at))))
  (global.set $opt_driver (i32.const 0))
  (if (call $eq (local.get $p) (local.get $basen) (i32.const 2622057) (i32.const 2)) (then (global.set $opt_driver (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $basen) (i32.const 2622059) (i32.const 8)) (then (global.set $opt_driver (i32.const 2))))
  (if (call $eq (local.get $p) (local.get $basen) (i32.const 2621472) (i32.const 6)) (then (global.set $opt_driver (i32.const 3))))
  (if (call $eq (local.get $p) (local.get $basen) (i32.const 2622067) (i32.const 14)) (then (global.set $opt_driver (i32.const 4))))
  (if (call $eq (local.get $p) (local.get $basen) (i32.const 2622081) (i32.const 16)) (then (global.set $opt_driver (i32.const 5))))
  (if (i32.or (i32.eqz (global.get $opt_driver))
        (i32.or
          (i32.and (local.get $promise) (i32.ne (global.get $opt_driver) (i32.const 3)))
          (i32.or
            (i32.and (i32.eq (local.get $prefix) (i32.const 2)) (i32.ne (global.get $opt_driver) (i32.const 5)))
            (i32.and (i32.eq (local.get $prefix) (i32.const 1)) (i32.eq (global.get $opt_driver) (i32.const 5))))))
    (then (call $opt_error_quote (i32.const 2622097) (i32.const 19) (local.get $token))))
  (if (local.get $version)
    (then
      (local.set $i (i32.add (local.get $at) (i32.const 1)))
      (if (i32.ge_u (local.get $i) (local.get $n))
        (then (call $opt_error_quote (i32.const 2622097) (i32.const 19) (local.get $token))))
      (block $version_done
        (loop $version_byte
          (br_if $version_done (i32.ge_u (local.get $i) (local.get $n)))
          (local.set $c (i32.load8_u (i32.add (local.get $p) (local.get $i))))
          (if (i32.eqz (call $opt_version_char (local.get $c)))
            (then (call $opt_error_quote (i32.const 2622097) (i32.const 19) (local.get $token))))
          (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $version_byte)))))
  (if (i32.and (local.get $version)
        (i32.and (i32.ne (global.get $opt_runtime) (i32.const 3)) (i32.ne (global.get $opt_driver) (i32.const 5))))
    (then
      (if (i32.eq (global.get $opt_runtime) (i32.const 2))
        (then (call $opt_error (i32.const 2622116) (i32.const 87)))
        (else (call $opt_error (i32.const 2622203) (i32.const 88))))))
  (if (i32.and (i32.eq (global.get $opt_driver) (i32.const 5)) (i32.ne (global.get $opt_runtime) (i32.const 3)))
    (then (call $opt_error (i32.const 2622291) (i32.const 39)))))

(func $opt_driver_name (result i32 i32)
  (if (i32.eq (global.get $opt_driver) (i32.const 1)) (then (return (i32.const 2622057) (i32.const 2))))
  (if (i32.eq (global.get $opt_driver) (i32.const 2)) (then (return (i32.const 2622059) (i32.const 8))))
  (if (i32.eq (global.get $opt_driver) (i32.const 3)) (then (return (i32.const 2621472) (i32.const 6))))
  (if (i32.eq (global.get $opt_driver) (i32.const 4)) (then (return (i32.const 2622067) (i32.const 14))))
  (i32.const 2622081) (i32.const 16))

(func $opt_driver_specifier (result i32 i32)
  (if (i32.eq (global.get $opt_driver) (i32.const 3)) (then (return (i32.const 2622330) (i32.const 14))))
  (call $opt_driver_name))

(func $opt_inline_nonempty (param $obj i32) (result i32)
  (i32.or
    (i32.or (call $opt_nonempty (local.get $obj) (i32.const 2621667) (i32.const 7)) (call $opt_nonempty (local.get $obj) (i32.const 2621674) (i32.const 6)))
    (i32.or (call $opt_present_object (local.get $obj) (i32.const 2621680) (i32.const 6)) (call $opt_present_object (local.get $obj) (i32.const 2621686) (i32.const 5)))))

;; Resolve a named mapping. All mapping values were validated before overrides,
;; so callers can keep this token index as their type/codec contract.
(func $opt_resolve_mapping (param $obj i32) (result i32)
  (local $name i32) (local $mapping i32)
  (local.set $name (call $opt_get (local.get $obj) (i32.const 2621697) (i32.const 7)))
  (if (call $opt_nonempty (local.get $obj) (i32.const 2621697) (i32.const 7))
    (then
      (if (call $opt_inline_nonempty (local.get $obj))
        (then (call $opt_error (i32.const 2622344) (i32.const 61))))
      (local.set $mapping (call $opt_get
        (call $opt_get (global.get $opt_root) (i32.const 2621576) (i32.const 13))
        (call $json_ptr (local.get $name)) (call $json_len (local.get $name))))
      (if (i32.lt_s (local.get $mapping) (i32.const 0))
        (then (call $opt_error_quote (i32.const 2622405) (i32.const 21) (local.get $name))))
      (return (local.get $mapping))))
  (call $opt_validate_mapping (local.get $obj))
  (local.get $obj))

(func $opt_primitive (param $p i32) (param $n i32) (result i32)
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2621864) (i32.const 6)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2621870) (i32.const 6)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2622426) (i32.const 6)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2622432) (i32.const 7)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2622439) (i32.const 4)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2622443) (i32.const 10)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2622453) (i32.const 6)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2622459) (i32.const 7)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2622466) (i32.const 3)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2621853) (i32.const 6)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2622469) (i32.const 4)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2622473) (i32.const 9)) (then (return (i32.const 1))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2622482) (i32.const 6)) (then (return (i32.const 1))))
  (call $eq (local.get $p) (local.get $n) (i32.const 2622488) (i32.const 4)))

(func $opt_validate_mapping (param $obj i32)
  (local $preset i32) (local $base i32) (local $basen i32)
  (local $p i32) (local $n i32) (local $mark i32) (local $item i32)
  (local.set $preset (call $opt_get (local.get $obj) (i32.const 2621674) (i32.const 6)))
  (if (call $opt_nonempty (local.get $obj) (i32.const 2621674) (i32.const 6))
    (then
      (block $preset_valid
        (if (call $json_eq (local.get $preset) (i32.const 2622492) (i32.const 12))
          (then (i32.const 2621870) (i32.const 6) (local.set $basen) (local.set $base) (br $preset_valid)))
        (if (call $json_eq (local.get $preset) (i32.const 2622504) (i32.const 18))
          (then (i32.const 2622439) (i32.const 4) (local.set $basen) (local.set $base) (br $preset_valid)))
        (if (call $json_eq (local.get $preset) (i32.const 2622522) (i32.const 14))
          (then (i32.const 2622432) (i32.const 7) (local.set $basen) (local.set $base) (br $preset_valid)))
        (br_if $preset_valid (call $json_eq (local.get $preset) (i32.const 2622536) (i32.const 9)))
        (call $opt_error_quote (i32.const 2622545) (i32.const 21) (local.get $preset)))
      (if (local.get $basen)
        (then
          (call $opt_string (local.get $obj) (i32.const 2621667) (i32.const 7)) (call $trim_space) (local.set $n) (local.set $p)
          (if (i32.and (call $opt_primitive (local.get $p) (local.get $n))
                (i32.eqz (call $eq (local.get $p) (local.get $n) (local.get $base) (local.get $basen))))
            (then
              (local.set $mark (call $text_mark))
              (call $text_append (i32.const 2622566) (i32.const 7))
              (call $text_append (call $json_ptr (local.get $preset)) (call $json_len (local.get $preset)))
              (call $text_append (i32.const 2622573) (i32.const 28))
              (call $text_append (local.get $base) (local.get $basen))
              (call $text_append (i32.const 2622601) (i32.const 11))
              (call $text_append (local.get $p) (local.get $n))
              (call $opt_error (local.get $mark) (i32.sub (global.get $txt_cursor) (local.get $mark)))))))
      (if (call $opt_present_object (local.get $obj) (i32.const 2621686) (i32.const 5))
        (then (call $opt_error (i32.const 2622612) (i32.const 32))))
      (if (i32.lt_u (global.get $opt_driver) (i32.const 4))
        (then (call $opt_error (i32.const 2622644) (i32.const 37))))
      (if (i32.eqz (global.get $opt_mode_native))
        (then (call $opt_error (i32.const 2622681) (i32.const 46))))))
  (if (i32.and (i32.eqz (call $opt_nonblank (local.get $obj) (i32.const 2621667) (i32.const 7)))
        (i32.eqz (call $opt_nonempty (local.get $obj) (i32.const 2621674) (i32.const 6))))
    (then (call $opt_error (i32.const 2622727) (i32.const 26))))
  (if (i32.and (call $opt_present_object (local.get $obj) (i32.const 2621680) (i32.const 6))
        (i32.eqz (call $opt_nonblank (local.get $obj) (i32.const 2621667) (i32.const 7))))
    (then (call $opt_error (i32.const 2622753) (i32.const 23))))
  (local.set $item (call $opt_get (local.get $obj) (i32.const 2621680) (i32.const 6)))
  (if (i32.eq (call $json_kind (local.get $item)) (i32.const 1))
    (then
      (if (i32.eqz (i32.and (call $opt_nonblank (local.get $item) (i32.const 2621659) (i32.const 4)) (call $opt_nonblank (local.get $item) (i32.const 2621663) (i32.const 4))))
        (then (call $opt_error (i32.const 2622776) (i32.const 29))))))
  (local.set $item (call $opt_get (local.get $obj) (i32.const 2621686) (i32.const 5)))
  (if (i32.eq (call $json_kind (local.get $item)) (i32.const 1))
    (then
      (if (i32.eqz (i32.and (call $opt_nonblank (local.get $item) (i32.const 2621659) (i32.const 4)) (call $opt_nonblank (local.get $item) (i32.const 2621663) (i32.const 4))))
        (then (call $opt_error (i32.const 2622805) (i32.const 28)))))))

(func $opt_selector (param $token i32)
  (local $p i32) (local $n i32) (local $i i32) (local $parts i32)
  (local $partn i32) (local $escaped i32) (local $c i32) (local $mark i32)
  (local.set $p (call $json_ptr (local.get $token)))
  (local.set $n (select (call $json_len (local.get $token)) (i32.const 0)
    (i32.eq (call $json_kind (local.get $token)) (i32.const 3))))
  (local.set $parts (i32.const 1))
  (block $count_done
    (loop $count
      (br_if $count_done (i32.ge_u (local.get $i) (local.get $n)))
      (if (i32.eq (i32.load8_u (i32.add (local.get $p) (local.get $i))) (i32.const 46))
        (then (local.set $parts (i32.add (local.get $parts) (i32.const 1)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $count)))
  (if (i32.gt_u (i32.sub (local.get $parts) (i32.const 2)) (i32.const 2))
    (then (call $opt_error (i32.const 2622833) (i32.const 48))))
  (local.set $i (i32.const 0))
  (block $done
    (loop $byte
      (local.set $c (select
        (i32.load8_u (i32.add (local.get $p) (local.get $i))) (i32.const 46)
        (i32.lt_u (local.get $i) (local.get $n))))
      (if (i32.eq (local.get $c) (i32.const 46))
        (then
          (if (i32.eqz (local.get $partn)) (then (call $opt_error (i32.const 2622881) (i32.const 29))))
          (if (local.get $escaped) (then (call $opt_error (i32.const 2622910) (i32.const 53))))
          (local.set $partn (i32.const 0)))
        (else
          (local.set $partn (i32.add (local.get $partn) (i32.const 1)))
          (if (local.get $escaped)
            (then
              (local.set $escaped (i32.const 0))
              (if (i32.eqz (i32.or (i32.eq (local.get $c) (i32.const 42))
                    (i32.or (i32.eq (local.get $c) (i32.const 63)) (i32.eq (local.get $c) (i32.const 92)))))
                (then
                  (local.set $mark (call $text_mark))
                  (call $text_append (i32.const 2622963) (i32.const 43))
                  (if (i32.ge_u (local.get $c) (i32.const 128))
                    (then (call $text_byte (i32.or (i32.const 192) (i32.shr_u (local.get $c) (i32.const 6))))
                          (local.set $c (i32.or (i32.const 128) (i32.and (local.get $c) (i32.const 63))))))
                  (call $text_byte (local.get $c)) (call $text_append (i32.const 2623006) (i32.const 1))
                  (call $opt_error (local.get $mark) (i32.sub (global.get $txt_cursor) (local.get $mark))))))
            (else (if (i32.eq (local.get $c) (i32.const 92)) (then (local.set $escaped (i32.const 1))))))))
      (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $byte))))

;; Iterate named mappings in byte-sorted key order without allocating a sort
;; array. Selection is O(n^2), bounded by the fixed JSON token capacity. Linked
;; earlier map occurrences contribute keys; opt_get supplies the newest value.
(func $opt_validate_named
  (local $map i32) (local $walk i32) (local $i i32) (local $end i32)
  (local $last i32) (local $best i32) (local $v i32)
  (local $p i32) (local $n i32) (local $mark i32) (local $qp i32) (local $qn i32)
  (local.set $map (call $opt_get (global.get $opt_root) (i32.const 2621576) (i32.const 13)))
  (local.set $last (i32.const -1))
  (block $done
    (loop $name
      (local.set $best (i32.const -1))
      (local.set $walk (local.get $map))
      (block $walk_done
        (loop $object
          (br_if $walk_done (i32.ne (call $json_kind (local.get $walk)) (i32.const 1)))
          (local.set $i (i32.add (local.get $walk) (i32.const 1)))
          (local.set $end (i32.load offset=12 (call $json_address (local.get $walk))))
          (block $members_done
            (loop $member
              (br_if $members_done (i32.ge_u (local.get $i) (local.get $end)))
              (block $skip
                (if (i32.ge_s (local.get $last) (i32.const 0))
                  (then
                    (br_if $skip (i32.le_s
                      (call $compare (call $json_ptr (local.get $i)) (call $json_len (local.get $i))
                        (call $json_ptr (local.get $last)) (call $json_len (local.get $last))) (i32.const 0)))))
                (if (i32.ge_s (local.get $best) (i32.const 0))
                  (then
                    (br_if $skip (i32.ge_s
                      (call $compare (call $json_ptr (local.get $i)) (call $json_len (local.get $i))
                        (call $json_ptr (local.get $best)) (call $json_len (local.get $best))) (i32.const 0)))))
                (local.set $best (local.get $i)))
              (local.set $i (i32.load offset=12 (call $json_address (i32.add (local.get $i) (i32.const 1)))))
              (br $member)))
          (local.set $walk (i32.sub (i32.load offset=20 (call $json_address (local.get $walk))) (i32.const 1)))
          (br $object)))
      (br_if $done (i32.lt_s (local.get $best) (i32.const 0)))
      (call $opt_prefix (i32.const 2623007) (i32.const 12))
      (call $trim_space (call $json_ptr (local.get $best)) (call $json_len (local.get $best))) (local.set $n) (local.set $p)
      (if (i32.or (i32.eqz (local.get $n)) (i32.ne (local.get $n) (call $json_len (local.get $best))))
        (then (call $opt_error (i32.const 2623019) (i32.const 70))))
      (local.set $mark (call $text_mark))
      (call $go_quote (call $json_ptr (local.get $best)) (call $json_len (local.get $best))) (local.set $qn) (local.set $qp)
      (local.set $p (call $text_mark))
      (call $text_append (i32.const 2623089) (i32.const 25))
      (call $text_append (local.get $qp) (local.get $qn))
      (call $text_append (i32.const 2623114) (i32.const 2))
      (call $opt_prefix (local.get $p) (i32.sub (global.get $txt_cursor) (local.get $p)))
      (local.set $v (call $opt_get (local.get $map) (call $json_ptr (local.get $best)) (call $json_len (local.get $best))))
      (call $opt_validate_mapping (local.get $v))
      (call $text_reset (local.get $mark))
      (local.set $last (local.get $best))
      (br $name))))

(func $opt_index_prefix (param $query i32) (param $index i32) (param $colon i32)
  (local $p i32) (local $np i32) (local $nn i32)
  (call $decimal_i32 (i32.add (local.get $index) (i32.const 1))) (local.set $nn) (local.set $np)
  (local.set $p (call $text_mark))
  (if (local.get $query)
    (then (call $text_append (i32.const 2623116) (i32.const 27)))
    (else (call $text_append (i32.const 2623143) (i32.const 21))))
  (call $text_append (local.get $np) (local.get $nn))
  (if (local.get $colon) (then (call $text_append (i32.const 2623114) (i32.const 2))) (else (call $text_append (i32.const 2623164) (i32.const 1))))
  (call $opt_prefix (local.get $p) (i32.sub (global.get $txt_cursor) (local.get $p))))

(func $opt_validate_overrides (param $query i32)
  (local $arr i32) (local $i i32) (local $obj i32) (local $selectors i32)
  (local $cols i32) (local $j i32) (local $mark i32) (local $nullable i32)
  (if (local.get $query)
    (then (local.set $arr (call $opt_get (global.get $opt_root) (i32.const 2621589) (i32.const 15))))
    (else (local.set $arr (call $opt_get (global.get $opt_root) (i32.const 2621567) (i32.const 9)))))
  (block $done
    (loop $override
      (br_if $done (i32.ge_u (local.get $i) (call $opt_count (local.get $arr))))
      (local.set $mark (call $text_mark))
      (local.set $obj (call $json_at (local.get $arr) (local.get $i)))
      (call $opt_index_prefix (local.get $query) (local.get $i) (i32.const 0))
      (if (local.get $query)
        (then
          (if (i32.eqz (call $opt_nonblank (local.get $obj) (i32.const 2621738) (i32.const 5)))
            (then (call $opt_error (i32.const 2623165) (i32.const 14))))
          (if (i32.eq (call $opt_nonempty (local.get $obj) (i32.const 2621743) (i32.const 9)) (call $opt_nonempty (local.get $obj) (i32.const 2621691) (i32.const 6)))
            (then (call $opt_error (i32.const 2623179) (i32.const 47)))))
        (else
          (local.set $cols (call $opt_get (local.get $obj) (i32.const 2621704) (i32.const 7)))
          (local.set $selectors (i32.add
            (i32.add (call $opt_nonempty (local.get $obj) (i32.const 2621691) (i32.const 6)) (call $opt_nonempty (local.get $obj) (i32.const 2621711) (i32.const 7)))
            (i32.ne (call $opt_count (local.get $cols)) (i32.const 0))))
          (if (i32.ne (local.get $selectors) (i32.const 1))
            (then (call $opt_error (i32.const 2623226) (i32.const 55))))
          (if (i32.and (call $opt_bool (local.get $obj) (i32.const 2621726) (i32.const 12))
                (i32.or (call $opt_bool (local.get $obj) (i32.const 2621718) (i32.const 8)) (i32.eqz (call $opt_nonempty (local.get $obj) (i32.const 2621711) (i32.const 7)))))
            (then (call $opt_error (i32.const 2623281) (i32.const 68))))))
      (block $mapping_done
        (if (local.get $query)
          (then
            (local.set $nullable (call $json_kind (call $opt_get (local.get $obj) (i32.const 2621718) (i32.const 8))))
            (br_if $mapping_done (i32.and
              (i32.and (i32.eqz (call $opt_nonempty (local.get $obj) (i32.const 2621697) (i32.const 7))) (i32.eqz (call $opt_inline_nonempty (local.get $obj))))
              (i32.or (i32.eq (local.get $nullable) (i32.const 5)) (i32.eq (local.get $nullable) (i32.const 6)))))))
        (call $opt_index_prefix (local.get $query) (local.get $i) (i32.const 1))
        (drop (call $opt_resolve_mapping (local.get $obj))))
      (if (i32.eqz (local.get $query))
        (then
          (call $opt_index_prefix (i32.const 0) (local.get $i) (i32.const 0))
          (if (call $opt_nonempty (local.get $obj) (i32.const 2621691) (i32.const 6))
            (then (call $opt_selector (call $opt_get (local.get $obj) (i32.const 2621691) (i32.const 6))))
            (else
              (local.set $j (i32.const 0))
              (block $cols_done
                (loop $column
                  (br_if $cols_done (i32.ge_u (local.get $j) (call $opt_count (local.get $cols))))
                  (call $opt_selector (call $json_at (local.get $cols) (local.get $j)))
                  (local.set $j (i32.add (local.get $j) (i32.const 1))) (br $column)))))))
      (call $text_reset (local.get $mark))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $override))))

(func $options_parse (param $p i32) (param $n i32) (result i32)
  (local $obj i32) (local $v i32) (local $k i32) (local $mark i32)
  (local $original i32) (local $originaln i32) (local $one_end i32)
  (local.set $original (local.get $p)) (local.set $originaln (local.get $n))
  (global.set $opt_root (i32.const -1))
  (global.set $opt_runtime (i32.const 1))
  (global.set $opt_driver (i32.const 0))
  (global.set $opt_mode_native (i32.const 0))
  (global.set $opt_types_only (i32.const 0))
  (global.set $opt_null_undefined (i32.const 0))
  (global.set $opt_optional_args (i32.const 0))
  (global.set $opt_factory (i32.const 0))
  (global.set $opt_sql_const (i32.const 1))
  (global.set $opt_mysql_support (i32.const 0))
  (global.set $opt_mysql_strings (i32.const 0))
  (global.set $opt_mysql_insert_unsigned (i32.const -1))
  (call $trim_space (local.get $p) (local.get $n)) (local.set $n) (local.set $p)
  (local.set $obj (i32.const -1))
  (if (local.get $n)
    (then
      (if (i32.ne (i32.load8_u (local.get $p)) (i32.const 123))
        (then (call $error (i32.const 2623349) (i32.const 44)) unreachable))
      (local.set $one_end (call $opt_json_one (local.get $original) (local.get $originaln)))
      (local.set $obj (call $json_parse (local.get $original) (i32.sub (local.get $one_end) (local.get $original))))
      (call $opt_shape (local.get $obj) (i32.const 1) (i32.const 0) (i32.const 0) (i32.const 1))
      (if (i32.ne (local.get $one_end) (i32.add (local.get $original) (local.get $originaln)))
        (then (call $error (i32.const 2623349) (i32.const 44)) unreachable))))
  (global.set $opt_root (local.get $obj))
  (call $opt_prefix (i32.const 2623007) (i32.const 12))
  (if (i32.eqz (call $opt_nonempty (local.get $obj) (i32.const 2621450) (i32.const 6)))
    (then (call $opt_error (i32.const 2623393) (i32.const 81))))
  (local.set $v (call $opt_get (local.get $obj) (i32.const 2621456) (i32.const 16)))
  (if (call $opt_nonempty (local.get $obj) (i32.const 2621456) (i32.const 16))
    (then
      (if (call $json_eq (local.get $v) (i32.const 2623474) (i32.const 6))
        (then (global.set $opt_mode_native (i32.const 1)))
        (else
          (if (i32.eqz (call $json_eq (local.get $v) (i32.const 2621450) (i32.const 6)))
            (then (call $opt_qerror_tail (i32.const 2623480) (i32.const 29) (local.get $v) (i32.const 2623509) (i32.const 22))))))))
  (local.set $v (call $opt_get (local.get $obj) (i32.const 2621443) (i32.const 7)))
  (if (call $opt_nonempty (local.get $obj) (i32.const 2621443) (i32.const 7))
    (then
      (block $runtime_done
        (br_if $runtime_done (call $json_eq (local.get $v) (i32.const 2623531) (i32.const 4)))
        (if (call $json_eq (local.get $v) (i32.const 2623535) (i32.const 3))
          (then (global.set $opt_runtime (i32.const 2)) (br $runtime_done)))
        (if (call $json_eq (local.get $v) (i32.const 2623538) (i32.const 4))
          (then (global.set $opt_runtime (i32.const 3)) (br $runtime_done)))
        (call $opt_qerror_tail (i32.const 2623542) (i32.const 20) (local.get $v) (i32.const 2623562) (i32.const 24)))))
  (call $opt_driver_parse (call $opt_get (local.get $obj) (i32.const 2621450) (i32.const 6)))
  (global.set $opt_types_only (call $opt_bool (local.get $obj) (i32.const 2621478) (i32.const 10)))
  (global.set $opt_null_undefined (call $opt_bool (local.get $obj) (i32.const 2621488) (i32.const 22)))
  (global.set $opt_factory (call $opt_bool (local.get $obj) (i32.const 2621532) (i32.const 18)))
  (global.set $opt_optional_args (global.get $opt_null_undefined))
  (local.set $k (call $json_kind (call $opt_get (local.get $obj) (i32.const 2621510) (i32.const 22))))
  (if (i32.or (i32.eq (local.get $k) (i32.const 5)) (i32.eq (local.get $k) (i32.const 6)))
    (then (global.set $opt_optional_args (i32.eq (local.get $k) (i32.const 5)))))
  (local.set $k (call $json_kind (call $opt_get (local.get $obj) (i32.const 2621550) (i32.const 17))))
  (if (i32.eq (local.get $k) (i32.const 6)) (then (global.set $opt_sql_const (i32.const 0))))
  (local.set $v (call $opt_get (local.get $obj) (i32.const 2621472) (i32.const 6)))
  (global.set $opt_mysql_support (call $opt_bool (local.get $v) (i32.const 2621604) (i32.const 19)))
  (global.set $opt_mysql_strings (call $opt_bool (local.get $v) (i32.const 2621623) (i32.const 18)))
  (local.set $k (call $json_kind (call $opt_get (local.get $v) (i32.const 2621641) (i32.const 18))))
  (if (i32.or (i32.eq (local.get $k) (i32.const 5)) (i32.eq (local.get $k) (i32.const 6)))
    (then (global.set $opt_mysql_insert_unsigned (i32.eq (local.get $k) (i32.const 5)))))
  (call $opt_validate_named)
  (call $opt_validate_overrides (i32.const 0))
  (call $opt_validate_overrides (i32.const 1))
  (call $opt_prefix (i32.const 2623007) (i32.const 12))
  (local.get $obj))

(func $opt_validate_engine (param $p i32) (param $n i32)
  (local $expected i32) (local $expectedn i32) (local $mark i32) (local $qp i32) (local $qn i32)
  (if (i32.le_u (global.get $opt_driver) (i32.const 2))
    (then (i32.const 2623586) (i32.const 10) (local.set $expectedn) (local.set $expected))
    (else
      (if (i32.eq (global.get $opt_driver) (i32.const 3))
        (then (i32.const 2623596) (i32.const 5) (local.set $expectedn) (local.set $expected))
        (else (i32.const 2623601) (i32.const 6) (local.set $expectedn) (local.set $expected)))))
  (if (call $eq (local.get $p) (local.get $n) (local.get $expected) (local.get $expectedn)) (then (return)))
  (call $go_quote (local.get $p) (local.get $n)) (local.set $qn) (local.set $qp)
  (local.set $mark (call $text_mark))
  (call $text_append (i32.const 2623007) (i32.const 12))
  (call $opt_driver_name) (call $text_append)
  (call $text_append (i32.const 2623607) (i32.const 18))
  (call $text_append (local.get $expected) (local.get $expectedn))
  (call $text_append (i32.const 2623625) (i32.const 11))
  (call $text_append (local.get $qp) (local.get $qn))
  (call $text_append (i32.const 2623636) (i32.const 1))
  (call $error (local.get $mark) (i32.sub (global.get $txt_cursor) (local.get $mark)))
  unreachable)

;; A read-only syntax pass preserves encoding/json.Decoder diagnostics before
;; destructive string decoding begins. It stops after the first complete value;
;; Parse reports any second value or trailing junk as "expected one JSON object"
;; only after the first object's field checks have succeeded.
(func $opt_json_error (param $c i32) (param $p i32) (param $n i32)
  (local $mark i32) (local $qp i32) (local $qn i32)
  (if (i32.eq (local.get $c) (i32.const -1))
    (then (call $error (i32.const 2623637) (i32.const 34)) unreachable))
  (call $go_quote_rune (local.get $c)) (local.set $qn) (local.set $qp)
  (local.set $mark (call $text_mark))
  (call $text_append (i32.const 2623671) (i32.const 38))
  (call $text_append (local.get $qp) (local.get $qn))
  (call $text_append (i32.const 2623164) (i32.const 1))
  (call $text_append (local.get $p) (local.get $n))
  (call $error (local.get $mark) (i32.sub (global.get $txt_cursor) (local.get $mark)))
  unreachable)

(func $opt_json_take (result i32)
  (local $c i32)
  (local.set $c (call $json_peek))
  (if (i32.eq (local.get $c) (i32.const -1))
    (then (call $opt_json_error (local.get $c) (i32.const 0) (i32.const 0))))
  (global.set $json_cursor (i32.add (global.get $json_cursor) (i32.const 1)))
  (local.get $c))

(func $opt_json_expect (param $wanted i32) (param $p i32) (param $n i32)
  (local $c i32)
  (local.set $c (call $opt_json_take))
  (if (i32.ne (local.get $c) (local.get $wanted))
    (then (call $opt_json_error (local.get $c) (local.get $p) (local.get $n)))))

(func $opt_json_string
  (local $c i32) (local $i i32)
  (drop (call $opt_json_take))
  (block $done
    (loop $character
      (local.set $c (call $opt_json_take))
      (br_if $done (i32.eq (local.get $c) (i32.const 34)))
      (if (i32.lt_u (local.get $c) (i32.const 32))
        (then (call $opt_json_error (local.get $c) (i32.const 2623709) (i32.const 17))))
      (if (i32.eq (local.get $c) (i32.const 92))
        (then
          (local.set $c (call $opt_json_take))
          (block $escape_done
            (br_if $escape_done (i32.or (i32.eq (local.get $c) (i32.const 34))
              (i32.or (i32.eq (local.get $c) (i32.const 92)) (i32.eq (local.get $c) (i32.const 47)))))
            (br_if $escape_done (i32.or (i32.eq (local.get $c) (i32.const 98))
              (i32.or (i32.eq (local.get $c) (i32.const 102)) (i32.eq (local.get $c) (i32.const 110)))))
            (br_if $escape_done (i32.or (i32.eq (local.get $c) (i32.const 114)) (i32.eq (local.get $c) (i32.const 116))))
            (if (i32.ne (local.get $c) (i32.const 117))
              (then (call $opt_json_error (local.get $c) (i32.const 2623726) (i32.const 21))))
            (local.set $i (i32.const 0))
            (loop $hex
              (local.set $c (call $opt_json_take))
              (if (i32.eqz (i32.or (call $json_digit (local.get $c))
                    (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const 97)) (i32.const 5))))
                (then (call $opt_json_error (local.get $c) (i32.const 2623747) (i32.const 34))))
              (local.set $i (i32.add (local.get $i) (i32.const 1)))
              (br_if $hex (i32.lt_u (local.get $i) (i32.const 4)))))))
      (br $character))))

(func $opt_json_number
  (local $c i32)
  (local.set $c (call $opt_json_take))
  (if (i32.eq (local.get $c) (i32.const 45))
    (then
      (local.set $c (call $opt_json_take))
      (if (i32.eqz (call $json_digit (local.get $c)))
        (then (call $opt_json_error (local.get $c) (i32.const 2623781) (i32.const 18))))))
  (if (i32.ne (local.get $c) (i32.const 48))
    (then
      (block $integer_done
        (loop $integer
          (br_if $integer_done (i32.eqz (call $json_digit (call $json_peek))))
          (drop (call $opt_json_take)) (br $integer)))))
  (if (i32.eq (call $json_peek) (i32.const 46))
    (then
      (drop (call $opt_json_take))
      (local.set $c (call $opt_json_take))
      (if (i32.eqz (call $json_digit (local.get $c)))
        (then (call $opt_json_error (local.get $c) (i32.const 2623799) (i32.const 38))))
      (block $fraction_done
        (loop $fraction
          (br_if $fraction_done (i32.eqz (call $json_digit (call $json_peek))))
          (drop (call $opt_json_take)) (br $fraction)))))
  (local.set $c (call $json_peek))
  (if (i32.or (i32.eq (local.get $c) (i32.const 101)) (i32.eq (local.get $c) (i32.const 69)))
    (then
      (drop (call $opt_json_take))
      (local.set $c (call $opt_json_take))
      (if (i32.or (i32.eq (local.get $c) (i32.const 43)) (i32.eq (local.get $c) (i32.const 45)))
        (then (local.set $c (call $opt_json_take))))
      (if (i32.eqz (call $json_digit (local.get $c)))
        (then (call $opt_json_error (local.get $c) (i32.const 2623837) (i32.const 30))))
      (block $exponent_done
        (loop $exponent
          (br_if $exponent_done (i32.eqz (call $json_digit (call $json_peek))))
          (drop (call $opt_json_take)) (br $exponent))))))

(func $opt_json_value (param $depth i32)
  (local $c i32) (local $object i32) (local $close i32)
  (call $json_space)
  (local.set $c (call $json_peek))
  (if (i32.eq (local.get $c) (i32.const 34)) (then (call $opt_json_string) (return)))
  (if (i32.or (i32.eq (local.get $c) (i32.const 45)) (call $json_digit (local.get $c)))
    (then (call $opt_json_number) (return)))
  (if (i32.eq (local.get $c) (i32.const 116))
    (then
      (drop (call $opt_json_take))
      (call $opt_json_expect (i32.const 114) (i32.const 2623867) (i32.const 31))
      (call $opt_json_expect (i32.const 117) (i32.const 2623898) (i32.const 31))
      (call $opt_json_expect (i32.const 101) (i32.const 2623929) (i32.const 31)) (return)))
  (if (i32.eq (local.get $c) (i32.const 102))
    (then
      (drop (call $opt_json_take))
      (call $opt_json_expect (i32.const 97) (i32.const 2623960) (i32.const 32))
      (call $opt_json_expect (i32.const 108) (i32.const 2623992) (i32.const 32))
      (call $opt_json_expect (i32.const 115) (i32.const 2624024) (i32.const 32))
      (call $opt_json_expect (i32.const 101) (i32.const 2624056) (i32.const 32)) (return)))
  (if (i32.eq (local.get $c) (i32.const 110))
    (then
      (drop (call $opt_json_take))
      (call $opt_json_expect (i32.const 117) (i32.const 2624088) (i32.const 31))
      (call $opt_json_expect (i32.const 108) (i32.const 2624119) (i32.const 31))
      (call $opt_json_expect (i32.const 108) (i32.const 2624119) (i32.const 31)) (return)))
  (local.set $object (i32.eq (local.get $c) (i32.const 123)))
  (if (i32.eqz (i32.or (local.get $object) (i32.eq (local.get $c) (i32.const 91))))
    (then (call $opt_json_error (local.get $c) (i32.const 2624150) (i32.const 30))))
  (if (i32.ge_u (local.get $depth) (i32.const 128)) (then (call $fail (i32.const 12)) unreachable))
  (local.set $close (select (i32.const 125) (i32.const 93) (local.get $object)))
  (drop (call $opt_json_take))
  (call $json_space)
  (if (i32.eq (call $json_peek) (local.get $close)) (then (drop (call $opt_json_take)) (return)))
  (block $done
    (loop $member
      (if (local.get $object)
        (then
          (local.set $c (call $json_peek))
          (if (i32.ne (local.get $c) (i32.const 34))
            (then (call $opt_json_error (local.get $c) (i32.const 2624180) (i32.const 42))))
          (call $opt_json_string)
          (call $json_space)
          (call $opt_json_expect (i32.const 58) (i32.const 2624222) (i32.const 16))))
      (call $opt_json_value (i32.add (local.get $depth) (i32.const 1)))
      (call $json_space)
      (local.set $c (call $opt_json_take))
      (br_if $done (i32.eq (local.get $c) (local.get $close)))
      (if (i32.ne (local.get $c) (i32.const 44))
        (then
          (if (local.get $object)
            (then (call $opt_json_error (local.get $c) (i32.const 2624238) (i32.const 27)))
            (else (call $opt_json_error (local.get $c) (i32.const 2624265) (i32.const 19))))))
      (call $json_space)
      (br $member))))

(func $opt_json_one (param $p i32) (param $n i32) (result i32)
  (global.set $json_cursor (local.get $p))
  (global.set $json_end (i32.add (local.get $p) (local.get $n)))
  (call $opt_json_value (i32.const 0))
  (call $json_space)
  (global.get $json_cursor))

;; Read-only option names and diagnostics.
(data (i32.const 2621440) "\6f\75\74") ;; 'out'
(data (i32.const 2621443) "\72\75\6e\74\69\6d\65") ;; 'runtime'
(data (i32.const 2621450) "\64\72\69\76\65\72") ;; 'driver'
(data (i32.const 2621456) "\73\71\6c\69\74\65\5f\74\79\70\65\5f\6d\6f\64\65") ;; 'sqlite_type_mode'
(data (i32.const 2621472) "\6d\79\73\71\6c\32") ;; 'mysql2'
(data (i32.const 2621478) "\74\79\70\65\73\5f\6f\6e\6c\79") ;; 'types_only'
(data (i32.const 2621488) "\65\6d\69\74\5f\6e\75\6c\6c\5f\61\73\5f\75\6e\64\65\66\69\6e\65\64") ;; 'emit_null_as_undefined'
(data (i32.const 2621510) "\6f\70\74\69\6f\6e\61\6c\5f\6e\75\6c\6c\61\62\6c\65\5f\61\72\67\73") ;; 'optional_nullable_args'
(data (i32.const 2621532) "\65\6d\69\74\5f\71\75\65\72\79\5f\66\61\63\74\6f\72\79") ;; 'emit_query_factory'
(data (i32.const 2621550) "\65\6d\69\74\5f\73\71\6c\5f\61\73\5f\63\6f\6e\73\74") ;; 'emit_sql_as_const'
(data (i32.const 2621567) "\6f\76\65\72\72\69\64\65\73") ;; 'overrides'
(data (i32.const 2621576) "\74\79\70\65\5f\6d\61\70\70\69\6e\67\73") ;; 'type_mappings'
(data (i32.const 2621589) "\71\75\65\72\79\5f\6f\76\65\72\72\69\64\65\73") ;; 'query_overrides'
(data (i32.const 2621604) "\73\75\70\70\6f\72\74\5f\62\69\67\5f\6e\75\6d\62\65\72\73") ;; 'support_big_numbers'
(data (i32.const 2621623) "\62\69\67\5f\6e\75\6d\62\65\72\5f\73\74\72\69\6e\67\73") ;; 'big_number_strings'
(data (i32.const 2621641) "\69\6e\73\65\72\74\5f\69\64\5f\75\6e\73\69\67\6e\65\64") ;; 'insert_id_unsigned'
(data (i32.const 2621659) "\70\61\74\68") ;; 'path'
(data (i32.const 2621663) "\6e\61\6d\65") ;; 'name'
(data (i32.const 2621667) "\74\73\5f\74\79\70\65") ;; 'ts_type'
(data (i32.const 2621674) "\70\72\65\73\65\74") ;; 'preset'
(data (i32.const 2621680) "\69\6d\70\6f\72\74") ;; 'import'
(data (i32.const 2621686) "\63\6f\64\65\63") ;; 'codec'
(data (i32.const 2621691) "\63\6f\6c\75\6d\6e") ;; 'column'
(data (i32.const 2621697) "\6d\61\70\70\69\6e\67") ;; 'mapping'
(data (i32.const 2621704) "\63\6f\6c\75\6d\6e\73") ;; 'columns'
(data (i32.const 2621711) "\64\62\5f\74\79\70\65") ;; 'db_type'
(data (i32.const 2621718) "\6e\75\6c\6c\61\62\6c\65") ;; 'nullable'
(data (i32.const 2621726) "\6e\75\6c\6c\61\62\6c\65\5f\61\6c\6c") ;; 'nullable_all'
(data (i32.const 2621738) "\71\75\65\72\79") ;; 'query'
(data (i32.const 2621743) "\70\61\72\61\6d\65\74\65\72") ;; 'parameter'
(data (i32.const 2621752) "\4f\70\74\69\6f\6e\73") ;; 'Options'
(data (i32.const 2621759) "\4d\79\53\51\4c\32\4f\70\74\69\6f\6e\73") ;; 'MySQL2Options'
(data (i32.const 2621772) "\4f\76\65\72\72\69\64\65") ;; 'Override'
(data (i32.const 2621780) "\54\79\70\65\4d\61\70\70\69\6e\67") ;; 'TypeMapping'
(data (i32.const 2621791) "\51\75\65\72\79\4f\76\65\72\72\69\64\65") ;; 'QueryOverride'
(data (i32.const 2621804) "\49\6d\70\6f\72\74") ;; 'Import'
(data (i32.const 2621810) "\74\79\70\65\73\63\72\69\70\74\20\6f\70\74\69\6f\6e\73\3a\20\6a\73\6f\6e\3a\20\63\61\6e\6e\6f\74\20\75\6e\6d\61\72\73\68\61\6c\20") ;; 'typescript options: json: cannot unmarshal '
(data (i32.const 2621853) "\6f\62\6a\65\63\74") ;; 'object'
(data (i32.const 2621859) "\61\72\72\61\79") ;; 'array'
(data (i32.const 2621864) "\73\74\72\69\6e\67") ;; 'string'
(data (i32.const 2621870) "\6e\75\6d\62\65\72") ;; 'number'
(data (i32.const 2621876) "\62\6f\6f\6c") ;; 'bool'
(data (i32.const 2621880) "\20\69\6e\74\6f\20\47\6f\20\73\74\72\75\63\74\20\66\69\65\6c\64\20") ;; ' into Go struct field '
(data (i32.const 2621902) "\2e") ;; '.'
(data (i32.const 2621903) "\20\69\6e\74\6f\20\47\6f\20\76\61\6c\75\65") ;; ' into Go value'
(data (i32.const 2621917) "\20\6f\66\20\74\79\70\65\20") ;; ' of type '
(data (i32.const 2621926) "\6f\70\74\73\2e") ;; 'opts.'
(data (i32.const 2621931) "\74\79\70\65\73\63\72\69\70\74\20\6f\70\74\69\6f\6e\73\3a\20") ;; 'typescript options: '
(data (i32.const 2621951) "\6a\73\6f\6e\3a\20\75\6e\6b\6e\6f\77\6e\20\66\69\65\6c\64\20") ;; 'json: unknown field '
(data (i32.const 2621971) "\6d\61\70\5b\73\74\72\69\6e\67\5d\6f\70\74\73\2e\54\79\70\65\4d\61\70\70\69\6e\67") ;; 'map[string]opts.TypeMapping'
(data (i32.const 2621998) "\5b\5d\6f\70\74\73\2e\4f\76\65\72\72\69\64\65") ;; '[]opts.Override'
(data (i32.const 2622013) "\5b\5d\6f\70\74\73\2e\51\75\65\72\79\4f\76\65\72\72\69\64\65") ;; '[]opts.QueryOverride'
(data (i32.const 2622033) "\5b\5d\73\74\72\69\6e\67") ;; '[]string'
(data (i32.const 2622041) "\6e\70\6d\3a") ;; 'npm:'
(data (i32.const 2622045) "\6a\73\72\3a") ;; 'jsr:'
(data (i32.const 2622049) "\2f\70\72\6f\6d\69\73\65") ;; '/promise'
(data (i32.const 2622057) "\70\67") ;; 'pg'
(data (i32.const 2622059) "\70\6f\73\74\67\72\65\73") ;; 'postgres'
(data (i32.const 2622067) "\62\65\74\74\65\72\2d\73\71\6c\69\74\65\33") ;; 'better-sqlite3'
(data (i32.const 2622081) "\40\62\6f\6e\61\6b\6f\64\6f\2f\73\71\6c\69\74\65") ;; '@bonakodo/sqlite'
(data (i32.const 2622097) "\75\6e\73\75\70\70\6f\72\74\65\64\20\64\72\69\76\65\72\20") ;; 'unsupported driver '
(data (i32.const 2622116) "\64\72\69\76\65\72\20\76\65\72\73\69\6f\6e\20\73\65\6c\65\63\74\6f\72\73\20\72\65\71\75\69\72\65\20\72\75\6e\74\69\6d\65\3a\20\64\65\6e\6f\3b\20\70\69\6e\20\74\68\65\20\70\61\63\6b\61\67\65\20\69\6e\20\70\61\63\6b\61\67\65\2e\6a\73\6f\6e\20\66\6f\72\20\62\75\6e") ;; 'driver version selectors require runtime: deno; pin the package in package.json for bun'
(data (i32.const 2622203) "\64\72\69\76\65\72\20\76\65\72\73\69\6f\6e\20\73\65\6c\65\63\74\6f\72\73\20\72\65\71\75\69\72\65\20\72\75\6e\74\69\6d\65\3a\20\64\65\6e\6f\3b\20\70\69\6e\20\74\68\65\20\70\61\63\6b\61\67\65\20\69\6e\20\70\61\63\6b\61\67\65\2e\6a\73\6f\6e\20\66\6f\72\20\6e\6f\64\65") ;; 'driver version selectors require runtime: deno; pin the package in package.json for node'
(data (i32.const 2622291) "\40\62\6f\6e\61\6b\6f\64\6f\2f\73\71\6c\69\74\65\20\72\65\71\75\69\72\65\73\20\72\75\6e\74\69\6d\65\3a\20\64\65\6e\6f") ;; '@bonakodo/sqlite requires runtime: deno'
(data (i32.const 2622330) "\6d\79\73\71\6c\32\2f\70\72\6f\6d\69\73\65") ;; 'mysql2/promise'
(data (i32.const 2622344) "\6d\61\70\70\69\6e\67\20\63\61\6e\6e\6f\74\20\63\6f\6d\62\69\6e\65\20\77\69\74\68\20\74\73\5f\74\79\70\65\2c\20\69\6d\70\6f\72\74\2c\20\63\6f\64\65\63\2c\20\6f\72\20\70\72\65\73\65\74") ;; 'mapping cannot combine with ts_type, import, codec, or preset'
(data (i32.const 2622405) "\75\6e\6b\6e\6f\77\6e\20\74\79\70\65\20\6d\61\70\70\69\6e\67\20") ;; 'unknown type mapping '
(data (i32.const 2622426) "\62\69\67\69\6e\74") ;; 'bigint'
(data (i32.const 2622432) "\62\6f\6f\6c\65\61\6e") ;; 'boolean'
(data (i32.const 2622439) "\44\61\74\65") ;; 'Date'
(data (i32.const 2622443) "\55\69\6e\74\38\41\72\72\61\79") ;; 'Uint8Array'
(data (i32.const 2622453) "\42\75\66\66\65\72") ;; 'Buffer'
(data (i32.const 2622459) "\75\6e\6b\6e\6f\77\6e") ;; 'unknown'
(data (i32.const 2622466) "\61\6e\79") ;; 'any'
(data (i32.const 2622469) "\6e\75\6c\6c") ;; 'null'
(data (i32.const 2622473) "\75\6e\64\65\66\69\6e\65\64") ;; 'undefined'
(data (i32.const 2622482) "\73\79\6d\62\6f\6c") ;; 'symbol'
(data (i32.const 2622488) "\76\6f\69\64") ;; 'void'
(data (i32.const 2622492) "\73\61\66\65\5f\69\6e\74\65\67\65\72") ;; 'safe_integer'
(data (i32.const 2622504) "\65\70\6f\63\68\5f\6d\69\6c\6c\69\73\65\63\6f\6e\64\73") ;; 'epoch_milliseconds'
(data (i32.const 2622522) "\73\71\6c\69\74\65\5f\62\6f\6f\6c\65\61\6e") ;; 'sqlite_boolean'
(data (i32.const 2622536) "\6a\73\6f\6e\5f\74\65\78\74") ;; 'json_text'
(data (i32.const 2622545) "\75\6e\6b\6e\6f\77\6e\20\63\6f\64\65\63\20\70\72\65\73\65\74\20") ;; 'unknown codec preset '
(data (i32.const 2622566) "\70\72\65\73\65\74\20") ;; 'preset '
(data (i32.const 2622573) "\20\72\65\71\75\69\72\65\73\20\74\73\5f\74\79\70\65\20\74\6f\20\72\65\66\69\6e\65\20") ;; ' requires ts_type to refine '
(data (i32.const 2622601) "\2c\20\72\65\63\65\69\76\65\64\20") ;; ', received '
(data (i32.const 2622612) "\70\72\65\73\65\74\20\63\61\6e\6e\6f\74\20\63\6f\6d\62\69\6e\65\20\77\69\74\68\20\63\6f\64\65\63") ;; 'preset cannot combine with codec'
(data (i32.const 2622644) "\63\6f\64\65\63\20\70\72\65\73\65\74\73\20\72\65\71\75\69\72\65\20\61\20\53\51\4c\69\74\65\20\64\72\69\76\65\72") ;; 'codec presets require a SQLite driver'
(data (i32.const 2622681) "\63\6f\64\65\63\20\70\72\65\73\65\74\73\20\72\65\71\75\69\72\65\20\73\71\6c\69\74\65\5f\74\79\70\65\5f\6d\6f\64\65\3a\20\6e\61\74\69\76\65") ;; 'codec presets require sqlite_type_mode: native'
(data (i32.const 2622727) "\72\65\71\75\69\72\65\73\20\74\73\5f\74\79\70\65\20\6f\72\20\70\72\65\73\65\74") ;; 'requires ts_type or preset'
(data (i32.const 2622753) "\69\6d\70\6f\72\74\20\72\65\71\75\69\72\65\73\20\74\73\5f\74\79\70\65") ;; 'import requires ts_type'
(data (i32.const 2622776) "\69\6d\70\6f\72\74\20\72\65\71\75\69\72\65\73\20\70\61\74\68\20\61\6e\64\20\6e\61\6d\65") ;; 'import requires path and name'
(data (i32.const 2622805) "\63\6f\64\65\63\20\72\65\71\75\69\72\65\73\20\70\61\74\68\20\61\6e\64\20\6e\61\6d\65") ;; 'codec requires path and name'
(data (i32.const 2622833) "\63\6f\6c\75\6d\6e\20\6d\75\73\74\20\68\61\76\65\20\74\77\6f\20\74\6f\20\66\6f\75\72\20\64\6f\74\2d\73\65\70\61\72\61\74\65\64\20\70\61\72\74\73") ;; 'column must have two to four dot-separated parts'
(data (i32.const 2622881) "\63\6f\6c\75\6d\6e\20\63\6f\6e\74\61\69\6e\73\20\61\6e\20\65\6d\70\74\79\20\6e\61\6d\65") ;; 'column contains an empty name'
(data (i32.const 2622910) "\63\6f\6c\75\6d\6e\20\70\61\74\74\65\72\6e\3a\20\55\6e\74\65\72\6d\69\6e\61\74\65\64\20\65\73\63\61\70\65\20\61\74\20\65\6e\64\20\6f\66\20\70\61\74\74\65\72\6e") ;; 'column pattern: Unterminated escape at end of pattern'
(data (i32.const 2622963) "\63\6f\6c\75\6d\6e\20\70\61\74\74\65\72\6e\3a\20\49\6e\76\61\6c\69\64\20\65\73\63\61\70\65\64\20\63\68\61\72\61\63\74\65\72\20\27") ;; "column pattern: Invalid escaped character '"
(data (i32.const 2623006) "\27") ;; "'"
(data (i32.const 2623007) "\74\79\70\65\73\63\72\69\70\74\3a\20") ;; 'typescript: '
(data (i32.const 2623019) "\74\79\70\65\20\6d\61\70\70\69\6e\67\20\6e\61\6d\65\20\6d\75\73\74\20\62\65\20\6e\6f\6e\2d\65\6d\70\74\79\20\61\6e\64\20\68\61\76\65\20\6e\6f\20\73\75\72\72\6f\75\6e\64\69\6e\67\20\77\68\69\74\65\73\70\61\63\65") ;; 'type mapping name must be non-empty and have no surrounding whitespace'
(data (i32.const 2623089) "\74\79\70\65\73\63\72\69\70\74\3a\20\74\79\70\65\20\6d\61\70\70\69\6e\67\20") ;; 'typescript: type mapping '
(data (i32.const 2623114) "\3a\20") ;; ': '
(data (i32.const 2623116) "\74\79\70\65\73\63\72\69\70\74\3a\20\71\75\65\72\79\20\6f\76\65\72\72\69\64\65\20") ;; 'typescript: query override '
(data (i32.const 2623143) "\74\79\70\65\73\63\72\69\70\74\3a\20\6f\76\65\72\72\69\64\65\20") ;; 'typescript: override '
(data (i32.const 2623164) "\20") ;; ' '
(data (i32.const 2623165) "\72\65\71\75\69\72\65\73\20\71\75\65\72\79") ;; 'requires query'
(data (i32.const 2623179) "\6d\75\73\74\20\73\70\65\63\69\66\79\20\65\78\61\63\74\6c\79\20\6f\6e\65\20\6f\66\20\70\61\72\61\6d\65\74\65\72\20\6f\72\20\63\6f\6c\75\6d\6e") ;; 'must specify exactly one of parameter or column'
(data (i32.const 2623226) "\6d\75\73\74\20\73\70\65\63\69\66\79\20\65\78\61\63\74\6c\79\20\6f\6e\65\20\6f\66\20\63\6f\6c\75\6d\6e\2c\20\63\6f\6c\75\6d\6e\73\2c\20\6f\72\20\64\62\5f\74\79\70\65") ;; 'must specify exactly one of column, columns, or db_type'
(data (i32.const 2623281) "\6e\75\6c\6c\61\62\6c\65\5f\61\6c\6c\20\72\65\71\75\69\72\65\73\20\64\62\5f\74\79\70\65\20\61\6e\64\20\63\61\6e\6e\6f\74\20\63\6f\6d\62\69\6e\65\20\77\69\74\68\20\6e\75\6c\6c\61\62\6c\65\3a\20\74\72\75\65") ;; 'nullable_all requires db_type and cannot combine with nullable: true'
(data (i32.const 2623349) "\74\79\70\65\73\63\72\69\70\74\20\6f\70\74\69\6f\6e\73\3a\20\65\78\70\65\63\74\65\64\20\6f\6e\65\20\4a\53\4f\4e\20\6f\62\6a\65\63\74") ;; 'typescript options: expected one JSON object'
(data (i32.const 2623393) "\64\72\69\76\65\72\20\69\73\20\72\65\71\75\69\72\65\64\3b\20\75\73\65\20\70\67\2c\20\70\6f\73\74\67\72\65\73\2c\20\6d\79\73\71\6c\32\2c\20\62\65\74\74\65\72\2d\73\71\6c\69\74\65\33\2c\20\6f\72\20\40\62\6f\6e\61\6b\6f\64\6f\2f\73\71\6c\69\74\65") ;; 'driver is required; use pg, postgres, mysql2, better-sqlite3, or @bonakodo/sqlite'
(data (i32.const 2623474) "\6e\61\74\69\76\65") ;; 'native'
(data (i32.const 2623480) "\75\6e\73\75\70\70\6f\72\74\65\64\20\73\71\6c\69\74\65\5f\74\79\70\65\5f\6d\6f\64\65\20") ;; 'unsupported sqlite_type_mode '
(data (i32.const 2623509) "\3b\20\75\73\65\20\64\72\69\76\65\72\20\6f\72\20\6e\61\74\69\76\65") ;; '; use driver or native'
(data (i32.const 2623531) "\6e\6f\64\65") ;; 'node'
(data (i32.const 2623535) "\62\75\6e") ;; 'bun'
(data (i32.const 2623538) "\64\65\6e\6f") ;; 'deno'
(data (i32.const 2623542) "\75\6e\73\75\70\70\6f\72\74\65\64\20\72\75\6e\74\69\6d\65\20") ;; 'unsupported runtime '
(data (i32.const 2623562) "\3b\20\75\73\65\20\6e\6f\64\65\2c\20\62\75\6e\2c\20\6f\72\20\64\65\6e\6f") ;; '; use node, bun, or deno'
(data (i32.const 2623586) "\70\6f\73\74\67\72\65\73\71\6c") ;; 'postgresql'
(data (i32.const 2623596) "\6d\79\73\71\6c") ;; 'mysql'
(data (i32.const 2623601) "\73\71\6c\69\74\65") ;; 'sqlite'
(data (i32.const 2623607) "\20\72\65\71\75\69\72\65\73\20\65\6e\67\69\6e\65\3a\20") ;; ' requires engine: '
(data (i32.const 2623625) "\20\28\72\65\63\65\69\76\65\64\20") ;; ' (received '
(data (i32.const 2623636) "\29") ;; ')'
(data (i32.const 2623637) "\74\79\70\65\73\63\72\69\70\74\20\6f\70\74\69\6f\6e\73\3a\20\75\6e\65\78\70\65\63\74\65\64\20\45\4f\46") ;; 'typescript options: unexpected EOF'
(data (i32.const 2623671) "\74\79\70\65\73\63\72\69\70\74\20\6f\70\74\69\6f\6e\73\3a\20\69\6e\76\61\6c\69\64\20\63\68\61\72\61\63\74\65\72\20") ;; 'typescript options: invalid character '
(data (i32.const 2623709) "\69\6e\20\73\74\72\69\6e\67\20\6c\69\74\65\72\61\6c") ;; 'in string literal'
(data (i32.const 2623726) "\69\6e\20\73\74\72\69\6e\67\20\65\73\63\61\70\65\20\63\6f\64\65") ;; 'in string escape code'
(data (i32.const 2623747) "\69\6e\20\5c\75\20\68\65\78\61\64\65\63\69\6d\61\6c\20\63\68\61\72\61\63\74\65\72\20\65\73\63\61\70\65") ;; 'in \\u hexadecimal character escape'
(data (i32.const 2623781) "\69\6e\20\6e\75\6d\65\72\69\63\20\6c\69\74\65\72\61\6c") ;; 'in numeric literal'
(data (i32.const 2623799) "\61\66\74\65\72\20\64\65\63\69\6d\61\6c\20\70\6f\69\6e\74\20\69\6e\20\6e\75\6d\65\72\69\63\20\6c\69\74\65\72\61\6c") ;; 'after decimal point in numeric literal'
(data (i32.const 2623837) "\69\6e\20\65\78\70\6f\6e\65\6e\74\20\6f\66\20\6e\75\6d\65\72\69\63\20\6c\69\74\65\72\61\6c") ;; 'in exponent of numeric literal'
(data (i32.const 2623867) "\69\6e\20\6c\69\74\65\72\61\6c\20\74\72\75\65\20\28\65\78\70\65\63\74\69\6e\67\20\27\72\27\29") ;; "in literal true (expecting 'r')"
(data (i32.const 2623898) "\69\6e\20\6c\69\74\65\72\61\6c\20\74\72\75\65\20\28\65\78\70\65\63\74\69\6e\67\20\27\75\27\29") ;; "in literal true (expecting 'u')"
(data (i32.const 2623929) "\69\6e\20\6c\69\74\65\72\61\6c\20\74\72\75\65\20\28\65\78\70\65\63\74\69\6e\67\20\27\65\27\29") ;; "in literal true (expecting 'e')"
(data (i32.const 2623960) "\69\6e\20\6c\69\74\65\72\61\6c\20\66\61\6c\73\65\20\28\65\78\70\65\63\74\69\6e\67\20\27\61\27\29") ;; "in literal false (expecting 'a')"
(data (i32.const 2623992) "\69\6e\20\6c\69\74\65\72\61\6c\20\66\61\6c\73\65\20\28\65\78\70\65\63\74\69\6e\67\20\27\6c\27\29") ;; "in literal false (expecting 'l')"
(data (i32.const 2624024) "\69\6e\20\6c\69\74\65\72\61\6c\20\66\61\6c\73\65\20\28\65\78\70\65\63\74\69\6e\67\20\27\73\27\29") ;; "in literal false (expecting 's')"
(data (i32.const 2624056) "\69\6e\20\6c\69\74\65\72\61\6c\20\66\61\6c\73\65\20\28\65\78\70\65\63\74\69\6e\67\20\27\65\27\29") ;; "in literal false (expecting 'e')"
(data (i32.const 2624088) "\69\6e\20\6c\69\74\65\72\61\6c\20\6e\75\6c\6c\20\28\65\78\70\65\63\74\69\6e\67\20\27\75\27\29") ;; "in literal null (expecting 'u')"
(data (i32.const 2624119) "\69\6e\20\6c\69\74\65\72\61\6c\20\6e\75\6c\6c\20\28\65\78\70\65\63\74\69\6e\67\20\27\6c\27\29") ;; "in literal null (expecting 'l')"
(data (i32.const 2624150) "\6c\6f\6f\6b\69\6e\67\20\66\6f\72\20\62\65\67\69\6e\6e\69\6e\67\20\6f\66\20\76\61\6c\75\65") ;; 'looking for beginning of value'
(data (i32.const 2624180) "\6c\6f\6f\6b\69\6e\67\20\66\6f\72\20\62\65\67\69\6e\6e\69\6e\67\20\6f\66\20\6f\62\6a\65\63\74\20\6b\65\79\20\73\74\72\69\6e\67") ;; 'looking for beginning of object key string'
(data (i32.const 2624222) "\61\66\74\65\72\20\6f\62\6a\65\63\74\20\6b\65\79") ;; 'after object key'
(data (i32.const 2624238) "\61\66\74\65\72\20\6f\62\6a\65\63\74\20\6b\65\79\3a\76\61\6c\75\65\20\70\61\69\72") ;; 'after object key:value pair'
(data (i32.const 2624265) "\61\66\74\65\72\20\61\72\72\61\79\20\65\6c\65\6d\65\6e\74") ;; 'after array element'
