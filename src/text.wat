;; Hand-written text, Unicode, identifier, and naming routines.
;;
;; Every result is a (pointer,length) pair. A routine may return an input view
;; when no bytes need changing. Other results occupy the fixed text region
;; 20971520..29360128. This is a caller-owned byte buffer, not a Go heap: there
;; are no objects to trace, individual frees, or requests to grow memory.
;;
;; text_mark/text_reset delimit temporary work. A caller must keep a mark until
;; all views made after it are dead. Registered names explicitly retain their
;; bytes in the fixed lifetime-long name region before returning. Bounds are checked before
;; every append, so exhaustion is a reported failure rather than data damage.
;; Unicode DATA lives in unicode.wat; all algorithms here are written in WAT.
(global $txt_cursor (mut i32) (i32.const 20971520))
(global $retain_cursor (mut i32) (i32.const 29376512))
(global $name_cursor (mut i32) (i32.const 32768))
(global $name_scope_id (mut i32) (i32.const 0))

;; Literal slots are kept below2162688, separate from Unicode range records.
(data (i32.const 2097152) "0123456789ABCDEF")
(data (i32.const 2097184) "Query")
(data (i32.const 2097216) "__proto__")
(data (i32.const 2097232) "0123456789abcdef")
(data (i32.const 2097248) "await\00break\00case\00catch\00class\00const\00continue\00debugger\00default\00delete\00do\00else\00enum\00export\00extends\00false\00finally\00for\00function\00if\00implements\00import\00in\00instanceof\00interface\00let\00new\00null\00package\00private\00protected\00public\00return\00static\00super\00switch\00this\00throw\00true\00try\00typeof\00var\00void\00while\00with\00yield\00eval\00arguments\00\00")
(data (i32.const 2098176) "abstract\00arguments\00as\00asserts\00async\00await\00boolean\00break\00case\00catch\00class\00const\00constructor\00continue\00debugger\00declare\00default\00delete\00do\00else\00enum\00eval\00export\00extends\00false\00finally\00for\00from\00function\00get\00global\00if\00implements\00import\00in\00infer\00instanceof\00interface\00intrinsic\00is\00keyof\00let\00module\00namespace\00never\00new\00null\00number\00object\00of\00out\00override\00package\00private\00protected\00public\00readonly\00require\00return\00satisfies\00set\00static\00string\00super\00switch\00symbol\00this\00throw\00true\00try\00type\00typeof\00undefined\00unique\00unknown\00using\00var\00void\00while\00with\00yield\00any\00bigint\00Array\00BigInt\00Boolean\00Database\00Date\00Error\00JSON\00Map\00Number\00Object\00Promise\00RangeError\00ReadonlyArray\00Record\00Set\00String\00Symbol\00TextDecoder\00TextEncoder\00TypeError\00Uint8Array\00\00")

(func $text_mark (result i32) (global.get $txt_cursor))
(func $text_reset (param $mark i32)
  (if (i32.or (i32.lt_u (local.get $mark) (i32.const 20971520))
    (i32.gt_u (local.get $mark) (global.get $txt_cursor)))
    (then (call $fail (i32.const 10))))
  (global.set $txt_cursor (local.get $mark)))

;; Append checks both source bounds and destination room before memory.copy.
;; Wasm memory.copy has memmove overlap semantics, useful for caller-managed
;; compaction. The source must remain valid until this call finishes.
(func $text_append (param $p i32) (param $n i32)
  (if (i32.gt_u (local.get $p) (i32.const 67108864)) (then (call $fail (i32.const 10))))
  (if (i32.gt_u (local.get $n) (i32.sub (i32.const 67108864) (local.get $p)))
    (then (call $fail (i32.const 10))))
  (if (i32.gt_u (local.get $n) (i32.sub (i32.const 29360128) (global.get $txt_cursor)))
    (then (call $fail (i32.const 10))))
  (memory.copy (global.get $txt_cursor) (local.get $p) (local.get $n))
  (global.set $txt_cursor (i32.add (global.get $txt_cursor) (local.get $n))))
(func $text_byte (param $b i32)
  (if (i32.ge_u (global.get $txt_cursor) (i32.const 29360128))
    (then (call $fail (i32.const 10))))
  (i32.store8 (global.get $txt_cursor) (local.get $b))
  (global.set $txt_cursor (i32.add (global.get $txt_cursor) (i32.const 1))))
(func $text_copy (param $p i32) (param $n i32) (result i32 i32)
  (local $start i32)
  (local.set $start (global.get $txt_cursor))
  (call $text_append (local.get $p) (local.get $n))
  (local.get $start) (local.get $n))

;; A generated name or import can outlive the current text scratch mark.
;; Keep only such explicitly registered strings in 29376512..31457280.
;; Input, static literals and already-retained text have request-long lives,
;; so those spans remain views. This is a fixed append-only byte region with
;; one request-wide lifetime; it has no object headers, free list or tracing.
(func $retain_text (param $p i32) (param $n i32) (result i32 i32)
  (local $saved i32)
  (if (i32.or (i32.lt_u (local.get $p) (i32.const 20971520))
               (i32.ge_u (local.get $p) (i32.const 29360128)))
    (then (return (local.get $p) (local.get $n))))
  (if (i32.gt_u (local.get $n) (i32.sub (i32.const 29360128) (local.get $p)))
    (then (call $fail (i32.const 10))))
  (if (i32.gt_u (local.get $n) (i32.sub (i32.const 31457280) (global.get $retain_cursor)))
    (then (call $fail (i32.const 10))))
  (local.set $saved (global.get $retain_cursor))
  (memory.copy (local.get $saved) (local.get $p) (local.get $n))
  (global.set $retain_cursor (i32.add (local.get $saved) (local.get $n)))
  (local.get $saved) (local.get $n))
(func $concat (param $p i32) (param $n i32) (param $q i32) (param $m i32) (result i32 i32)
  (local $start i32)
  (local.set $start (global.get $txt_cursor))
  (call $text_append (local.get $p) (local.get $n))
  (call $text_append (local.get $q) (local.get $m))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))

;; Byte comparison matches Go string ordering, including non-ASCII UTF-8.
(func $compare (param $p i32) (param $n i32) (param $q i32) (param $m i32) (result i32)
  (local $i i32) (local $a i32) (local $b i32)
  (block $done (loop $loop
    (br_if $done (i32.or (i32.eq (local.get $i) (local.get $n)) (i32.eq (local.get $i) (local.get $m))))
    (local.set $a (i32.load8_u (i32.add (local.get $p) (local.get $i))))
    (local.set $b (i32.load8_u (i32.add (local.get $q) (local.get $i))))
    (if (i32.lt_u (local.get $a) (local.get $b)) (then (return (i32.const -1))))
    (if (i32.gt_u (local.get $a) (local.get $b)) (then (return (i32.const 1))))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $loop)))
  (if (i32.lt_u (local.get $n) (local.get $m)) (then (return (i32.const -1))))
  (i32.gt_u (local.get $n) (local.get $m)))
(func $eq (param $p i32) (param $n i32) (param $q i32) (param $m i32) (result i32)
  (if (i32.ne (local.get $n) (local.get $m)) (then (return (i32.const 0))))
  (i32.eqz (call $compare (local.get $p) (local.get $n) (local.get $q) (local.get $m))))

;; Decode exactly one rune, matching utf8.DecodeRuneInString. Invalid input
;; consumes one byte and returns U+FFFD; empty input consumes zero. This differs
;; from core.utf8, which validates protobuf string fields and fails on errors.
(func $rune (param $p i32) (param $end i32) (result i32 i32)
  (local $b i32) (local $r i32) (local $size i32) (local $i i32) (local $min i32)
  (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (local.get $p) (i32.const 65533))))
  (local.set $b (i32.load8_u (local.get $p)))
  (if (i32.lt_u (local.get $b) (i32.const 128))
    (then (return (i32.add (local.get $p) (i32.const 1)) (local.get $b))))
  (block $invalid
    (if (i32.and (i32.ge_u (local.get $b) (i32.const 194)) (i32.le_u (local.get $b) (i32.const 223)))
      (then (local.set $size (i32.const 2)) (local.set $r (i32.and (local.get $b) (i32.const 31))) (local.set $min (i32.const 128)))
      (else (if (i32.and (i32.ge_u (local.get $b) (i32.const 224)) (i32.le_u (local.get $b) (i32.const 239)))
        (then (local.set $size (i32.const 3)) (local.set $r (i32.and (local.get $b) (i32.const 15))) (local.set $min (i32.const 2048)))
        (else (if (i32.and (i32.ge_u (local.get $b) (i32.const 240)) (i32.le_u (local.get $b) (i32.const 244)))
          (then (local.set $size (i32.const 4)) (local.set $r (i32.and (local.get $b) (i32.const 7))) (local.set $min (i32.const 65536)))
          (else (br $invalid)))))))
    (br_if $invalid (i32.gt_u (local.get $size) (i32.sub (local.get $end) (local.get $p))))
    (local.set $i (i32.const 1))
    (loop $more
      (local.set $b (i32.load8_u (i32.add (local.get $p) (local.get $i))))
      (br_if $invalid (i32.ne (i32.and (local.get $b) (i32.const 192)) (i32.const 128)))
      (local.set $r (i32.or (i32.shl (local.get $r) (i32.const 6)) (i32.and (local.get $b) (i32.const 63))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $more (i32.lt_u (local.get $i) (local.get $size))))
    (br_if $invalid (i32.or (i32.lt_u (local.get $r) (local.get $min)) (i32.gt_u (local.get $r) (i32.const 1114111))))
    (br_if $invalid (i32.and (i32.ge_u (local.get $r) (i32.const 55296)) (i32.le_u (local.get $r) (i32.const 57343))))
    (return (i32.add (local.get $p) (local.get $size)) (local.get $r)))
  (i32.add (local.get $p) (i32.const 1)) (i32.const 65533))

;; Binary search compact, disjoint Unicode property ranges. The Go-derived
;; table preserves this project's Unicode15.0 rules, including Other_ID_*.
(func $unicode_flags (param $r i32) (result i32)
  (local $lo i32) (local $hi i32) (local $mid i32) (local $rec i32)
  (local.set $hi (global.get $unicode_class_count))
  (block $done (loop $loop
    (br_if $done (i32.ge_u (local.get $lo) (local.get $hi)))
    (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
    (local.set $rec (i32.add (global.get $unicode_class_base) (i32.mul (local.get $mid) (i32.const 12))))
    (if (i32.lt_u (local.get $r) (i32.load (local.get $rec)))
      (then (local.set $hi (local.get $mid)))
      (else (if (i32.gt_u (local.get $r) (i32.load offset=4 (local.get $rec)))
        (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
        (else (return (i32.load offset=8 (local.get $rec)))))))
    (br $loop)))
  (i32.const 0))
(func $unicode_case (param $r i32) (param $lower i32) (result i32)
  (local $lo i32) (local $hi i32) (local $mid i32) (local $rec i32) (local $delta i32)
  (local.set $hi (global.get $unicode_case_count))
  (block $done (loop $loop
    (br_if $done (i32.ge_u (local.get $lo) (local.get $hi)))
    (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
    (local.set $rec (i32.add (global.get $unicode_case_base) (i32.shl (local.get $mid) (i32.const 4))))
    (if (i32.lt_u (local.get $r) (i32.load (local.get $rec)))
      (then (local.set $hi (local.get $mid)))
      (else (if (i32.gt_u (local.get $r) (i32.load offset=4 (local.get $rec)))
        (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
        (else
          (local.set $delta (i32.load (i32.add (local.get $rec) (i32.add (i32.const 8) (i32.shl (local.get $lower) (i32.const 2))))))
          (if (i32.eq (local.get $delta) (i32.const 1114112))
            (then (return (i32.add (i32.load (local.get $rec))
              (i32.or (i32.and (i32.sub (local.get $r) (i32.load (local.get $rec))) (i32.const -2)) (local.get $lower))))))
          (return (i32.add (local.get $r) (local.get $delta)))))))
    (br $loop)))
  (local.get $r))

;; SimpleFold cycles through Unicode's one-rune case equivalence class. Most
;; scalars use only upper/lower conversion; the small special table handles
;; sigma, long s, Kelvin, titlecase digraphs, and excluded Turkish-I mappings.
(func $unicode_fold (param $r i32) (result i32)
  (local $lo i32) (local $hi i32) (local $mid i32) (local $rec i32) (local $lower i32)
  (if (i32.gt_u (local.get $r) (i32.const 1114111)) (then (return (local.get $r))))
  (local.set $hi (global.get $unicode_fold_count))
  (block $ordinary (loop $search
    (br_if $ordinary (i32.ge_u (local.get $lo) (local.get $hi)))
    (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
    (local.set $rec (i32.add (global.get $unicode_fold_base) (i32.shl (local.get $mid) (i32.const 3))))
    (if (i32.lt_u (local.get $r) (i32.load (local.get $rec)))
      (then (local.set $hi (local.get $mid)))
      (else (if (i32.gt_u (local.get $r) (i32.load (local.get $rec)))
        (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
        (else (return (i32.load offset=4 (local.get $rec)))))))
    (br $search)))
  (local.set $lower (call $unicode_case (local.get $r) (i32.const 1)))
  (if (i32.ne (local.get $lower) (local.get $r)) (then (return (local.get $lower))))
  (call $unicode_case (local.get $r) (i32.const 0)))
(func $equal_fold (param $p i32) (param $n i32) (param $q i32) (param $m i32) (result i32)
  (local $end i32) (local $endq i32) (local $r i32) (local $s i32) (local $folded i32)
  (local.set $end (i32.add (local.get $p) (local.get $n))) (local.set $endq (i32.add (local.get $q) (local.get $m)))
  (block $done (loop $rune
    (br_if $done (i32.or (i32.eq (local.get $p) (local.get $end)) (i32.eq (local.get $q) (local.get $endq))))
    (call $rune (local.get $p) (local.get $end)) local.set $r local.set $p
    (call $rune (local.get $q) (local.get $endq)) local.set $s local.set $q
    (if (i32.ne (local.get $r) (local.get $s))
      (then
        (local.set $folded (call $unicode_fold (local.get $r)))
        (block $matched (loop $orbit
          (br_if $matched (i32.eq (local.get $folded) (local.get $s)))
          (if (i32.eq (local.get $folded) (local.get $r)) (then (return (i32.const 0))))
          (local.set $folded (call $unicode_fold (local.get $folded))) (br $orbit)))))
    (br $rune)))
  (i32.and (i32.eq (local.get $p) (local.get $end)) (i32.eq (local.get $q) (local.get $endq))))

;; Write one scalar as UTF-8 directly into the shared text buffer.
(func $put_rune (param $r i32)
  (if (i32.lt_u (local.get $r) (i32.const 128))
    (then (call $text_byte (local.get $r)) (return)))
  (if (i32.lt_u (local.get $r) (i32.const 2048))
    (then
      (call $text_byte (i32.or (i32.const 192) (i32.shr_u (local.get $r) (i32.const 6))))
      (call $text_byte (i32.or (i32.const 128) (i32.and (local.get $r) (i32.const 63)))) (return)))
  (if (i32.lt_u (local.get $r) (i32.const 65536))
    (then (call $text_byte (i32.or (i32.const 224) (i32.shr_u (local.get $r) (i32.const 12)))))
    (else
      (call $text_byte (i32.or (i32.const 240) (i32.shr_u (local.get $r) (i32.const 18))))
      (call $text_byte (i32.or (i32.const 128) (i32.and (i32.shr_u (local.get $r) (i32.const 12)) (i32.const 63))))))
  (call $text_byte (i32.or (i32.const 128) (i32.and (i32.shr_u (local.get $r) (i32.const 6)) (i32.const 63))))
  (call $text_byte (i32.or (i32.const 128) (i32.and (local.get $r) (i32.const 63)))))

;; Search a double-zero-terminated list of zero-terminated ASCII words.
;; This avoids allocating a keyword map for each naming scope.
(func $word_list (param $list i32) (param $p i32) (param $n i32) (result i32)
  (local $end i32)
  (block $done (loop $word
    (br_if $done (i32.eqz (i32.load8_u (local.get $list))))
    (local.set $end (local.get $list))
    (block $end_word (loop $byte
      (br_if $end_word (i32.eqz (i32.load8_u (local.get $end))))
      (local.set $end (i32.add (local.get $end) (i32.const 1))) (br $byte)))
    (if (call $eq (local.get $list) (i32.sub (local.get $end) (local.get $list)) (local.get $p) (local.get $n))
      (then (return (i32.const 1))))
    (local.set $list (i32.add (local.get $end) (i32.const 1))) (br $word)))
  (i32.const 0))
(func $identifier (param $p i32) (param $n i32) (result i32)
  (local $start i32) (local $end i32) (local $next i32) (local $r i32) (local $flags i32)
  (if (i32.eqz (local.get $n)) (then (return (i32.const 0))))
  (local.set $start (local.get $p)) (local.set $end (i32.add (local.get $p) (local.get $n)))
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $p) (local.get $end)))
    (call $rune (local.get $p) (local.get $end)) local.set $r local.set $next
    (local.set $flags (call $unicode_flags (local.get $r)))
    (if (i32.eqz (i32.or
      (i32.or (i32.eq (local.get $r) (i32.const 36)) (i32.eq (local.get $r) (i32.const 95)))
      (i32.or (i32.and (local.get $flags) (i32.const 9))
        (i32.and (i32.ne (local.get $p) (local.get $start)) (i32.ne (i32.and (local.get $flags) (i32.const 20)) (i32.const 0))))))
      (then (return (i32.const 0))))
    (local.set $p (local.get $next)) (br $loop)))
  (i32.eqz (call $word_list (i32.const 2097248) (local.get $start) (local.get $n))))

;; Unicode-aware trim returns a view. One forward scan tracks the first and
;; last non-space rune, avoiding a second decoder for reading UTF-8 backwards.
(func $trim_space (param $p i32) (param $n i32) (result i32 i32)
  (local $end i32) (local $next i32) (local $r i32) (local $first i32) (local $last i32) (local $seen i32)
  (local.set $end (i32.add (local.get $p) (local.get $n))) (local.set $first (local.get $end)) (local.set $last (local.get $end))
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $p) (local.get $end)))
    (call $rune (local.get $p) (local.get $end)) local.set $r local.set $next
    (if (i32.eqz (i32.and (call $unicode_flags (local.get $r)) (i32.const 32)))
      (then
        (if (i32.eqz (local.get $seen)) (then (local.set $first (local.get $p)) (local.set $seen (i32.const 1))))
        (local.set $last (local.get $next))))
    (local.set $p (local.get $next)) (br $loop)))
  (local.get $first) (i32.sub (local.get $last) (local.get $first)))

;; Decimal conversion reverses digits in its own just-written output span.
;; Unsigned division also handles the magnitude of signed INT64_MIN safely.
(func $decimal (param $v i64) (result i32 i32)
  (local $start i32) (local $digits i32) (local $left i32) (local $right i32) (local $b i32)
  (local.set $start (global.get $txt_cursor))
  (if (i64.lt_s (local.get $v) (i64.const 0))
    (then (call $text_byte (i32.const 45)) (local.set $v (i64.sub (i64.const 0) (local.get $v)))))
  (local.set $digits (global.get $txt_cursor))
  (loop $digit
    (call $text_byte (i32.add (i32.const 48) (i32.wrap_i64 (i64.rem_u (local.get $v) (i64.const 10)))))
    (local.set $v (i64.div_u (local.get $v) (i64.const 10)))
    (br_if $digit (i64.ne (local.get $v) (i64.const 0))))
  (local.set $left (local.get $digits)) (local.set $right (i32.sub (global.get $txt_cursor) (i32.const 1)))
  (block $done (loop $reverse
    (br_if $done (i32.ge_u (local.get $left) (local.get $right)))
    (local.set $b (i32.load8_u (local.get $left)))
    (i32.store8 (local.get $left) (i32.load8_u (local.get $right)))
    (i32.store8 (local.get $right) (local.get $b))
    (local.set $left (i32.add (local.get $left) (i32.const 1)))
    (local.set $right (i32.sub (local.get $right) (i32.const 1))) (br $reverse)))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))
(func $decimal_i32 (param $v i32) (result i32 i32) (call $decimal (i64.extend_i32_s (local.get $v))))
(func $text_i32 (param $v i32) (result i32 i32) (call $decimal_i32 (local.get $v)))
(func $text_i64 (param $v i64) (result i32 i32) (call $decimal (local.get $v)))

;; Four uppercase hex digits follow \u; callers only pass a BMP scalar here.
(func $hex4 (param $r i32)
  (call $text_byte (i32.load8_u (i32.add (i32.const 2097152) (i32.and (i32.shr_u (local.get $r) (i32.const 12)) (i32.const 15)))))
  (call $text_byte (i32.load8_u (i32.add (i32.const 2097152) (i32.and (i32.shr_u (local.get $r) (i32.const 8)) (i32.const 15)))))
  (call $text_byte (i32.load8_u (i32.add (i32.const 2097152) (i32.and (i32.shr_u (local.get $r) (i32.const 4)) (i32.const 15)))))
  (call $text_byte (i32.load8_u (i32.add (i32.const 2097152) (i32.and (local.get $r) (i32.const 15))))))

;; Error strings use Go's %q contract, distinct from TypeScript literals.
;; This encoder keeps byte errors as \xNN, uses lower hex, and escapes every
;; rune outside Go's IsPrint set. Ordinary TypeScript quote() preserves more
;; Unicode and intentionally replaces invalid bytes instead.
(func $lower_hex (param $r i32) (param $digits i32)
  (loop $digit
    (local.set $digits (i32.sub (local.get $digits) (i32.const 1)))
    (call $text_byte (i32.load8_u (i32.add (i32.const 2097232)
      (i32.and (i32.shr_u (local.get $r) (i32.shl (local.get $digits) (i32.const 2))) (i32.const 15)))))
    (br_if $digit (local.get $digits))))
(func $go_escape_rune (param $r i32) (param $quote i32)
  (local $short i32)
  (if (i32.or (i32.eq (local.get $r) (local.get $quote)) (i32.eq (local.get $r) (i32.const 92)))
    (then (call $text_byte (i32.const 92)) (call $text_byte (local.get $r)) (return)))
  (if (i32.and (call $unicode_flags (local.get $r)) (i32.const 64))
    (then (call $put_rune (local.get $r)) (return)))
  (call $text_byte (i32.const 92))
  (if (i32.eq (local.get $r) (i32.const 7)) (then (local.set $short (i32.const 97))))
  (if (i32.eq (local.get $r) (i32.const 8)) (then (local.set $short (i32.const 98))))
  (if (i32.eq (local.get $r) (i32.const 12)) (then (local.set $short (i32.const 102))))
  (if (i32.eq (local.get $r) (i32.const 10)) (then (local.set $short (i32.const 110))))
  (if (i32.eq (local.get $r) (i32.const 13)) (then (local.set $short (i32.const 114))))
  (if (i32.eq (local.get $r) (i32.const 9)) (then (local.set $short (i32.const 116))))
  (if (i32.eq (local.get $r) (i32.const 11)) (then (local.set $short (i32.const 118))))
  (if (local.get $short) (then (call $text_byte (local.get $short)) (return)))
  (if (i32.or (i32.lt_u (local.get $r) (i32.const 32)) (i32.eq (local.get $r) (i32.const 127)))
    (then (call $text_byte (i32.const 120)) (call $lower_hex (local.get $r) (i32.const 2)) (return)))
  (if (i32.lt_u (local.get $r) (i32.const 65536))
    (then (call $text_byte (i32.const 117)) (call $lower_hex (local.get $r) (i32.const 4)))
    (else (call $text_byte (i32.const 85)) (call $lower_hex (local.get $r) (i32.const 8)))))
(func $go_quote (param $p i32) (param $n i32) (result i32 i32)
  (local $start i32) (local $end i32) (local $next i32) (local $r i32)
  (local.set $start (global.get $txt_cursor)) (local.set $end (i32.add (local.get $p) (local.get $n)))
  (call $text_byte (i32.const 34))
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $p) (local.get $end)))
    (call $rune (local.get $p) (local.get $end)) local.set $r local.set $next
    (if (i32.and (i32.eq (local.get $r) (i32.const 65533)) (i32.eq (local.get $next) (i32.add (local.get $p) (i32.const 1))))
      (then (call $text_byte (i32.const 92)) (call $text_byte (i32.const 120))
        (call $lower_hex (i32.load8_u (local.get $p)) (i32.const 2)))
      (else (call $go_escape_rune (local.get $r) (i32.const 34))))
    (local.set $p (local.get $next)) (br $loop)))
  (call $text_byte (i32.const 34))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))
(func $go_quote_rune (param $r i32) (result i32 i32)
  (local $start i32)
  (local.set $start (global.get $txt_cursor))
  (if (i32.or (i32.gt_u (local.get $r) (i32.const 1114111))
    (i32.and (i32.ge_u (local.get $r) (i32.const 55296)) (i32.le_u (local.get $r) (i32.const 57343))))
    (then (local.set $r (i32.const 65533))))
  (call $text_byte (i32.const 39)) (call $go_escape_rune (local.get $r) (i32.const 39)) (call $text_byte (i32.const 39))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))

;; JSDoc builders accept each input line separately. A malformed UTF-8 run
;; becomes ONE replacement rune, matching strings.ToValidUTF8 (which differs
;; from the one-replacement-per-byte rule used by ordinary quoted literals).
;; Line separators normalize to LF, and */ becomes *\/ before it can close
;; the comment. Empty split lines print " *" with no trailing space.
(func $comment_begin
  (call $text_byte (i32.const 47)) (call $text_byte (i32.const 42))
  (call $text_byte (i32.const 42)) (call $text_byte (i32.const 10)))
(func $comment_end
  (call $text_byte (i32.const 32)) (call $text_byte (i32.const 42)) (call $text_byte (i32.const 47)))
(func $comment_add (param $p i32) (param $n i32)
  (local $end i32) (local $next i32) (local $r i32) (local $content i32) (local $bad_run i32) (local $bad i32)
  (local.set $end (i32.add (local.get $p) (local.get $n)))
  (call $text_byte (i32.const 32)) (call $text_byte (i32.const 42))
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $p) (local.get $end)))
    (call $rune (local.get $p) (local.get $end)) local.set $r local.set $next
    (local.set $bad (i32.and (i32.eq (local.get $r) (i32.const 65533)) (i32.eq (local.get $next) (i32.add (local.get $p) (i32.const 1)))))
    (if (i32.and (local.get $bad) (local.get $bad_run))
      (then (local.set $p (local.get $next)) (br $loop)))
    (local.set $bad_run (local.get $bad))
    (if (i32.or (i32.or (i32.eq (local.get $r) (i32.const 10)) (i32.eq (local.get $r) (i32.const 13)))
      (i32.or (i32.eq (local.get $r) (i32.const 8232)) (i32.eq (local.get $r) (i32.const 8233))))
      (then
        (if (i32.and (i32.eq (local.get $r) (i32.const 13)) (i32.lt_u (local.get $next) (local.get $end)))
          (then (if (i32.eq (i32.load8_u (local.get $next)) (i32.const 10))
            (then (local.set $next (i32.add (local.get $next) (i32.const 1)))))))
        (call $text_byte (i32.const 10)) (call $text_byte (i32.const 32)) (call $text_byte (i32.const 42))
        (local.set $content (i32.const 0)) (local.set $p (local.get $next)) (br $loop)))
    (if (i32.eqz (local.get $content)) (then (call $text_byte (i32.const 32)) (local.set $content (i32.const 1))))
    (call $put_rune (local.get $r))
    (if (i32.and (i32.eq (local.get $r) (i32.const 42)) (i32.lt_u (local.get $next) (local.get $end)))
      (then (if (i32.eq (i32.load8_u (local.get $next)) (i32.const 47))
        (then (call $text_byte (i32.const 92)) (call $text_byte (i32.const 47))
          (local.set $next (i32.add (local.get $next) (i32.const 1)))))))
    (local.set $p (local.get $next)) (br $loop)))
  (call $text_byte (i32.const 10)))
;; Array form: count consecutive eight-byte pointer/length records at lines.
(func $comment (param $lines i32) (param $count i32) (result i32 i32)
  (local $start i32) (local $i i32)
  (local.set $start (global.get $txt_cursor))
  (if (i32.eqz (local.get $count)) (then (return (local.get $start) (i32.const 0))))
  (call $comment_begin)
  (loop $line
    (call $comment_add (i32.load (local.get $lines)) (i32.load offset=4 (local.get $lines)))
    (local.set $lines (i32.add (local.get $lines) (i32.const 8)))
    (local.set $i (i32.add (local.get $i) (i32.const 1)))
    (br_if $line (i32.lt_u (local.get $i) (local.get $count))))
  (call $comment_end)
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))

;; Type text precedence mirrors tsast.NameType:0arrow/conditional,1union or
;; other non-atomic source,3atom. Arrays themselves have precedence2; a caller
;; carries that precedence separately rather than guessing it from parentheses.
(func $type_precedence (param $p i32) (param $n i32) (result i32)
  (local $i i32) (local $b i32) (local $prec i32)
  (local.set $prec (i32.const 3))
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $i) (local.get $n)))
    (local.set $b (i32.load8_u (i32.add (local.get $p) (local.get $i))))
    (if (i32.and (i32.eq (local.get $b) (i32.const 61)) (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $n)))
      (then (if (i32.eq (i32.load8_u (i32.add (local.get $p) (i32.add (local.get $i) (i32.const 1)))) (i32.const 62))
        (then (return (i32.const 0))))))
    (if (i32.or (i32.or (i32.eq (local.get $b) (i32.const 32)) (i32.eq (local.get $b) (i32.const 9)))
      (i32.or (i32.or (i32.eq (local.get $b) (i32.const 13)) (i32.eq (local.get $b) (i32.const 10)))
        (i32.or (i32.eq (local.get $b) (i32.const 124)) (i32.eq (local.get $b) (i32.const 38)))))
      (then (local.set $prec (i32.const 1))))
    (if (i32.and (i32.eq (local.get $b) (i32.const 32)) (i32.ge_u (i32.sub (local.get $n) (local.get $i)) (i32.const 9)))
      (then
        (if (i64.eq (i64.load (i32.add (local.get $p) (local.get $i))) (i64.const 8314892194057577760))
          (then (if (i32.eq (i32.load8_u offset=8 (i32.add (local.get $p) (local.get $i))) (i32.const 32))
            (then (return (i32.const 0))))))))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $loop)))
  (local.get $prec))
(func $parenthesize (param $p i32) (param $n i32) (param $child i32) (param $parent i32) (result i32 i32)
  (local $start i32)
  (if (i32.ge_s (local.get $child) (local.get $parent)) (then (return (local.get $p) (local.get $n))))
  (local.set $start (global.get $txt_cursor))
  (call $text_byte (i32.const 40)) (call $text_append (local.get $p) (local.get $n)) (call $text_byte (i32.const 41))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))
(func $type_array (param $p i32) (param $n i32) (param $prec i32) (result i32 i32)
  (local $start i32)
  (local.set $start (global.get $txt_cursor))
  (if (i32.lt_s (local.get $prec) (i32.const 2)) (then (call $text_byte (i32.const 40))))
  (call $text_append (local.get $p) (local.get $n))
  (if (i32.lt_s (local.get $prec) (i32.const 2)) (then (call $text_byte (i32.const 41))))
  (call $text_byte (i32.const 91)) (call $text_byte (i32.const 93))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))
(func $literal (param $p i32) (param $n i32) (param $quote i32) (result i32 i32)
  (local $start i32) (local $end i32) (local $next i32) (local $r i32) (local $escape i32) (local $short i32)
  (local.set $start (global.get $txt_cursor)) (local.set $end (i32.add (local.get $p) (local.get $n)))
  (call $text_byte (local.get $quote))
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $p) (local.get $end)))
    (call $rune (local.get $p) (local.get $end)) local.set $r local.set $next
    (local.set $escape (i32.or
      (i32.or (i32.eq (local.get $r) (i32.const 92)) (i32.eq (local.get $r) (local.get $quote)))
      (i32.or (i32.or (i32.eq (local.get $r) (i32.const 8232)) (i32.eq (local.get $r) (i32.const 8233)))
        (i32.or (i32.eq (local.get $r) (i32.const 133))
          (i32.or (i32.lt_u (local.get $r) (i32.const 32))
            (i32.and (i32.eq (local.get $r) (i32.const 65533)) (i32.eq (local.get $next) (i32.add (local.get $p) (i32.const 1)))))))))
    (if (i32.and (i32.eq (local.get $quote) (i32.const 96)) (i32.eq (local.get $r) (i32.const 10)))
      (then (local.set $escape (i32.const 0))))
    (if (i32.and (i32.eq (local.get $quote) (i32.const 96)) (i32.eq (local.get $r) (i32.const 36)))
      (then (if (i32.lt_u (local.get $next) (local.get $end))
        (then (local.set $escape (i32.eq (i32.load8_u (local.get $next)) (i32.const 123)))))))
    (if (local.get $escape)
      (then
        (call $text_byte (i32.const 92))
        (local.set $short (i32.const 0))
        (if (i32.eq (local.get $r) (i32.const 9)) (then (local.set $short (i32.const 116))))
        (if (i32.eq (local.get $r) (i32.const 11)) (then (local.set $short (i32.const 118))))
        (if (i32.eq (local.get $r) (i32.const 12)) (then (local.set $short (i32.const 102))))
        (if (i32.eq (local.get $r) (i32.const 8)) (then (local.set $short (i32.const 98))))
        (if (i32.eq (local.get $r) (i32.const 13)) (then (local.set $short (i32.const 114))))
        (if (i32.eq (local.get $r) (i32.const 10)) (then (local.set $short (i32.const 110))))
        (if (i32.or (i32.eq (local.get $r) (i32.const 92))
          (i32.or (i32.eq (local.get $r) (local.get $quote)) (i32.eq (local.get $r) (i32.const 36))))
          (then (local.set $short (local.get $r))))
        (if (i32.eqz (local.get $r))
          (then
            (local.set $short (i32.const 48))
            (if (i32.lt_u (local.get $next) (local.get $end))
              (then (if (i32.and (i32.ge_u (i32.load8_u (local.get $next)) (i32.const 48)) (i32.le_u (i32.load8_u (local.get $next)) (i32.const 57)))
                (then (call $text_byte (i32.const 120)) (call $text_byte (i32.const 48))))))))
        (if (local.get $short)
          (then (call $text_byte (local.get $short)))
          (else (call $text_byte (i32.const 117)) (call $hex4 (local.get $r))))
        (if (i32.and (i32.eq (local.get $quote) (i32.const 96)) (i32.eq (local.get $r) (i32.const 13)))
          (then (if (i32.lt_u (local.get $next) (local.get $end))
            (then (if (i32.eq (i32.load8_u (local.get $next)) (i32.const 10))
              (then (call $text_byte (i32.const 92)) (call $text_byte (i32.const 110))
                (local.set $next (i32.add (local.get $next) (i32.const 1))))))))))
      (else (call $text_append (local.get $p) (i32.sub (local.get $next) (local.get $p)))))
    (local.set $p (local.get $next)) (br $loop)))
  (call $text_byte (local.get $quote))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))
(func $quote (param $p i32) (param $n i32) (result i32 i32) (call $literal (local.get $p) (local.get $n) (i32.const 34)))
(func $template (param $p i32) (param $n i32) (result i32 i32) (call $literal (local.get $p) (local.get $n) (i32.const 96)))
(func $property (param $p i32) (param $n i32) (result i32 i32)
  (local $start i32)
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2097216) (i32.const 9))
    (then
      (local.set $start (global.get $txt_cursor)) (call $text_byte (i32.const 91))
      (call $quote (local.get $p) (local.get $n)) drop drop
      (call $text_byte (i32.const 93))
      (return (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))))
  (if (call $identifier (local.get $p) (local.get $n)) (then (return (local.get $p) (local.get $n))))
  (call $quote (local.get $p) (local.get $n)))
(func $access (param $object i32) (param $object_n i32) (param $p i32) (param $n i32) (result i32 i32)
  (local $start i32)
  (local.set $start (global.get $txt_cursor)) (call $text_append (local.get $object) (local.get $object_n))
  (if (call $identifier (local.get $p) (local.get $n))
    (then (call $text_byte (i32.const 46)) (call $text_append (local.get $p) (local.get $n)))
    (else (call $text_byte (i32.const 91)) (call $quote (local.get $p) (local.get $n)) drop drop (call $text_byte (i32.const 93))))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))

;; Re-encode every rune, as Go's []rune/string conversion does. Only the first
;; rune changes case; malformed later bytes still become replacement runes.
(func $first_case (param $p i32) (param $n i32) (param $lower i32) (result i32 i32)
  (local $start i32) (local $end i32) (local $r i32) (local $first i32)
  (local.set $start (global.get $txt_cursor)) (local.set $end (i32.add (local.get $p) (local.get $n))) (local.set $first (i32.const 1))
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $p) (local.get $end)))
    (call $rune (local.get $p) (local.get $end)) local.set $r local.set $p
    (if (local.get $first) (then (local.set $r (call $unicode_case (local.get $r) (local.get $lower))) (local.set $first (i32.const 0))))
    (call $put_rune (local.get $r)) (br $loop)))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))
(func $upper_first (param $p i32) (param $n i32) (result i32 i32) (call $first_case (local.get $p) (local.get $n) (i32.const 0)))
(func $lower_first (param $p i32) (param $n i32) (result i32 i32) (call $first_case (local.get $p) (local.get $n) (i32.const 1)))

;; Preserve names without underscores, and preserve leading double underscores.
;; For each other underscore-separated part, lower an all-uppercase part first,
;; then change its first rune according to whether it is the first part.
;; Empty parts still count: _FOO -> Foo, whereas FOO_ -> foo.
(func $field_name (param $p i32) (param $n i32) (param $fallback i32) (param $fallback_n i32) (result i32 i32)
  (local $start i32) (local $end i32) (local $scan i32) (local $part_end i32) (local $next i32)
  (local $r i32) (local $all_upper i32) (local $first_part i32) (local $first_rune i32) (local $has_under i32)
  (if (i32.eqz (local.get $n)) (then (return (local.get $fallback) (local.get $fallback_n))))
  (if (i32.ge_u (local.get $n) (i32.const 2))
    (then (if (i32.and (i32.eq (i32.load8_u (local.get $p)) (i32.const 95)) (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const 95)))
      (then (return (local.get $p) (local.get $n))))))
  (local.set $end (i32.add (local.get $p) (local.get $n))) (local.set $scan (local.get $p))
  (block $found (loop $search
    (br_if $found (i32.eq (local.get $scan) (local.get $end)))
    (if (i32.eq (i32.load8_u (local.get $scan)) (i32.const 95)) (then (local.set $has_under (i32.const 1)) (br $found)))
    (local.set $scan (i32.add (local.get $scan) (i32.const 1))) (br $search)))
  (if (i32.eqz (local.get $has_under)) (then (return (local.get $p) (local.get $n))))
  (local.set $start (global.get $txt_cursor)) (local.set $first_part (i32.const 1))
  (block $done (loop $part
    (local.set $part_end (local.get $p))
    (block $end_part (loop $find_end
      (br_if $end_part (i32.eq (local.get $part_end) (local.get $end)))
      (br_if $end_part (i32.eq (i32.load8_u (local.get $part_end)) (i32.const 95)))
      (local.set $part_end (i32.add (local.get $part_end) (i32.const 1))) (br $find_end)))
    (local.set $all_upper (i32.const 1)) (local.set $scan (local.get $p))
    (block $checked (loop $check
      (br_if $checked (i32.eq (local.get $scan) (local.get $part_end)))
      (call $rune (local.get $scan) (local.get $part_end)) local.set $r local.set $next
      (if (i32.or (i32.ne (local.get $r) (call $unicode_case (local.get $r) (i32.const 0)))
        (i32.and (i32.eq (local.get $r) (i32.const 65533)) (i32.eq (local.get $next) (i32.add (local.get $scan) (i32.const 1)))))
        (then (local.set $all_upper (i32.const 0))))
      (local.set $scan (local.get $next)) (br $check)))
    (local.set $first_rune (i32.const 1))
    (block $printed (loop $print
      (br_if $printed (i32.eq (local.get $p) (local.get $part_end)))
      (call $rune (local.get $p) (local.get $part_end)) local.set $r local.set $p
      (if (local.get $all_upper) (then (local.set $r (call $unicode_case (local.get $r) (i32.const 1)))))
      (if (local.get $first_rune)
        (then (local.set $r (call $unicode_case (local.get $r) (local.get $first_part))) (local.set $first_rune (i32.const 0))))
      (call $put_rune (local.get $r)) (br $print)))
    (br_if $done (i32.eq (local.get $p) (local.get $end)))
    (local.set $p (i32.add (local.get $p) (i32.const 1))) (local.set $first_part (i32.const 0)) (br $part)))
  (if (i32.eq (global.get $txt_cursor) (local.get $start)) (then (return (local.get $fallback) (local.get $fallback_n))))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))

;; Marks are retained only after at least one emitted rune. Other separators
;; request capitalization of the next accepted rune. A leading digit survives,
;; then gains an underscore when the finished identifier is checked.
(func $declaration_name (param $p i32) (param $n i32) (result i32 i32)
  (local $start i32) (local $end i32) (local $r i32) (local $flags i32) (local $cap i32) (local $len i32)
  (local.set $start (global.get $txt_cursor)) (local.set $end (i32.add (local.get $p) (local.get $n))) (local.set $cap (i32.const 1))
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $p) (local.get $end)))
    (call $rune (local.get $p) (local.get $end)) local.set $r local.set $p
    (local.set $flags (call $unicode_flags (local.get $r)))
    (if (i32.and (i32.ne (i32.and (local.get $flags) (i32.const 2)) (i32.const 0)) (i32.gt_u (global.get $txt_cursor) (local.get $start)))
      (then (call $put_rune (local.get $r)) (br $loop)))
    (if (i32.or (i32.eq (local.get $r) (i32.const 95))
      (i32.and (i32.ne (local.get $r) (i32.const 36)) (i32.eqz (i32.and (local.get $flags) (i32.const 5)))))
      (then (local.set $cap (i32.const 1)) (br $loop)))
    (if (local.get $cap) (then (local.set $r (call $unicode_case (local.get $r) (i32.const 0))) (local.set $cap (i32.const 0))))
    (call $put_rune (local.get $r)) (br $loop)))
  (local.set $len (i32.sub (global.get $txt_cursor) (local.get $start)))
  (if (i32.eqz (local.get $len)) (then (return (i32.const 2097184) (i32.const 5))))
  (if (i32.eqz (call $identifier (local.get $start) (local.get $len)))
    (then
      (call $text_byte (i32.const 0))
      (memory.copy (i32.add (local.get $start) (i32.const 1)) (local.get $start) (local.get $len))
      (i32.store8 (local.get $start) (i32.const 95))
      (local.set $len (i32.add (local.get $len) (i32.const 1)))))
  (local.get $start) (local.get $len))

;; Even scope IDs reserve the common keyword/global list. Odd scope IDs are
;; raw property-name sets, matching nameSet{} in the Go generator. A scope costs
;; no table record until its first name is taken. Records are16bytes: scope,
;; borrowed pointer, length, reserved. They occupy32768..1048576.
(func $name_scope (result i32)
  (if (i32.ge_u (global.get $name_scope_id) (i32.const 2147483646)) (then (call $fail (i32.const 10))))
  (global.set $name_scope_id (i32.add (global.get $name_scope_id) (i32.const 1)))
  (i32.shl (global.get $name_scope_id) (i32.const 1)))
(func $name_scope_raw (result i32) (i32.or (call $name_scope) (i32.const 1)))
(func $name_used (param $scope i32) (param $p i32) (param $n i32) (result i32)
  (local $rec i32)
  (if (i32.eqz (i32.and (local.get $scope) (i32.const 1)))
    (then (if (call $word_list (i32.const 2098176) (local.get $p) (local.get $n)) (then (return (i32.const 1))))))
  (local.set $rec (i32.const 32768))
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $rec) (global.get $name_cursor)))
    (if (i32.eq (i32.load (local.get $rec)) (local.get $scope))
      (then (if (call $eq (i32.load offset=4 (local.get $rec)) (i32.load offset=8 (local.get $rec)) (local.get $p) (local.get $n))
        (then (return (i32.const 1))))))
    (local.set $rec (i32.add (local.get $rec) (i32.const 16))) (br $loop)))
  (i32.const 0))
(func $name_take (param $scope i32) (param $base i32) (param $base_n i32) (result i32 i32)
  (local $p i32) (local $n i32) (local $mark i32) (local $suffix i32)
  (local.set $p (local.get $base)) (local.set $n (local.get $base_n))
  (local.set $mark (global.get $txt_cursor)) (local.set $suffix (i32.const 2))
  (block $free (loop $try
    (br_if $free (i32.eqz (call $name_used (local.get $scope) (local.get $p) (local.get $n))))
    (global.set $txt_cursor (local.get $mark))
    (call $text_append (local.get $base) (local.get $base_n)) (call $text_byte (i32.const 95))
    (call $decimal (i64.extend_i32_u (local.get $suffix))) drop drop
    (local.set $p (local.get $mark)) (local.set $n (i32.sub (global.get $txt_cursor) (local.get $mark)))
    (local.set $suffix (i32.add (local.get $suffix) (i32.const 1))) (br $try)))
  (if (i32.ge_u (global.get $name_cursor) (i32.const 1048576)) (then (call $fail (i32.const 10))))
  (call $retain_text (local.get $p) (local.get $n)) (local.set $n) (local.set $p)
  (i32.store (global.get $name_cursor) (local.get $scope))
  (i32.store offset=4 (global.get $name_cursor) (local.get $p))
  (i32.store offset=8 (global.get $name_cursor) (local.get $n))
  (global.set $name_cursor (i32.add (global.get $name_cursor) (i32.const 16)))
  (local.get $p) (local.get $n))

;; DecodeRuneLast semantics, used to count suffix runes without copying them.
;; A malformed suffix consumes one final byte. At most four bytes are examined.
(func $rune_prev (param $start i32) (param $end i32) (result i32 i32)
  (local $p i32) (local $minimum i32) (local $r i32) (local $next i32)
  (if (i32.le_u (local.get $end) (local.get $start)) (then (return (local.get $start) (i32.const 65533))))
  (local.set $p (i32.sub (local.get $end) (i32.const 1)))
  (local.set $r (i32.load8_u (local.get $p)))
  (if (i32.lt_u (local.get $r) (i32.const 128)) (then (return (local.get $p) (local.get $r))))
  (local.set $minimum (local.get $start))
  (if (i32.gt_u (i32.sub (local.get $end) (local.get $start)) (i32.const 4))
    (then (local.set $minimum (i32.sub (local.get $end) (i32.const 4)))))
  (block $invalid (loop $back
    (if (i32.ne (i32.and (i32.load8_u (local.get $p)) (i32.const 192)) (i32.const 128))
      (then
        (call $rune (local.get $p) (local.get $end)) local.set $r local.set $next
        (if (i32.eq (local.get $next) (local.get $end)) (then (return (local.get $p) (local.get $r))))
        (br $invalid)))
    (br_if $invalid (i32.eq (local.get $p) (local.get $minimum)))
    (local.set $p (i32.sub (local.get $p) (i32.const 1))) (br $back)))
  (i32.sub (local.get $end) (i32.const 1)) (i32.const 65533))

;; Go regexp case-folding of ASCII patterns includes just two non-ASCII
;; scalars: long s (U+017F) and Kelvin sign (U+212A). In particular, dotted and
;; dotless Turkish I do NOT fold to an ASCII I in Go's regexp package.
(func $ascii_fold (param $r i32) (result i32)
  (if (i32.and (i32.ge_u (local.get $r) (i32.const 65)) (i32.le_u (local.get $r) (i32.const 90)))
    (then (return (i32.add (local.get $r) (i32.const 32)))))
  (if (i32.eq (local.get $r) (i32.const 383)) (then (return (i32.const 115))))
  (if (i32.eq (local.get $r) (i32.const 8490)) (then (return (i32.const 107))))
  (local.get $r))

;; Compare a literal ASCII pattern to Unicode input. Modes:0uppercase,
;; 1lowercase/exact,2case-folded,3Titlecase/exact. Return next position and bool.
;; The literal rule data stores lowercase text; its spelling is never changed.
(func $ascii_match (param $p i32) (param $end i32) (param $pattern i32) (param $n i32) (param $mode i32) (result i32 i32)
  (local $i i32) (local $r i32) (local $want i32)
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $i) (local.get $n)))
    (if (i32.eq (local.get $p) (local.get $end)) (then (return (local.get $p) (i32.const 0))))
    (call $rune (local.get $p) (local.get $end)) local.set $r local.set $p
    (local.set $want (i32.load8_u (i32.add (local.get $pattern) (local.get $i))))
    (if (i32.or (i32.eqz (local.get $mode)) (i32.and (i32.eq (local.get $mode) (i32.const 3)) (i32.eqz (local.get $i))))
      (then (local.set $want (i32.sub (local.get $want) (i32.const 32)))))
    (if (i32.eq (local.get $mode) (i32.const 2)) (then (local.set $r (call $ascii_fold (local.get $r)))))
    (if (i32.ne (local.get $r) (local.get $want)) (then (return (local.get $p) (i32.const 0))))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $loop)))
  (local.get $p) (i32.const 1))

;; Return a matching suffix's source pointer or zero. Counting runes backwards
;; allows a folded long-s or Kelvin sign to occupy multiple input bytes.
(func $ascii_suffix (param $p i32) (param $end i32) (param $pattern i32) (param $n i32) (param $mode i32) (result i32)
  (local $candidate i32) (local $i i32) (local $ok i32)
  (local.set $candidate (local.get $end))
  (block $counted (loop $count
    (br_if $counted (i32.eq (local.get $i) (local.get $n)))
    (if (i32.eq (local.get $candidate) (local.get $p)) (then (return (i32.const 0))))
    (call $rune_prev (local.get $p) (local.get $candidate)) drop local.set $candidate
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $count)))
  (call $ascii_match (local.get $candidate) (local.get $end) (local.get $pattern) (local.get $n) (local.get $mode)) local.set $ok drop
  (select (local.get $candidate) (i32.const 0) (local.get $ok)))
(func $ascii_append (param $p i32) (param $n i32) (param $mode i32)
  (local $i i32) (local $b i32)
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $i) (local.get $n)))
    (local.set $b (i32.load8_u (i32.add (local.get $p) (local.get $i))))
    (if (i32.or (i32.eqz (local.get $mode)) (i32.and (i32.eq (local.get $mode) (i32.const 3)) (i32.eqz (local.get $i))))
      (then (local.set $b (i32.sub (local.get $b) (i32.const 32)))))
    (call $text_byte (local.get $b)) (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $loop))))
(func $singular_replace (param $p i32) (param $end i32) (param $remove i32) (param $suffix i32) (param $n i32) (param $mode i32) (result i32 i32)
  (local $start i32)
  (local.set $start (global.get $txt_cursor))
  (block $counted (loop $count
    (br_if $counted (i32.eqz (local.get $remove)))
    (call $rune_prev (local.get $p) (local.get $end)) drop local.set $end
    (local.set $remove (i32.sub (local.get $remove) (i32.const 1))) (br $count)))
  (call $text_append (local.get $p) (i32.sub (local.get $end) (local.get $p)))
  (call $ascii_append (local.get $suffix) (local.get $n) (local.get $mode))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))

;; Test the negated one-rune classes in the original singularization rules.
;; Uppercase and lowercase regex passes are case-sensitive, including their
;; NEGATED classes; only mode2 folds before comparing an excluded letter.
(func $singular_excluded (param $r i32) (param $mode i32) (param $vowels i32) (result i32)
  (if (i32.eq (local.get $mode) (i32.const 2)) (then (local.set $r (call $ascii_fold (local.get $r)))))
  (if (i32.eqz (local.get $mode)) (then (local.set $r (i32.add (local.get $r) (i32.const 32)))))
  (if (i32.eqz (local.get $vowels)) (then (return (i32.eq (local.get $r) (i32.const 102)))))
  (i32.or (i32.or (i32.eq (local.get $r) (i32.const 97)) (i32.eq (local.get $r) (i32.const 101)))
    (i32.or (i32.or (i32.eq (local.get $r) (i32.const 105)) (i32.eq (local.get $r) (i32.const 111)))
      (i32.or (i32.eq (local.get $r) (i32.const 117)) (i32.eq (local.get $r) (i32.const 121))))))

;; Exact jinzhu/inflection v1.0.0 default Singular rules, without a general
;; regex engine. All its patterns are fixed ASCII suffixes with at most one
;; preceding-rune test; one oxen rule instead matches a prefix. inflection-data
;; records preserve the original reverse priority and capture boundaries.
;;
;; First come whole-word uncountables, then exact UPPER/Title/lower irregulars,
;; then each regular rule's UPPER,lower,folded passes. Captured input bytes keep
;; their original spelling; only literal replacement suffixes change case.
(func $singular (param $p i32) (param $n i32) (result i32 i32)
  (local $end i32) (local $list i32) (local $word_end i32) (local $next i32) (local $ok i32)
  (local $rec i32) (local $limit i32) (local $pass i32) (local $mode i32) (local $candidate i32)
  (local $flags i32) (local $r i32) (local $start i32)
  (local.set $end (i32.add (local.get $p) (local.get $n))) (local.set $list (i32.const 2108192))
  (block $uncountable_done (loop $uncountable
    (br_if $uncountable_done (i32.eqz (i32.load8_u (local.get $list))))
    (local.set $word_end (local.get $list))
    (block $found_end (loop $find_end
      (br_if $found_end (i32.eqz (i32.load8_u (local.get $word_end))))
      (local.set $word_end (i32.add (local.get $word_end) (i32.const 1))) (br $find_end)))
    (call $ascii_match (local.get $p) (local.get $end) (local.get $list) (i32.sub (local.get $word_end) (local.get $list)) (i32.const 2)) local.set $ok local.set $next
    (if (i32.and (local.get $ok) (i32.eq (local.get $next) (local.get $end))) (then (return (local.get $p) (local.get $n))))
    (local.set $list (i32.add (local.get $word_end) (i32.const 1))) (br $uncountable)))
  (local.set $rec (global.get $singular_irregular_base))
  (local.set $limit (i32.add (local.get $rec) (i32.mul (global.get $singular_irregular_count) (i32.const 24))))
  (block $irregular_done (loop $irregular
    (br_if $irregular_done (i32.eq (local.get $rec) (local.get $limit)))
    (local.set $pass (i32.const 0))
    (block $next_irregular (loop $variant
      (br_if $next_irregular (i32.eq (local.get $pass) (i32.const 3)))
      (local.set $mode (i32.const 1))
      (if (i32.eqz (local.get $pass)) (then (local.set $mode (i32.const 0))))
      (if (i32.eq (local.get $pass) (i32.const 1)) (then (local.set $mode (i32.const 3))))
      (if (call $ascii_suffix (local.get $p) (local.get $end) (i32.load (local.get $rec)) (i32.load offset=4 (local.get $rec)) (local.get $mode))
        (then (return (call $singular_replace (local.get $p) (local.get $end) (i32.load offset=8 (local.get $rec)) (i32.load offset=12 (local.get $rec)) (i32.load offset=16 (local.get $rec)) (local.get $mode)))))
      (local.set $pass (i32.add (local.get $pass) (i32.const 1))) (br $variant)))
    (local.set $rec (i32.add (local.get $rec) (i32.const 24))) (br $irregular)))
  (local.set $rec (global.get $singular_rule_base))
  (local.set $limit (i32.add (local.get $rec) (i32.mul (global.get $singular_rule_count) (i32.const 24))))
  (block $regular_done (loop $regular
    (br_if $regular_done (i32.eq (local.get $rec) (local.get $limit)))
    (local.set $mode (i32.const 0)) (local.set $flags (i32.load offset=20 (local.get $rec)))
    (block $next_regular (loop $variant
      (br_if $next_regular (i32.eq (local.get $mode) (i32.const 3)))
      (block $not_this_variant
        (if (i32.and (local.get $flags) (i32.const 8))
          (then
            (call $ascii_match (local.get $p) (local.get $end) (i32.load (local.get $rec)) (i32.load offset=4 (local.get $rec)) (local.get $mode)) local.set $ok local.set $next
            (br_if $not_this_variant (i32.eqz (local.get $ok)))
            (local.set $start (global.get $txt_cursor))
            (call $text_append (local.get $p) (i32.const 2))
            (call $text_append (local.get $next) (i32.sub (local.get $end) (local.get $next)))
            (return (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))))
        (local.set $candidate (call $ascii_suffix (local.get $p) (local.get $end) (i32.load (local.get $rec)) (i32.load offset=4 (local.get $rec)) (local.get $mode)))
        (br_if $not_this_variant (i32.eqz (local.get $candidate)))
        (br_if $not_this_variant (i32.and (i32.and (local.get $flags) (i32.const 1)) (i32.ne (local.get $candidate) (local.get $p))))
        (if (i32.and (local.get $flags) (i32.const 6))
          (then
            (br_if $not_this_variant (i32.eq (local.get $candidate) (local.get $p)))
            (call $rune_prev (local.get $p) (local.get $candidate)) local.set $r drop
            (br_if $not_this_variant (call $singular_excluded (local.get $r) (local.get $mode) (i32.and (local.get $flags) (i32.const 4))))))
        (return (call $singular_replace (local.get $p) (local.get $end) (i32.load offset=8 (local.get $rec)) (i32.load offset=12 (local.get $rec)) (i32.load offset=16 (local.get $rec)) (local.get $mode))))
      (local.set $mode (i32.add (local.get $mode) (i32.const 1))) (br $variant)))
    (local.set $rec (i32.add (local.get $rec) (i32.const 24))) (br $regular)))
  (local.get $p) (local.get $n))
