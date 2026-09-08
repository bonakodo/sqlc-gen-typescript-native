;; Override matching over fixed records. No regexp engine, hash map, heap, or
;; temporary object graph is needed. Record kind 109 uses these fixed offsets:
;;  4 next; 8 category (1 column, 2 database, 3 query); 12 source JSON token;
;; 16 resolved mapping token (-1 for nullable-only query overrides); 20 order;
;; 24 part count / query-is-parameter; 28 nullability (-1/0/1);
;; 32..63 four pointer-length selector parts (query name and target use first2);
;; 64 bitmask of parts that use wildcard/escape matching.
;;
;; These records occupy the already-consumed input tail through work_record.
;; Their text views point at retained decoded JSON strings. The caller must run
;; prepare_overrides once after options parsing and work_init, then keep both
;; views and records alive for the generation request.
(global $ov_columns (mut i32) (i32.const 0))
(global $ov_columns_tail (mut i32) (i32.const 0))
(global $ov_database (mut i32) (i32.const 0))
(global $ov_database_tail (mut i32) (i32.const 0))
(global $ov_queries (mut i32) (i32.const 0))
(global $ov_queries_tail (mut i32) (i32.const 0))

(func $ov_append (param $row i32) (param $category i32)
  (i32.store offset=8 (local.get $row) (local.get $category))
  (if (i32.eq (local.get $category) (i32.const 1))
    (then
      (if (global.get $ov_columns_tail)
        (then (i32.store offset=4 (global.get $ov_columns_tail) (local.get $row)))
        (else (global.set $ov_columns (local.get $row))))
      (global.set $ov_columns_tail (local.get $row)) (return)))
  (if (i32.eq (local.get $category) (i32.const 2))
    (then
      (if (global.get $ov_database_tail)
        (then (i32.store offset=4 (global.get $ov_database_tail) (local.get $row)))
        (else (global.set $ov_database (local.get $row))))
      (global.set $ov_database_tail (local.get $row)) (return)))
  (if (global.get $ov_queries_tail)
    (then (i32.store offset=4 (global.get $ov_queries_tail) (local.get $row)))
    (else (global.set $ov_queries (local.get $row))))
  (global.set $ov_queries_tail (local.get $row)))

(func $override_preset (param $mapping i32) (result i32 i32)
  (call $opt_string (local.get $mapping) (i32.const 2637824) (i32.const 6)))

(func $fixed_preset_type (param $p i32) (param $n i32) (result i32 i32)
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2637830) (i32.const 12)) (then (return (i32.const 2637842) (i32.const 6))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2637848) (i32.const 18)) (then (return (i32.const 2637866) (i32.const 4))))
  (if (call $eq (local.get $p) (local.get $n) (i32.const 2637870) (i32.const 14)) (then (return (i32.const 2637884) (i32.const 7))))
  (i32.const 0) (i32.const 0))

(func $override_type (param $mapping i32) (result i32 i32)
  (local $p i32) (local $n i32)
  (call $opt_string (local.get $mapping) (i32.const 2637891) (i32.const 7)) (local.set $n) (local.set $p)
  (if (local.get $n) (then (return (local.get $p) (local.get $n))))
  (if (call $opt_is (local.get $mapping) (i32.const 2637824) (i32.const 6) (i32.const 2637898) (i32.const 9)) (then (return (i32.const 2637907) (i32.const 7))))
  (call $fixed_preset_type (call $override_preset (local.get $mapping))))

(func $override_import_path (param $mapping i32) (result i32 i32)
  (call $opt_string (call $opt_get (local.get $mapping) (i32.const 2637914) (i32.const 6)) (i32.const 2637920) (i32.const 4)))
(func $override_import_name (param $mapping i32) (result i32 i32)
  (call $opt_string (call $opt_get (local.get $mapping) (i32.const 2637914) (i32.const 6)) (i32.const 2637924) (i32.const 4)))
(func $override_codec_path (param $mapping i32) (result i32 i32)
  (if (call $opt_nonempty (local.get $mapping) (i32.const 2637824) (i32.const 6)) (then (return (i32.const 2637928) (i32.const 12))))
  (call $opt_string (call $opt_get (local.get $mapping) (i32.const 2637940) (i32.const 5)) (i32.const 2637920) (i32.const 4)))
(func $override_codec_name (param $mapping i32) (result i32 i32)
  (if (call $opt_is (local.get $mapping) (i32.const 2637824) (i32.const 6) (i32.const 2637830) (i32.const 12)) (then (return (i32.const 2637945) (i32.const 11))))
  (if (call $opt_is (local.get $mapping) (i32.const 2637824) (i32.const 6) (i32.const 2637848) (i32.const 18)) (then (return (i32.const 2637956) (i32.const 17))))
  (if (call $opt_is (local.get $mapping) (i32.const 2637824) (i32.const 6) (i32.const 2637870) (i32.const 14)) (then (return (i32.const 2637973) (i32.const 13))))
  (if (call $opt_is (local.get $mapping) (i32.const 2637824) (i32.const 6) (i32.const 2637898) (i32.const 9)) (then (return (i32.const 2637986) (i32.const 8))))
  (call $opt_string (call $opt_get (local.get $mapping) (i32.const 2637940) (i32.const 5)) (i32.const 2637924) (i32.const 4)))

;; Regex-free glob matching for one selector part. '*' and '?' each exclude
;; newline, just as Go regexp's dot does. '?' consumes one Unicode code point.
;; Keep one retry position for the latest '*'; failed literals advance that
;; star by one rune. This needs constant local state, including for long input.
;;
;; Compatibility detail: pattern.matchCompile iterates raw UTF-8 BYTES and
;; converts each literal byte to a Go rune. A wildcard-bearing non-ASCII part
;; therefore retains that byte-to-rune behavior here. Exact non-wildcard parts
;; use ordinary UTF-8 byte equality and do not undergo that conversion.
(func $ov_pattern (param $p i32) (param $n i32) (param $v i32) (param $vn i32) (result i32)
  (local $end i32) (local $vend i32) (local $star i32) (local $retry i32)
  (local $c i32) (local $r i32) (local $nextp i32) (local $escaped i32)
  (local.set $end (i32.add (local.get $p) (local.get $n)))
  (local.set $vend (i32.add (local.get $v) (local.get $vn)))
  (local.set $star (i32.const -1))
  (loop $step
    (block $mismatch
      (if (i32.eq (local.get $p) (local.get $end))
        (then
          (if (i32.eq (local.get $v) (local.get $vend)) (then (return (i32.const 1))))
          (br $mismatch)))
      (local.set $c (i32.load8_u (local.get $p)))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (if (i32.eq (local.get $c) (i32.const 42))
        (then (local.set $star (local.get $p)) (local.set $retry (local.get $v)) (br $step)))
      (local.set $escaped (i32.const 0))
      (if (i32.eq (local.get $c) (i32.const 92))
        (then
          (if (i32.eq (local.get $p) (local.get $end)) (then (return (i32.const 0))))
          (local.set $c (i32.load8_u (local.get $p)))
          (local.set $p (i32.add (local.get $p) (i32.const 1)))
          (local.set $escaped (i32.const 1))))
      (br_if $mismatch (i32.eq (local.get $v) (local.get $vend)))
      (call $rune (local.get $v) (local.get $vend)) (local.set $r) (local.set $nextp)
      (if (i32.and (i32.eqz (local.get $escaped)) (i32.eq (local.get $c) (i32.const 63)))
        (then (br_if $mismatch (i32.eq (local.get $r) (i32.const 10))))
        (else (br_if $mismatch (i32.ne (local.get $c) (local.get $r)))))
      (local.set $v (local.get $nextp))
      (br $step))
    (if (i32.lt_s (local.get $star) (i32.const 0)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $retry) (local.get $vend)) (then (return (i32.const 0))))
    (call $rune (local.get $retry) (local.get $vend)) (local.set $r) (local.set $retry)
    (if (i32.eq (local.get $r) (i32.const 10)) (then (return (i32.const 0))))
    (local.set $p (local.get $star)) (local.set $v (local.get $retry)) (br $step))
  (i32.const 0))

(func $ov_compile_selector (param $source i32) (param $mapping i32) (param $order i32) (param $token i32)
  (local $row i32) (local $p i32) (local $n i32) (local $i i32)
  (local $part i32) (local $start i32) (local $mask i32) (local $c i32)
  (local.set $row (call $work_record (i32.const 109)))
  (i32.store offset=12 (local.get $row) (local.get $source))
  (i32.store offset=16 (local.get $row) (local.get $mapping))
  (i32.store offset=20 (local.get $row) (local.get $order))
  (local.set $p (call $json_ptr (local.get $token)))
  (local.set $n (call $json_len (local.get $token)))
  (block $done
    (loop $byte
      (local.set $c (i32.const 46))
      (if (i32.lt_u (local.get $i) (local.get $n))
        (then (local.set $c (i32.load8_u (i32.add (local.get $p) (local.get $i))))))
      (if (i32.eq (local.get $c) (i32.const 46))
        (then
          (if (i32.ge_u (local.get $part) (i32.const 4)) (then (call $fail (i32.const 18)) unreachable))
          (call $set_text (local.get $row) (i32.add (i32.const 32) (i32.mul (local.get $part) (i32.const 8)))
            (i32.add (local.get $p) (local.get $start)) (i32.sub (local.get $i) (local.get $start)))
          (local.set $part (i32.add (local.get $part) (i32.const 1)))
          (local.set $start (i32.add (local.get $i) (i32.const 1))))
        (else
          (if (i32.or (i32.eq (local.get $c) (i32.const 42))
                (i32.or (i32.eq (local.get $c) (i32.const 63)) (i32.eq (local.get $c) (i32.const 92))))
            (then (local.set $mask (i32.or (local.get $mask) (i32.shl (i32.const 1) (local.get $part))))))))
      (br_if $done (i32.eq (local.get $i) (local.get $n)))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $byte)))
  (i32.store offset=24 (local.get $row) (local.get $part))
  (i32.store offset=64 (local.get $row) (local.get $mask))
  (call $ov_append (local.get $row) (i32.const 1)))

(func $ov_metadata (param $row i32)
  (local $query i32) (local $item i32) (local $column i32)
  (local $mark i32) (local $qp i32) (local $qn i32) (local $np i32) (local $nn i32)
  (local.set $query (call $child (global.get $gen_request) (i32.const 3)))
  (block $queries_done
    (loop $queries
      (br_if $queries_done (i32.eqz (local.get $query)))
      (if (call $eq (call $get_text (local.get $row) (i32.const 32)) (call $text (local.get $query) (i32.const 2)))
        (then
          (local.set $item (call $child (local.get $query)
            (select (i32.const 5) (i32.const 4) (i32.load offset=24 (local.get $row)))))
          (block $items_done
            (loop $items
              (br_if $items_done (i32.eqz (local.get $item)))
              (local.set $column (local.get $item))
              (if (i32.load offset=24 (local.get $row))
                (then (local.set $column (call $child (local.get $item) (i32.const 2)))))
              (if (i32.and (i32.ne (local.get $column) (i32.const 0))
                    (call $eq (call $get_text (local.get $row) (i32.const 40)) (call $text (local.get $column) (i32.const 1))))
                (then (return)))
              (local.set $item (call $next (local.get $item))) (br $items)))))
      (local.set $query (call $next (local.get $query))) (br $queries)))
  (call $go_quote (call $get_text (local.get $row) (i32.const 32))) (local.set $qn) (local.set $qp)
  (call $go_quote (call $get_text (local.get $row) (i32.const 40))) (local.set $nn) (local.set $np)
  (local.set $mark (call $text_mark))
  (call $text_append (i32.const 2637994) (i32.const 15))
  (call $text_append (local.get $qp) (local.get $qn))
  (if (i32.load offset=24 (local.get $row))
    (then (call $text_append (i32.const 2638009) (i32.const 12)))
    (else (call $text_append (i32.const 2638021) (i32.const 16))))
  (call $text_append (local.get $np) (local.get $nn))
  (call $text_append (i32.const 2638037) (i32.const 33))
  (call $error (local.get $mark) (i32.sub (global.get $txt_cursor) (local.get $mark)))
  unreachable)

(func $prepare_overrides
  (local $arr i32) (local $i i32) (local $source i32) (local $mapping i32)
  (local $cols i32) (local $j i32) (local $row i32) (local $nullable i32)
  (global.set $ov_columns (i32.const 0)) (global.set $ov_columns_tail (i32.const 0))
  (global.set $ov_database (i32.const 0)) (global.set $ov_database_tail (i32.const 0))
  (global.set $ov_queries (i32.const 0)) (global.set $ov_queries_tail (i32.const 0))
  (local.set $arr (call $opt_get (global.get $gen_options) (i32.const 2638070) (i32.const 9)))
  (block $done
    (loop $override
      (br_if $done (i32.ge_u (local.get $i) (call $opt_count (local.get $arr))))
      (local.set $source (call $json_at (local.get $arr) (local.get $i)))
      (local.set $mapping (call $opt_resolve_mapping (local.get $source)))
      (if (call $opt_nonempty (local.get $source) (i32.const 2638079) (i32.const 6))
        (then (call $ov_compile_selector (local.get $source) (local.get $mapping) (local.get $i)
          (call $opt_get (local.get $source) (i32.const 2638079) (i32.const 6))))
        (else
          (local.set $cols (call $opt_get (local.get $source) (i32.const 2638085) (i32.const 7)))
          (local.set $j (i32.const 0))
          (block $columns_done
            (loop $column
              (br_if $columns_done (i32.ge_u (local.get $j) (call $opt_count (local.get $cols))))
              (call $ov_compile_selector (local.get $source) (local.get $mapping) (local.get $i) (call $json_at (local.get $cols) (local.get $j)))
              (local.set $j (i32.add (local.get $j) (i32.const 1))) (br $column)))))
      (if (call $opt_nonempty (local.get $source) (i32.const 2638092) (i32.const 7))
        (then
          (local.set $row (call $work_record (i32.const 109)))
          (i32.store offset=12 (local.get $row) (local.get $source))
          (i32.store offset=16 (local.get $row) (local.get $mapping))
          (i32.store offset=20 (local.get $row) (local.get $i))
          (call $set_text (local.get $row) (i32.const 32) (call $opt_string (local.get $source) (i32.const 2638092) (i32.const 7)))
          (call $ov_append (local.get $row) (i32.const 2))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $override)))
  (local.set $arr (call $opt_get (global.get $gen_options) (i32.const 2638099) (i32.const 15)))
  (local.set $i (i32.const 0))
  (block $done
    (loop $override
      (br_if $done (i32.ge_u (local.get $i) (call $opt_count (local.get $arr))))
      (local.set $source (call $json_at (local.get $arr) (local.get $i)))
      (local.set $mapping (i32.const -1))
      (if (i32.or (call $opt_nonempty (local.get $source) (i32.const 2638114) (i32.const 7)) (call $opt_inline_nonempty (local.get $source)))
        (then (local.set $mapping (call $opt_resolve_mapping (local.get $source)))))
      (local.set $row (call $work_record (i32.const 109)))
      (i32.store offset=12 (local.get $row) (local.get $source))
      (i32.store offset=16 (local.get $row) (local.get $mapping))
      (i32.store offset=20 (local.get $row) (local.get $i))
      (i32.store offset=24 (local.get $row) (call $opt_nonempty (local.get $source) (i32.const 2638121) (i32.const 9)))
      (local.set $nullable (call $json_kind (call $opt_get (local.get $source) (i32.const 2638130) (i32.const 8))))
      (i32.store offset=28 (local.get $row) (select
        (i32.eq (local.get $nullable) (i32.const 5)) (i32.const -1)
        (i32.or (i32.eq (local.get $nullable) (i32.const 5)) (i32.eq (local.get $nullable) (i32.const 6)))))
      (call $set_text (local.get $row) (i32.const 32) (call $opt_string (local.get $source) (i32.const 2638138) (i32.const 5)))
      (if (i32.load offset=24 (local.get $row))
        (then (call $set_text (local.get $row) (i32.const 40) (call $opt_string (local.get $source) (i32.const 2638121) (i32.const 9))))
        (else (call $set_text (local.get $row) (i32.const 40) (call $opt_string (local.get $source) (i32.const 2638079) (i32.const 6)))))
      (call $ov_metadata (local.get $row))
      (call $ov_append (local.get $row) (i32.const 3))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $override))))

(func $ov_column_match (param $row i32) (param $column i32) (result i32)
  (local $table i32) (local $count i32) (local $j i32) (local $component i32)
  (local $schema i32) (local $scheman i32) (local $name i32) (local $namen i32)
  (local $p i32) (local $n i32) (local $match i32)
  (local.set $table (call $child (local.get $column) (i32.const 10)))
  (if (i32.eqz (local.get $table)) (then (return (i32.const 0))))
  (call $text (local.get $table) (i32.const 2)) (local.set $scheman) (local.set $schema)
  (if (i32.eqz (local.get $scheman))
    (then (call $text (global.get $gen_catalog) (i32.const 2)) (local.set $scheman) (local.set $schema)))
  (local.set $count (i32.load offset=24 (local.get $row)))
  (if (i32.and (i32.eq (local.get $count) (i32.const 2))
        (i32.eqz (call $eq (local.get $schema) (local.get $scheman) (call $text (global.get $gen_catalog) (i32.const 2)))))
    (then (return (i32.const 0))))
  (call $text (local.get $column) (i32.const 15)) (local.set $namen) (local.set $name)
  (if (i32.eqz (local.get $namen))
    (then (call $text (local.get $column) (i32.const 1)) (local.set $namen) (local.set $name)))
  (block $done
    (loop $part
      (br_if $done (i32.ge_u (local.get $j) (local.get $count)))
      (local.set $component (i32.add (i32.sub (i32.const 4) (local.get $count)) (local.get $j)))
      (block $actual
        (if (i32.eq (local.get $component) (i32.const 0))
          (then (call $text (local.get $table) (i32.const 1)) (local.set $n) (local.set $p) (br $actual)))
        (if (i32.eq (local.get $component) (i32.const 1))
          (then (local.set $p (local.get $schema)) (local.set $n (local.get $scheman)) (br $actual)))
        (if (i32.eq (local.get $component) (i32.const 2))
          (then (call $text (local.get $table) (i32.const 3)) (local.set $n) (local.set $p) (br $actual)))
        (local.set $p (local.get $name)) (local.set $n (local.get $namen)))
      (if (i32.and (i32.load offset=64 (local.get $row)) (i32.shl (i32.const 1) (local.get $j)))
        (then (local.set $match (call $ov_pattern
          (call $get_text (local.get $row) (i32.add (i32.const 32) (i32.mul (local.get $j) (i32.const 8)))) (local.get $p) (local.get $n))))
        (else (local.set $match (call $eq
          (call $get_text (local.get $row) (i32.add (i32.const 32) (i32.mul (local.get $j) (i32.const 8)))) (local.get $p) (local.get $n)))))
      (if (i32.eqz (local.get $match)) (then (return (i32.const 0))))
      (local.set $j (i32.add (local.get $j) (i32.const 1))) (br $part)))
  (i32.const 1))

;; Equality after Go strings.ToLower's Unicode simple lowercase mapping.
;; Decoding the two streams together avoids materializing lowercased copies.
(func $ov_lower_eq (param $p i32) (param $n i32) (param $q i32) (param $m i32) (result i32)
  (local $end i32) (local $qend i32) (local $r i32) (local $s i32)
  (local.set $end (i32.add (local.get $p) (local.get $n)))
  (local.set $qend (i32.add (local.get $q) (local.get $m)))
  (block $done
    (loop $rune
      (br_if $done (i32.eq (local.get $p) (local.get $end)))
      (if (i32.eq (local.get $q) (local.get $qend)) (then (return (i32.const 0))))
      (call $rune (local.get $p) (local.get $end)) (local.set $r) (local.set $p)
      (call $rune (local.get $q) (local.get $qend)) (local.set $s) (local.set $q)
      (if (i32.ne (call $unicode_case (local.get $r) (i32.const 1)) (call $unicode_case (local.get $s) (i32.const 1)))
        (then (return (i32.const 0))))
      (br $rune)))
  (i32.eq (local.get $q) (local.get $qend)))

(func $matching_override (param $column i32) (result i32)
  (local $row i32) (local $source i32) (local $type i32) (local $nullable i32)
  (local $p i32) (local $n i32) (local $qualified i32) (local $qualifiedn i32)
  (local $mark i32) (local $found i32)
  (if (i32.eqz (local.get $column)) (then (return (i32.const -1))))
  ;; Every column selector, including later selectors, outranks all database
  ;; selectors. Within the column list, declaration order decides the result.
  (local.set $row (global.get $ov_columns))
  (block $columns_done
    (loop $columns
      (br_if $columns_done (i32.eqz (local.get $row)))
      (if (call $ov_column_match (local.get $row) (local.get $column))
        (then (return (i32.load offset=16 (local.get $row)))))
      (local.set $row (call $next (local.get $row))) (br $columns)))
  (local.set $type (call $child (local.get $column) (i32.const 12)))
  (call $text (local.get $type) (i32.const 3)) (local.set $n) (local.set $p)
  (local.set $qualified (local.get $p)) (local.set $qualifiedn (local.get $n))
  (local.set $mark (call $text_mark))
  (if (call $text_len (local.get $type) (i32.const 2))
    (then
      (local.set $qualified (call $text_mark))
      (call $text_append (call $text (local.get $type) (i32.const 2)))
      (call $text_append (i32.const 2638143) (i32.const 1))
      (call $text_append (local.get $p) (local.get $n))
      (local.set $qualifiedn (i32.sub (global.get $txt_cursor) (local.get $qualified)))))
  (local.set $nullable (i32.eqz (call $number (local.get $column) (i32.const 3))))
  (local.set $row (global.get $ov_database))
  (local.set $found (i32.const -1))
  (block $done
    (loop $database
      (br_if $done (i32.eqz (local.get $row)))
      (local.set $source (i32.load offset=12 (local.get $row)))
      (if (i32.or (call $opt_bool (local.get $source) (i32.const 2638144) (i32.const 12))
            (i32.eq (call $opt_bool (local.get $source) (i32.const 2638130) (i32.const 8)) (local.get $nullable)))
        (then
          (if (i32.or
                (call $ov_lower_eq (call $get_text (local.get $row) (i32.const 32)) (local.get $p) (local.get $n))
                (call $ov_lower_eq (call $get_text (local.get $row) (i32.const 32)) (local.get $qualified) (local.get $qualifiedn)))
            (then (local.set $found (i32.load offset=16 (local.get $row))) (br $done)))))
      (local.set $row (call $next (local.get $row))) (br $database)))
  (call $text_reset (local.get $mark))
  (local.get $found))

;; Return mapping token and nullability independently. A nullable-only override
;; returns -1 plus 0/1. No matching query contract returns -1,-1. The first
;; matching complete contract wins; later entries never merge nullability.
(func $query_override (param $query i32) (param $column i32) (param $parameter i32) (result i32 i32)
  (local $row i32)
  (if (i32.or (i32.eqz (local.get $query)) (i32.eqz (local.get $column)))
    (then (return (i32.const -1) (i32.const -1))))
  (local.set $row (global.get $ov_queries))
  (block $done
    (loop $query
      (br_if $done (i32.eqz (local.get $row)))
      (if (i32.and (i32.eq (i32.load offset=24 (local.get $row)) (local.get $parameter))
            (i32.and
              (call $eq (call $get_text (local.get $row) (i32.const 32)) (call $text (local.get $query) (i32.const 2)))
              (call $eq (call $get_text (local.get $row) (i32.const 40)) (call $text (local.get $column) (i32.const 1)))))
        (then (return (i32.load offset=16 (local.get $row)) (i32.load offset=28 (local.get $row)))))
      (local.set $row (call $next (local.get $row))) (br $query)))
  (i32.const -1) (i32.const -1))

;; Read-only override names and diagnostics.
(data (i32.const 2637824) "\70\72\65\73\65\74") ;; 'preset'
(data (i32.const 2637830) "\73\61\66\65\5f\69\6e\74\65\67\65\72") ;; 'safe_integer'
(data (i32.const 2637842) "\6e\75\6d\62\65\72") ;; 'number'
(data (i32.const 2637848) "\65\70\6f\63\68\5f\6d\69\6c\6c\69\73\65\63\6f\6e\64\73") ;; 'epoch_milliseconds'
(data (i32.const 2637866) "\44\61\74\65") ;; 'Date'
(data (i32.const 2637870) "\73\71\6c\69\74\65\5f\62\6f\6f\6c\65\61\6e") ;; 'sqlite_boolean'
(data (i32.const 2637884) "\62\6f\6f\6c\65\61\6e") ;; 'boolean'
(data (i32.const 2637891) "\74\73\5f\74\79\70\65") ;; 'ts_type'
(data (i32.const 2637898) "\6a\73\6f\6e\5f\74\65\78\74") ;; 'json_text'
(data (i32.const 2637907) "\75\6e\6b\6e\6f\77\6e") ;; 'unknown'
(data (i32.const 2637914) "\69\6d\70\6f\72\74") ;; 'import'
(data (i32.const 2637920) "\70\61\74\68") ;; 'path'
(data (i32.const 2637924) "\6e\61\6d\65") ;; 'name'
(data (i32.const 2637928) "\2e\2f\72\75\6e\74\69\6d\65\2e\74\73") ;; './runtime.ts'
(data (i32.const 2637940) "\63\6f\64\65\63") ;; 'codec'
(data (i32.const 2637945) "\73\61\66\65\49\6e\74\65\67\65\72") ;; 'safeInteger'
(data (i32.const 2637956) "\65\70\6f\63\68\4d\69\6c\6c\69\73\65\63\6f\6e\64\73") ;; 'epochMilliseconds'
(data (i32.const 2637973) "\73\71\6c\69\74\65\42\6f\6f\6c\65\61\6e") ;; 'sqliteBoolean'
(data (i32.const 2637986) "\6a\73\6f\6e\54\65\78\74") ;; 'jsonText'
(data (i32.const 2637994) "\71\75\65\72\79\20\6f\76\65\72\72\69\64\65\20") ;; 'query override '
(data (i32.const 2638009) "\3a\20\70\61\72\61\6d\65\74\65\72\20") ;; ': parameter '
(data (i32.const 2638021) "\3a\20\72\65\73\75\6c\74\20\63\6f\6c\75\6d\6e\20") ;; ': result column '
(data (i32.const 2638037) "\20\64\6f\65\73\20\6e\6f\74\20\6d\61\74\63\68\20\63\6f\6d\70\69\6c\65\72\20\6d\65\74\61\64\61\74\61") ;; ' does not match compiler metadata'
(data (i32.const 2638070) "\6f\76\65\72\72\69\64\65\73") ;; 'overrides'
(data (i32.const 2638079) "\63\6f\6c\75\6d\6e") ;; 'column'
(data (i32.const 2638085) "\63\6f\6c\75\6d\6e\73") ;; 'columns'
(data (i32.const 2638092) "\64\62\5f\74\79\70\65") ;; 'db_type'
(data (i32.const 2638099) "\71\75\65\72\79\5f\6f\76\65\72\72\69\64\65\73") ;; 'query_overrides'
(data (i32.const 2638114) "\6d\61\70\70\69\6e\67") ;; 'mapping'
(data (i32.const 2638121) "\70\61\72\61\6d\65\74\65\72") ;; 'parameter'
(data (i32.const 2638130) "\6e\75\6c\6c\61\62\6c\65") ;; 'nullable'
(data (i32.const 2638138) "\71\75\65\72\79") ;; 'query'
(data (i32.const 2638143) "\2e") ;; '.'
(data (i32.const 2638144) "\6e\75\6c\6c\61\62\6c\65\5f\61\6c\6c") ;; 'nullable_all'
