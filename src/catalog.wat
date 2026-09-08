;; Catalog preparation rewrites only parsed records, after the protobuf pass
;; has consumed every input byte. Unlike the public Go library, this one-shot
;; command has no caller that can observe the request afterwards. Filling in a
;; table identity therefore needs no cloned Column or Identifier objects.

(func $reserve (param $scope i32) (param $p i32) (param $n i32)
  (if (i32.eqz (call $name_used (local.get $scope) (local.get $p) (local.get $n)))
    (then (call $name_take (local.get $scope) (local.get $p) (local.get $n)) drop drop)))

(func $reserve_helpers (param $scope i32)
  (if (call $emits_json) (then
    (call $reserve (local.get $scope) (call $c_json_value))
    (call $reserve (local.get $scope) (call $c_json_object))
    (call $reserve (local.get $scope) (call $c_json_array))))
  (if (call $emits_runtime) (then
    (call $reserve (local.get $scope) (call $c_codec_error))
    (call $reserve (local.get $scope) (call $c_codec_context)))))

(func $starts_with (param $p i32) (param $n i32) (param $q i32) (param $m i32) (result i32)
  (if (result i32) (i32.ge_u (local.get $n) (local.get $m))
    (then (call $eq (local.get $p) (local.get $m) (local.get $q) (local.get $m)))
    (else (i32.const 0))))

(func $table_key (param $id i32) (result i32 i32)
  (local $mark i32) (local $p i32) (local $n i32)
  (if (i32.eqz (local.get $id)) (then (return (call $c_empty))))
  (local.set $mark (global.get $txt_cursor))
  (call $text_append (call $text (local.get $id) (i32.const 1)))
  (call $text_byte (i32.const 46))
  (call $text (local.get $id) (i32.const 2)) (local.set $n) (local.set $p)
  (if (i32.eqz (local.get $n))
    (then (call $text (global.get $gen_catalog) (i32.const 2)) (local.set $n) (local.set $p)))
  (call $text_append (local.get $p) (local.get $n))
  (call $text_byte (i32.const 46))
  (call $text_append (call $text (local.get $id) (i32.const 3)))
  (local.get $mark) (i32.sub (global.get $txt_cursor) (local.get $mark)))

(func $catalog_schema (param $schema i32) (result i32)
  (i32.eqz (i32.or (call $eq (call $text (local.get $schema) (i32.const 2)) (call $c_pg_catalog))
                   (call $eq (call $text (local.get $schema) (i32.const 2)) (call $c_information_schema)))))

(func $build_models
  (local $schema i32) (local $table i32) (local $id i32) (local $column i32)
  (local $model i32) (local $scope i32) (local $p i32) (local $n i32) (local $tail i32) (local $count i32)
  (local.set $scope (call $name_scope))
  (call $reserve_helpers (local.get $scope))
  (local.set $schema (call $child (global.get $gen_catalog) (i32.const 4)))
  (block $schemas_done (loop $schemas
    (br_if $schemas_done (i32.eqz (local.get $schema)))
    (if (call $catalog_schema (local.get $schema)) (then
      (local.set $table (call $child (local.get $schema) (i32.const 3)))
      (block $tables_done (loop $tables
        (br_if $tables_done (i32.eqz (local.get $table)))
        (local.set $id (call $child (local.get $table) (i32.const 1)))
        (block $skip
          (br_if $skip (i32.eqz (local.get $id)))
          (br_if $skip (i32.and (i32.eq (global.get $gen_engine) (i32.const 1))
            (call $starts_with (call $text (local.get $id) (i32.const 3)) (call $c_sqlite_prefix))))
          (if (i32.eqz (call $text_len (local.get $id) (i32.const 2)))
            (then (call $set_text (call $slot (local.get $id) (i32.const 2)) (i32.const 0)
                                  (call $text (local.get $schema) (i32.const 2)))))
          (local.set $column (call $child (local.get $table) (i32.const 2)))
          (block $columns_done (loop $columns
            (br_if $columns_done (i32.eqz (local.get $column)))
            (if (call $child (local.get $column) (i32.const 14))
              (then (call $error (call $fmt2 (call $c_catalog_embed)
                (call $go_quote (call $text (local.get $column) (i32.const 1)))
                (call $go_quote (call $text (local.get $id) (i32.const 3)))))))
            (i32.store (call $slot (local.get $column) (i32.const 10)) (local.get $id))
            (local.set $column (call $next (local.get $column)))
            (br $columns)))
          (local.set $model (call $work_record (i32.const 101)))
          (i32.store offset=8 (local.get $model) (local.get $id))
          (i32.store offset=12 (local.get $model) (call $child (local.get $table) (i32.const 2)))
          (call $set_text (local.get $model) (i32.const 24) (call $table_key (local.get $id)))
          (if (local.get $tail)
            (then (i32.store offset=4 (local.get $tail) (local.get $model)))
            (else (global.set $gen_models (local.get $model))))
          (local.set $tail (local.get $model))
          (local.set $count (i32.add (local.get $count) (i32.const 1))))
        (local.set $table (call $next (local.get $table)))
        (br $tables)))))
    (local.set $schema (call $next (local.get $schema)))
    (br $schemas)))
  (global.set $ms_base (global.get $gen_models))
  (call $ms_sort (i32.const 0) (local.get $count) (i32.sub (i32.const 32) (i32.clz (local.get $count))))
  (local.set $model (global.get $gen_models))
  (block $done (loop $names
    (br_if $done (i32.eqz (local.get $model)))
    (local.set $id (i32.load offset=8 (local.get $model)))
    (call $singular (call $text (local.get $id) (i32.const 3))) (local.set $n) (local.set $p)
    (if (i32.and (i32.ne (call $text_len (local.get $id) (i32.const 2)) (i32.const 0))
                 (i32.eqz (call $eq (call $text (local.get $id) (i32.const 2))
                                   (call $text (global.get $gen_catalog) (i32.const 2)))))
      (then (call $concat (call $concat (call $text (local.get $id) (i32.const 2)) (call $c_underscore))
                          (local.get $p) (local.get $n)) (local.set $n) (local.set $p)))
    (call $set_text (local.get $model) (i32.const 16)
      (call $name_take (local.get $scope) (call $declaration_name (local.get $p) (local.get $n))))
    (local.set $model (call $next (local.get $model)))
    (br $names))))

(func $find_model (param $id i32) (result i32)
  (local $model i32) (local $p i32) (local $n i32) (local $mark i32) (local $found i32)
  (local.set $mark (call $text_mark))
  (call $table_key (local.get $id)) (local.set $n) (local.set $p)
  (local.set $model (global.get $gen_models))
  (block $done (loop $scan
    (br_if $done (i32.eqz (local.get $model)))
    ;; Go fills its byTable map in sorted order: a repeated key replaces the
    ;; earlier entry. Match that final assignment, including malformed input.
    (if (call $eq (local.get $p) (local.get $n) (call $get_text (local.get $model) (i32.const 24)))
      (then (local.set $found (local.get $model))))
    (local.set $model (call $next (local.get $model))) (br $scan)))
  ;; The key is scratch only. The returned model never refers to it.
  (call $text_reset (local.get $mark))
  (local.get $found))

(func $find_enum (param $schema i32) (param $schema_n i32) (param $name i32) (param $name_n i32) (result i32)
  (local $enum i32)
  (local.set $enum (global.get $gen_enums))
  (block $done (loop $scan
    (br_if $done (i32.eqz (local.get $enum)))
    (br_if $done (i32.and (call $eq (local.get $schema) (local.get $schema_n) (call $get_text (local.get $enum) (i32.const 8)))
                         (call $eq (local.get $name) (local.get $name_n) (call $get_text (local.get $enum) (i32.const 16)))))
    (local.set $enum (call $next (local.get $enum))) (br $scan)))
  (local.get $enum))

(func $enum_for_column (param $column i32) (result i32)
  (local $id i32) (local $p i32) (local $n i32) (local $i i32) (local $enum i32)
  (local.set $id (call $child (local.get $column) (i32.const 12)))
  (if (i32.eqz (local.get $id)) (then (return (i32.const 0))))
  (call $text (local.get $id) (i32.const 3)) (local.set $n) (local.set $p)
  (if (call $text_len (local.get $id) (i32.const 2))
    (then (return (call $find_enum (call $text (local.get $id) (i32.const 2)) (local.get $p) (local.get $n)))))
  (local.set $enum (call $find_enum (call $text (global.get $gen_catalog) (i32.const 2)) (local.get $p) (local.get $n)))
  (if (local.get $enum) (then (return (local.get $enum))))
  (local.set $i (local.get $n))
  (block $missing (loop $dot
    (br_if $missing (i32.eqz (local.get $i)))
    (local.set $i (i32.sub (local.get $i) (i32.const 1)))
    (if (i32.eq (i32.load8_u (i32.add (local.get $p) (local.get $i))) (i32.const 46))
      (then (return (call $find_enum (local.get $p) (local.get $i)
        (i32.add (local.get $p) (i32.add (local.get $i) (i32.const 1)))
        (i32.sub (i32.sub (local.get $n) (local.get $i)) (i32.const 1))))))
    (br $dot)))
  (i32.const 0))

(func $build_enums
  (local $scope i32) (local $seen i32) (local $model i32) (local $schema i32)
  (local $entry i32) (local $enum i32) (local $value i32) (local $next_value i32) (local $tail i32)
  (local $base i32) (local $base_n i32) (local $name i32) (local $name_n i32)
  (local $values i32) (local $values_n i32) (local $suffix i32) (local $previous i32) (local $at i32) (local $order i32)
  (local.set $scope (call $name_scope))
  (call $reserve_helpers (local.get $scope))
  (local.set $model (global.get $gen_models))
  (block $models_done (loop $models
    (br_if $models_done (i32.eqz (local.get $model)))
    (call $reserve (local.get $scope) (call $get_text (local.get $model) (i32.const 16)))
    (local.set $model (call $next (local.get $model))) (br $models)))
  (local.set $schema (call $child (global.get $gen_catalog) (i32.const 4)))
  (block $schemas_done (loop $schemas
    (br_if $schemas_done (i32.eqz (local.get $schema)))
    (if (call $catalog_schema (local.get $schema)) (then
      (local.set $entry (call $child (local.get $schema) (i32.const 4)))
      (block $entries_done (loop $entries
        (br_if $entries_done (i32.eqz (local.get $entry)))
        (if (i32.eqz (call $text_len (local.get $entry) (i32.const 1)))
          (then (call $error (call $fmt1 (call $c_missing_enum) (call $go_quote (call $text (local.get $schema) (i32.const 2)))))))
        (if (call $find_enum (call $text (local.get $schema) (i32.const 2)) (call $text (local.get $entry) (i32.const 1)))
          (then (call $error (call $fmt2 (call $c_duplicate_enum)
            (call $go_quote (call $text (local.get $entry) (i32.const 1)))
            (call $go_quote (call $text (local.get $schema) (i32.const 2)))))))
        (local.set $enum (call $work_record (i32.const 102)))
        (call $set_text (local.get $enum) (i32.const 8) (call $text (local.get $schema) (i32.const 2)))
        (call $set_text (local.get $enum) (i32.const 16) (call $text (local.get $entry) (i32.const 1)))
        ;; Compare the two schema/name components separately. A quoted SQL
        ;; identifier may contain dots or NUL; concatenating keys is ambiguous.
        (local.set $at (global.get $gen_enums)) (local.set $previous (i32.const 0))
        (block $position (loop $sort
          (br_if $position (i32.eqz (local.get $at)))
          (local.set $order (call $compare (call $get_text (local.get $enum) (i32.const 8)) (call $get_text (local.get $at) (i32.const 8))))
          (if (i32.eqz (local.get $order))
            (then (local.set $order (call $compare (call $get_text (local.get $enum) (i32.const 16)) (call $get_text (local.get $at) (i32.const 16))))))
          (br_if $position (i32.lt_s (local.get $order) (i32.const 0)))
          (local.set $previous (local.get $at)) (local.set $at (call $next (local.get $at))) (br $sort)))
        (i32.store offset=4 (local.get $enum) (local.get $at))
        (if (local.get $previous)
          (then (i32.store offset=4 (local.get $previous) (local.get $enum)))
          (else (global.set $gen_enums (local.get $enum))))
        ;; Deduplicate labels in place, preserving their first occurrence.
        (local.set $seen (call $name_scope_raw)) (local.set $tail (i32.const 0))
        (local.set $value (call $child (local.get $entry) (i32.const 2)))
        (block $values_done (loop $labels
          (br_if $values_done (i32.eqz (local.get $value)))
          (local.set $next_value (call $next (local.get $value)))
          (if (i32.eqz (call $name_used (local.get $seen) (call $text (local.get $value) (i32.const 1))))
            (then
              (call $reserve (local.get $seen) (call $text (local.get $value) (i32.const 1)))
              (if (local.get $tail)
                (then (i32.store offset=4 (local.get $tail) (local.get $value)))
                (else (i32.store offset=40 (local.get $enum) (local.get $value))))
              (local.set $tail (local.get $value)) (i32.store offset=4 (local.get $tail) (i32.const 0))))
          (local.set $value (local.get $next_value)) (br $labels)))
        (local.set $entry (call $next (local.get $entry))) (br $entries)))))
    (local.set $schema (call $next (local.get $schema))) (br $schemas)))
  (local.set $enum (global.get $gen_enums))
  (block $done (loop $names
    (br_if $done (i32.eqz (local.get $enum)))
    (call $get_text (local.get $enum) (i32.const 16)) (local.set $base_n) (local.set $base)
    (if (i32.and (i32.ne (i32.load offset=12 (local.get $enum)) (i32.const 0))
      (i32.eqz (call $eq (call $get_text (local.get $enum) (i32.const 8)) (call $text (global.get $gen_catalog) (i32.const 2)))))
      (then (call $concat (call $concat (call $get_text (local.get $enum) (i32.const 8)) (call $c_underscore))
                          (local.get $base) (local.get $base_n)) (local.set $base_n) (local.set $base)))
    (call $declaration_name (local.get $base) (local.get $base_n)) (local.set $base_n) (local.set $base)
    (local.set $name (local.get $base)) (local.set $name_n (local.get $base_n)) (local.set $suffix (i32.const 2))
    (block $available (loop $pair
      (call $concat (local.get $name) (local.get $name_n) (call $c_values_suffix)) (local.set $values_n) (local.set $values)
      (br_if $available (i32.eqz (i32.or (call $name_used (local.get $scope) (local.get $name) (local.get $name_n))
                                           (call $name_used (local.get $scope) (local.get $values) (local.get $values_n)))))
      (call $fmt2 (call $c_numeric_suffix) (local.get $base) (local.get $base_n) (call $decimal_i32 (local.get $suffix)))
      (local.set $name_n) (local.set $name)
      (local.set $suffix (i32.add (local.get $suffix) (i32.const 1))) (br $pair)))
    (call $reserve (local.get $scope) (local.get $name) (local.get $name_n))
    (call $reserve (local.get $scope) (local.get $values) (local.get $values_n))
    (call $set_text (local.get $enum) (i32.const 24) (local.get $name) (local.get $name_n))
    (call $set_text (local.get $enum) (i32.const 32) (local.get $values) (local.get $values_n))
    (local.set $enum (call $next (local.get $enum))) (br $names))))

(func $emit_enum (param $enum i32)
  (local $p i32) (local $n i32) (local $value i32) (local $first i32) (local $start i32)
  ;; Quote labels before assembling their joined text: quote itself writes into
  ;; the shared text region, so writing both at once would duplicate fragments.
  (local.set $value (i32.load offset=40 (local.get $enum)))
  (block $quoted (loop $quotes
    (br_if $quoted (i32.eqz (local.get $value)))
    (call $quote (call $text (local.get $value) (i32.const 1))) (local.set $n) (local.set $p)
    (call $set_text (local.get $value) (i32.const 16) (local.get $p) (local.get $n))
    (local.set $value (call $next (local.get $value))) (br $quotes)))
  (local.set $start (call $text_mark)) (local.set $first (i32.const 1))
  (local.set $value (i32.load offset=40 (local.get $enum)))
  (block $joined (loop $join
    (br_if $joined (i32.eqz (local.get $value)))
    (if (i32.eqz (local.get $first)) (then (call $text_append (call $c_comma))))
    (local.set $first (i32.const 0))
    (call $text_append (call $get_text (local.get $value) (i32.const 16)))
    (local.set $value (call $next (local.get $value))) (br $join)))
  (call $line (call $fmt2 (call $c_enum_values_line) (call $get_text (local.get $enum) (i32.const 32))
                          (local.get $start) (i32.sub (call $text_mark) (local.get $start))))
  (call $line (call $fmt2 (call $c_enum_type_line) (call $get_text (local.get $enum) (i32.const 24))
                          (call $get_text (local.get $enum) (i32.const 32))))
  (call $line (call $c_empty)))

;; Model order follows the Go 1.26.5 sort.Slice algorithm, including its order
;; for duplicate table keys. Equal keys can contain different columns, so a
;; stable sort would change observable output for malformed duplicate tables.
;;
;; Model records are contiguous and no model pointer has escaped this pass.
;; Swap only table/columns (offset8) and table-key (offset24) pairs. The linked
;; list stays in address order; identifiers and columns keep their own addresses.
;; This costs two i64 locals instead of a temporary array or a second model.
;; Algorithm adapted by hand from Go tag go1.26.5, src/sort/zsortfunc.go;
;; Copyright 2022 The Go Authors. See ../NOTICE for the BSD-style license.
(global $ms_base (mut i32) (i32.const 0))
(global $ms_swaps (mut i32) (i32.const 0))
(func $ms_record (param $i i32) (result i32)
  (i32.add (global.get $ms_base) (i32.shl (local.get $i) (i32.const 8))))
(func $ms_less (param $a i32) (param $b i32) (result i32)
  (i32.lt_s (call $compare (call $get_text (call $ms_record (local.get $a)) (i32.const 24))
                          (call $get_text (call $ms_record (local.get $b)) (i32.const 24))) (i32.const 0)))
(func $ms_swap (param $a i32) (param $b i32) (local $x i64) (local $y i64)
  (local.set $a (call $ms_record (local.get $a))) (local.set $b (call $ms_record (local.get $b)))
  (local.set $x (i64.load offset=8 (local.get $a))) (local.set $y (i64.load offset=24 (local.get $a)))
  (i64.store offset=8 (local.get $a) (i64.load offset=8 (local.get $b)))
  (i64.store offset=24 (local.get $a) (i64.load offset=24 (local.get $b)))
  (i64.store offset=8 (local.get $b) (local.get $x)) (i64.store offset=24 (local.get $b) (local.get $y)))
(func $ms_insertion (param $a i32) (param $b i32) (local $i i32) (local $j i32)
  (local.set $i (i32.add (local.get $a) (i32.const 1)))
  (block $done (loop $outer
    (br_if $done (i32.ge_s (local.get $i) (local.get $b)))
    (local.set $j (local.get $i))
    (block $placed (loop $inner
      (br_if $placed (i32.le_s (local.get $j) (local.get $a)))
      (br_if $placed (i32.eqz (call $ms_less (local.get $j) (i32.sub (local.get $j) (i32.const 1)))))
      (call $ms_swap (local.get $j) (i32.sub (local.get $j) (i32.const 1)))
      (local.set $j (i32.sub (local.get $j) (i32.const 1))) (br $inner)))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $outer))))
(func $ms_sift (param $root i32) (param $hi i32) (param $first i32) (local $child i32)
  (block $done (loop $more
    (local.set $child (i32.add (i32.mul (local.get $root) (i32.const 2)) (i32.const 1)))
    (br_if $done (i32.ge_s (local.get $child) (local.get $hi)))
    (if (i32.lt_s (i32.add (local.get $child) (i32.const 1)) (local.get $hi))
      (then (if (call $ms_less (i32.add (local.get $first) (local.get $child))
        (i32.add (i32.add (local.get $first) (local.get $child)) (i32.const 1)))
        (then (local.set $child (i32.add (local.get $child) (i32.const 1)))))))
    (br_if $done (i32.eqz (call $ms_less (i32.add (local.get $first) (local.get $root)) (i32.add (local.get $first) (local.get $child)))))
    (call $ms_swap (i32.add (local.get $first) (local.get $root)) (i32.add (local.get $first) (local.get $child)))
    (local.set $root (local.get $child)) (br $more))))
(func $ms_heap (param $a i32) (param $b i32) (local $hi i32) (local $i i32)
  (local.set $hi (i32.sub (local.get $b) (local.get $a)))
  (local.set $i (i32.div_s (i32.sub (local.get $hi) (i32.const 1)) (i32.const 2)))
  (block $built (loop $build
    (br_if $built (i32.lt_s (local.get $i) (i32.const 0)))
    (call $ms_sift (local.get $i) (local.get $hi) (local.get $a))
    (local.set $i (i32.sub (local.get $i) (i32.const 1))) (br $build)))
  (local.set $i (i32.sub (local.get $hi) (i32.const 1)))
  (block $done (loop $pop
    (br_if $done (i32.lt_s (local.get $i) (i32.const 0)))
    (call $ms_swap (local.get $a) (i32.add (local.get $a) (local.get $i)))
    (call $ms_sift (i32.const 0) (local.get $i) (local.get $a))
    (local.set $i (i32.sub (local.get $i) (i32.const 1))) (br $pop))))

;; The ordinary partition keeps the pivot at 'a' during scans. Equal elements
;; go on the right. The second result records whether any crossing swap ran.
(func $ms_partition (param $a i32) (param $b i32) (param $pivot i32) (result i32 i32)
  (local $i i32) (local $j i32) (local $already i32)
  (call $ms_swap (local.get $a) (local.get $pivot))
  (local.set $i (i32.add (local.get $a) (i32.const 1))) (local.set $j (i32.sub (local.get $b) (i32.const 1)))
  (local.set $already (i32.const 1))
  (block $done (loop $partition
    (block $left (loop $scan_left
      (br_if $left (i32.gt_s (local.get $i) (local.get $j)))
      (br_if $left (i32.eqz (call $ms_less (local.get $i) (local.get $a))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $scan_left)))
    (block $right (loop $scan_right
      (br_if $right (i32.gt_s (local.get $i) (local.get $j)))
      (br_if $right (call $ms_less (local.get $j) (local.get $a)))
      (local.set $j (i32.sub (local.get $j) (i32.const 1))) (br $scan_right)))
    (br_if $done (i32.gt_s (local.get $i) (local.get $j)))
    (call $ms_swap (local.get $i) (local.get $j)) (local.set $already (i32.const 0))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (local.set $j (i32.sub (local.get $j) (i32.const 1))) (br $partition)))
  (call $ms_swap (local.get $j) (local.get $a))
  (local.get $j) (local.get $already))
(func $ms_equal (param $a i32) (param $b i32) (param $pivot i32) (result i32)
  (local $i i32) (local $j i32)
  (call $ms_swap (local.get $a) (local.get $pivot))
  (local.set $i (i32.add (local.get $a) (i32.const 1))) (local.set $j (i32.sub (local.get $b) (i32.const 1)))
  (block $done (loop $partition
    (block $left (loop $scan_left
      (br_if $left (i32.gt_s (local.get $i) (local.get $j)))
      (br_if $left (call $ms_less (local.get $a) (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $scan_left)))
    (block $right (loop $scan_right
      (br_if $right (i32.gt_s (local.get $i) (local.get $j)))
      (br_if $right (i32.eqz (call $ms_less (local.get $a) (local.get $j))))
      (local.set $j (i32.sub (local.get $j) (i32.const 1))) (br $scan_right)))
    (br_if $done (i32.gt_s (local.get $i) (local.get $j)))
    (call $ms_swap (local.get $i) (local.get $j))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (local.set $j (i32.sub (local.get $j) (i32.const 1))) (br $partition)))
  (local.get $i))

(func $ms_partial (param $a i32) (param $b i32) (result i32)
  (local $i i32) (local $j i32) (local $step i32)
  (local.set $i (i32.add (local.get $a) (i32.const 1)))
  (block $failed (loop $steps
    (br_if $failed (i32.eq (local.get $step) (i32.const 5)))
    (block $disorder (loop $ordered
      (br_if $disorder (i32.ge_s (local.get $i) (local.get $b)))
      (br_if $disorder (call $ms_less (local.get $i) (i32.sub (local.get $i) (i32.const 1))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $ordered)))
    (if (i32.eq (local.get $i) (local.get $b)) (then (return (i32.const 1))))
    (br_if $failed (i32.lt_s (i32.sub (local.get $b) (local.get $a)) (i32.const 50)))
    (call $ms_swap (local.get $i) (i32.sub (local.get $i) (i32.const 1)))
    (if (i32.ge_s (i32.sub (local.get $i) (local.get $a)) (i32.const 2)) (then
      (local.set $j (i32.sub (local.get $i) (i32.const 1)))
      (block $left_done (loop $left
        (br_if $left_done (i32.lt_s (local.get $j) (i32.const 1)))
        (br_if $left_done (i32.eqz (call $ms_less (local.get $j) (i32.sub (local.get $j) (i32.const 1)))))
        (call $ms_swap (local.get $j) (i32.sub (local.get $j) (i32.const 1)))
        (local.set $j (i32.sub (local.get $j) (i32.const 1))) (br $left)))))
    (if (i32.ge_s (i32.sub (local.get $b) (local.get $i)) (i32.const 2)) (then
      (local.set $j (i32.add (local.get $i) (i32.const 1)))
      (block $right_done (loop $right
        (br_if $right_done (i32.ge_s (local.get $j) (local.get $b)))
        (br_if $right_done (i32.eqz (call $ms_less (local.get $j) (i32.sub (local.get $j) (i32.const 1)))))
        (call $ms_swap (local.get $j) (i32.sub (local.get $j) (i32.const 1)))
        (local.set $j (i32.add (local.get $j) (i32.const 1))) (br $right)))))
    (local.set $step (i32.add (local.get $step) (i32.const 1))) (br $steps)))
  (i32.const 0))

(func $ms_median (param $a i32) (param $b i32) (param $c i32) (result i32) (local $tmp i32)
  (if (call $ms_less (local.get $b) (local.get $a)) (then
    (global.set $ms_swaps (i32.add (global.get $ms_swaps) (i32.const 1)))
    (local.set $tmp (local.get $a)) (local.set $a (local.get $b)) (local.set $b (local.get $tmp))))
  (if (call $ms_less (local.get $c) (local.get $b)) (then
    (global.set $ms_swaps (i32.add (global.get $ms_swaps) (i32.const 1)))
    (local.set $tmp (local.get $b)) (local.set $b (local.get $c)) (local.set $c (local.get $tmp))))
  (if (call $ms_less (local.get $b) (local.get $a)) (then
    (global.set $ms_swaps (i32.add (global.get $ms_swaps) (i32.const 1)))
    (local.set $b (local.get $a))))
  (local.get $b))
(func $ms_adjacent (param $a i32) (result i32)
  (call $ms_median (i32.sub (local.get $a) (i32.const 1)) (local.get $a) (i32.add (local.get $a) (i32.const 1))))
(func $ms_pivot (param $a i32) (param $b i32) (result i32 i32)
  (local $n i32) (local $q i32) (local $i i32) (local $j i32) (local $k i32)
  (local.set $n (i32.sub (local.get $b) (local.get $a)))
  (local.set $q (i32.div_u (local.get $n) (i32.const 4)))
  (local.set $i (i32.add (local.get $a) (local.get $q)))
  (local.set $j (i32.add (local.get $i) (local.get $q)))
  (local.set $k (i32.add (local.get $j) (local.get $q)))
  (global.set $ms_swaps (i32.const 0))
  (if (i32.ge_s (local.get $n) (i32.const 8)) (then
    (if (i32.ge_s (local.get $n) (i32.const 50)) (then
      (local.set $i (call $ms_adjacent (local.get $i)))
      (local.set $j (call $ms_adjacent (local.get $j)))
      (local.set $k (call $ms_adjacent (local.get $k)))))
    (local.set $j (call $ms_median (local.get $i) (local.get $j) (local.get $k)))))
  (local.get $j)
  (select (i32.const 1) (select (i32.const 2) (i32.const 0) (i32.eq (global.get $ms_swaps) (i32.const 12))) (i32.eqz (global.get $ms_swaps))))
(func $ms_reverse (param $a i32) (param $b i32)
  (local.set $b (i32.sub (local.get $b) (i32.const 1)))
  (block $done (loop $swap
    (br_if $done (i32.ge_s (local.get $a) (local.get $b)))
    (call $ms_swap (local.get $a) (local.get $b))
    (local.set $a (i32.add (local.get $a) (i32.const 1))) (local.set $b (i32.sub (local.get $b) (i32.const 1))) (br $swap))))
(func $ms_break_patterns (param $a i32) (param $b i32)
  (local $length i32) (local $mask i32) (local $idx i32) (local $end i32) (local $other i32) (local $random i64)
  (local.set $length (i32.sub (local.get $b) (local.get $a)))
  (if (i32.lt_s (local.get $length) (i32.const 8)) (then (return)))
  (local.set $random (i64.extend_i32_u (local.get $length)))
  (local.set $mask (i32.sub (i32.shl (i32.const 1) (i32.sub (i32.const 32) (i32.clz (local.get $length)))) (i32.const 1)))
  (local.set $idx (i32.sub (i32.add (local.get $a) (i32.mul (i32.div_u (local.get $length) (i32.const 4)) (i32.const 2))) (i32.const 1)))
  (local.set $end (i32.add (local.get $idx) (i32.const 3)))
  (loop $scatter
    (local.set $random (i64.xor (local.get $random) (i64.shl (local.get $random) (i64.const 13))))
    (local.set $random (i64.xor (local.get $random) (i64.shr_u (local.get $random) (i64.const 7))))
    (local.set $random (i64.xor (local.get $random) (i64.shl (local.get $random) (i64.const 17))))
    (local.set $other (i32.and (i32.wrap_i64 (local.get $random)) (local.get $mask)))
    (if (i32.ge_u (local.get $other) (local.get $length)) (then (local.set $other (i32.sub (local.get $other) (local.get $length)))))
    (call $ms_swap (local.get $idx) (i32.add (local.get $a) (local.get $other)))
    (local.set $idx (i32.add (local.get $idx) (i32.const 1)))
    (br_if $scatter (i32.lt_s (local.get $idx) (local.get $end)))))

;; Recurse only into the smaller partition, iterating over the larger one.
;; Thus the host call stack is bounded by log2(model_count), at most sixteen
;; levels within the fixed protobuf record count. Bad pivots use heap sort.
(func $ms_sort (param $a i32) (param $b i32) (param $limit i32)
  (local $balanced i32) (local $partitioned i32) (local $length i32)
  (local $pivot i32) (local $hint i32) (local $mid i32) (local $left i32) (local $right i32) (local $threshold i32)
  (local.set $balanced (i32.const 1)) (local.set $partitioned (i32.const 1))
  (loop $sort
    (local.set $length (i32.sub (local.get $b) (local.get $a)))
    (if (i32.le_s (local.get $length) (i32.const 12))
      (then (call $ms_insertion (local.get $a) (local.get $b)) (return)))
    (if (i32.eqz (local.get $limit))
      (then (call $ms_heap (local.get $a) (local.get $b)) (return)))
    (if (i32.eqz (local.get $balanced)) (then
      (call $ms_break_patterns (local.get $a) (local.get $b))
      (local.set $limit (i32.sub (local.get $limit) (i32.const 1)))))
    (call $ms_pivot (local.get $a) (local.get $b)) (local.set $hint) (local.set $pivot)
    (if (i32.eq (local.get $hint) (i32.const 2)) (then
      (call $ms_reverse (local.get $a) (local.get $b))
      (local.set $pivot (i32.sub (i32.sub (local.get $b) (i32.const 1)) (i32.sub (local.get $pivot) (local.get $a))))
      (local.set $hint (i32.const 1))))
    (if (i32.and (i32.and (local.get $balanced) (local.get $partitioned)) (i32.eq (local.get $hint) (i32.const 1)))
      (then (if (call $ms_partial (local.get $a) (local.get $b)) (then (return)))))
    (if (i32.gt_s (local.get $a) (i32.const 0)) (then
      (if (i32.eqz (call $ms_less (i32.sub (local.get $a) (i32.const 1)) (local.get $pivot)))
        (then (local.set $a (call $ms_equal (local.get $a) (local.get $b) (local.get $pivot))) (br $sort)))))
    (call $ms_partition (local.get $a) (local.get $b) (local.get $pivot)) (local.set $partitioned) (local.set $mid)
    (local.set $left (i32.sub (local.get $mid) (local.get $a)))
    (local.set $right (i32.sub (local.get $b) (local.get $mid)))
    (local.set $threshold (i32.div_u (local.get $length) (i32.const 8)))
    (if (i32.lt_s (local.get $left) (local.get $right))
      (then
        (local.set $balanced (i32.ge_s (local.get $left) (local.get $threshold)))
        (call $ms_sort (local.get $a) (local.get $mid) (local.get $limit))
        (local.set $a (i32.add (local.get $mid) (i32.const 1))))
      (else
        (local.set $balanced (i32.ge_s (local.get $right) (local.get $threshold)))
        (call $ms_sort (i32.add (local.get $mid) (i32.const 1)) (local.get $b) (local.get $limit))
        (local.set $b (local.get $mid))))
    (br $sort)))
