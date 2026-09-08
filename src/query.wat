;; Query planning is separate from printing so public declarations claim names
;; before imports and private helpers. A plan is one fixed record (kind 106).
;; Parameter and query lists can reuse their decoded next links: protobuf has
;; finished, and nobody needs their original order after the stable sort.
(func $query_command (param $q i32) (result i32)
  (if (call $eq (call $text (local.get $q) (i32.const 3)) (call $c_cmd_one)) (then (return (i32.const 1))))
  (if (call $eq (call $text (local.get $q) (i32.const 3)) (call $c_cmd_many)) (then (return (i32.const 2))))
  (if (call $eq (call $text (local.get $q) (i32.const 3)) (call $c_cmd_exec)) (then (return (i32.const 3))))
  (if (call $eq (call $text (local.get $q) (i32.const 3)) (call $c_cmd_execrows)) (then (return (i32.const 4))))
  (if (call $eq (call $text (local.get $q) (i32.const 3)) (call $c_cmd_execlastid)) (then (return (i32.const 5))))
  (if (call $eq (call $text (local.get $q) (i32.const 3)) (call $c_cmd_execresult)) (then (return (i32.const 6))))
  (call $error (call $fmt1 (call $c_unsupported_cmd) (call $go_quote (call $text (local.get $q) (i32.const 3))))) unreachable)

(func $binding_used (param $head i32) (param $number i32) (result i32)
  (block $done (loop $parts
    (br_if $done (i32.eqz (local.get $head)))
    (if (i32.eq (i32.load offset=16 (local.get $head)) (local.get $number)) (then (return (i32.const 1))))
    (local.set $head (call $next (local.get $head))) (br $parts))) (i32.const 0))

(func $plan_query (param $m i32) (param $q i32) (result i32)
  (local $plan i32) (local $cmd i32) (local $base i32) (local $base_n i32) (local $scope i32)
  (local $param i32) (local $next i32) (local $sorted i32) (local $at i32) (local $prev i32)
  (local $number i32) (local $last_number i32) (local $field i32) (local $tail i32) (local $names i32)
  (local.set $cmd (call $query_command (local.get $q)))
  (if (i32.and (i32.eq (global.get $gen_engine) (i32.const 2)) (i32.eq (local.get $cmd) (i32.const 5)))
    (then (call $error (call $c_pg_insert_id))))
  (call $declaration_name (call $text (local.get $q) (i32.const 2))) (local.set $base_n) (local.set $base)
  (if (i32.and (i32.eqz (global.get $opt_mode_native)) (call $identifier (call $text (local.get $q) (i32.const 2))))
    (then (call $text (local.get $q) (i32.const 2)) (local.set $base_n) (local.set $base)))
  (local.set $plan (call $work_record (i32.const 106)))
  (i32.store offset=8 (local.get $plan) (local.get $q))
  (i32.store offset=12 (local.get $plan) (local.get $cmd))
  (local.set $scope (i32.load offset=16 (local.get $m)))
  (call $set_text (local.get $plan) (i32.const 16) (call $name_take (local.get $scope) (call $lower_first (local.get $base) (local.get $base_n))))
  (call $set_text (local.get $plan) (i32.const 24) (call $name_take (local.get $scope) (call $concat (call $get_text (local.get $plan) (i32.const 16)) (call $c_query_suffix))))
  (local.set $param (call $child (local.get $q) (i32.const 5)))
  (if (local.get $param) (then
    (call $set_text (local.get $plan) (i32.const 32) (call $name_take (local.get $scope) (call $concat (local.get $base) (local.get $base_n) (call $c_args_suffix))))))
  (if (i32.le_u (local.get $cmd) (i32.const 2)) (then
    (if (i32.eqz (call $child (local.get $q) (i32.const 4)))
      (then (call $error (call $fmt1 (call $c_need_columns) (call $text (local.get $q) (i32.const 3))))))
    (call $set_text (local.get $plan) (i32.const 40) (call $name_take (local.get $scope) (call $concat (local.get $base) (local.get $base_n) (call $c_row_suffix))))))
  ;; Validate all metadata before resolving any types, as the Go reference does.
  (block $sorted_all (loop $sort
    (br_if $sorted_all (i32.eqz (local.get $param)))
    (local.set $next (call $next (local.get $param)))
    (local.set $number (call $number (local.get $param) (i32.const 1)))
    (if (i32.or (i32.lt_s (local.get $number) (i32.const 1)) (i32.eqz (call $child (local.get $param) (i32.const 2))))
      (then (call $error (call $c_invalid_param))))
    (local.set $at (local.get $sorted)) (local.set $prev (i32.const 0))
    (block $position (loop $scan
      (br_if $position (i32.eqz (local.get $at)))
      (br_if $position (i32.lt_s (local.get $number) (call $number (local.get $at) (i32.const 1))))
      (local.set $prev (local.get $at)) (local.set $at (call $next (local.get $at))) (br $scan)))
    (i32.store offset=4 (local.get $param) (local.get $at))
    (if (local.get $prev) (then (i32.store offset=4 (local.get $prev) (local.get $param))) (else (local.set $sorted (local.get $param))))
    (local.set $param (local.get $next)) (br $sort)))
  (local.set $names (call $name_scope_raw)) (local.set $param (local.get $sorted))
  (block $params_done (loop $params
    (br_if $params_done (i32.eqz (local.get $param)))
    (local.set $number (call $number (local.get $param) (i32.const 1)))
    (if (i32.eq (local.get $number) (local.get $last_number))
      (then (call $error (call $fmt1 (call $c_duplicate_param) (call $decimal_i32 (local.get $number))))))
    (local.set $last_number (local.get $number))
    (local.set $field (call $resolve_query_type (local.get $m) (local.get $q) (call $child (local.get $param) (i32.const 2)) (i32.const 0) (i32.const 1)))
    (call $set_text (local.get $field) (i32.const 16) (call $name_take (local.get $names)
      (call $field_name (call $text (call $child (local.get $param) (i32.const 2)) (i32.const 1))
        (call $fmt1 (call $c_arg_number) (call $decimal_i32 (local.get $number))))))
    (i32.store offset=64 (local.get $field) (local.get $number))
    (if (local.get $tail) (then (i32.store offset=4 (local.get $tail) (local.get $field)))
      (else (i32.store offset=48 (local.get $plan) (local.get $field))))
    (local.set $tail (local.get $field)) (local.set $param (call $next (local.get $param))) (br $params)))
  (if (i32.le_u (local.get $cmd) (i32.const 2)) (then
    (i32.store offset=52 (local.get $plan) (call $make_fields (local.get $m) (call $embed_columns (local.get $q)) (local.get $q) (i32.const 0)))))
  (call $plan_bindings (local.get $plan))
  (local.set $field (i32.load offset=48 (local.get $plan)))
  (block $all_used (loop $used
    (br_if $all_used (i32.eqz (local.get $field)))
    (if (i32.eqz (call $binding_used (i32.load offset=56 (local.get $plan)) (i32.load offset=64 (local.get $field))))
      (then (call $error (call $fmt1 (call $c_unused_param) (call $decimal_i32 (i32.load offset=64 (local.get $field)))))))
    (local.set $field (call $next (local.get $field))) (br $used)))
  (local.get $plan))

(func $database_type (param $m i32) (result i32 i32)
  (if (result i32 i32) (i32.eq (global.get $opt_driver) (i32.const 5))
    (then (call $module_import (local.get $m) (call $opt_driver_specifier) (call $c_database) (i32.const 1)))
    (else (call $runtime_import (local.get $m) (call $c_database) (i32.const 1)))))

(func $query_header (param $q i32) (result i32 i32)
  (call $fmt2 (call $c_sql_header) (call $text (local.get $q) (i32.const 2)) (call $text (local.get $q) (i32.const 3))))

;; The expression for each dynamic SQL part is saved on that part's record at
;; offset 40. Temporary helper calls may append text, so joining occurs only
;; after every fragment is complete. This avoids pointers into unfinished text.
(func $emit_bindings (param $m i32) (param $plan i32) (result i32 i32 i32 i32)
  (local $q i32) (local $field i32) (local $part i32) (local $number i32)
  (local $ctx i32) (local $ctx_n i32) (local $access i32) (local $access_n i32)
  (local $variable i32) (local $variable_n i32) (local $placeholder i32) (local $placeholder_n i32)
  (local $start i32) (local $count i32) (local $header i32) (local $header_n i32)
  (local.set $q (i32.load offset=8 (local.get $plan)))
  (local.set $field (i32.load offset=48 (local.get $plan)))
  (block $encoded (loop $params
    (br_if $encoded (i32.eqz (local.get $field)))
    (call $argument_codec_context (local.get $m) (local.get $q) (local.get $field)) (local.set $ctx_n) (local.set $ctx)
    (call $access (call $c_args) (call $get_text (local.get $field) (i32.const 16))) (local.set $access_n) (local.set $access)
    (if (i32.load offset=44 (local.get $field))
      (then (call $line (call $fmt5 (call $c_slice_encode)
        (call $decimal_i32 (i32.load offset=64 (local.get $field)))
        (call $runtime_import (local.get $m) (call $c_encode_slice) (i32.const 0))
        (local.get $access) (local.get $access_n)
        (call $encode_context (local.get $m) (local.get $field) (call $c_value) (local.get $ctx) (local.get $ctx_n))
        (local.get $ctx) (local.get $ctx_n))))
      (else (call $line (call $fmt2 (call $c_param_encode)
        (call $decimal_i32 (i32.load offset=64 (local.get $field)))
        (call $encode_context (local.get $m) (local.get $field) (local.get $access) (local.get $access_n) (local.get $ctx) (local.get $ctx_n))))))
    ;; Offset 72 caches the immutable variable spelling, 96 tracks PG dedup.
    (call $set_text (local.get $field) (i32.const 72) (call $fmt1 (call $c_param_variable) (call $decimal_i32 (i32.load offset=64 (local.get $field)))))
    (i32.store offset=96 (local.get $field) (i32.const 0))
    (local.set $field (call $next (local.get $field))) (br $params)))
  (if (i32.eqz (i32.load offset=60 (local.get $plan))) (then
    (local.set $start (call $text_mark)) (call $text_byte (i32.const 91))
    (local.set $part (i32.load offset=56 (local.get $plan)))
    (block $bound (loop $parts
      (br_if $bound (i32.eqz (local.get $part)))
      (local.set $number (i32.load offset=16 (local.get $part)))
      (if (local.get $number) (then
        (local.set $field (call $bind_find_parameter (i32.load offset=48 (local.get $plan)) (local.get $number)))
        (if (i32.eqz (i32.and (i32.eq (global.get $gen_engine) (i32.const 2)) (i32.load offset=96 (local.get $field)))) (then
          (if (local.get $count) (then (call $text_append (call $c_comma))))
          (call $text_append (call $get_text (local.get $field) (i32.const 72)))
          (local.set $count (i32.add (local.get $count) (i32.const 1)))
          (i32.store offset=96 (local.get $field) (i32.const 1))))))
      (local.set $part (call $next (local.get $part))) (br $parts)))
    (call $text_byte (i32.const 93))
    (if (result i32 i32) (local.get $count)
      (then (local.get $start) (i32.sub (call $text_mark) (local.get $start))) (else (call $c_empty)))
    (call $get_text (local.get $plan) (i32.const 24)) return))
  (call $line (call $fmt1 (call $c_bindings_decl)
    (if (result i32 i32) (i32.eq (global.get $gen_engine) (i32.const 1))
      (then (call $runtime_import (local.get $m) (call $c_sqlite_value) (i32.const 1))) (else (call $c_unknown)))))
  (call $quote (call $query_header (local.get $q))) (local.set $header_n) (local.set $header)
  (local.set $part (i32.load offset=56 (local.get $plan)))
  (block $expanded (loop $parts
    (br_if $expanded (i32.eqz (local.get $part)))
    (local.set $number (i32.load offset=16 (local.get $part)))
    (if (i32.eqz (local.get $number))
      (then (call $set_text (local.get $part) (i32.const 40) (call $quote (call $get_text (local.get $part) (i32.const 8)))))
      (else
        (local.set $field (call $bind_find_parameter (i32.load offset=48 (local.get $plan)) (local.get $number)))
        (call $get_text (local.get $field) (i32.const 72)) (local.set $variable_n) (local.set $variable)
        (call $quote (if (result i32 i32) (i32.and (i32.eq (global.get $gen_engine) (i32.const 1))
          (i32.and (i32.eq (i32.load offset=32 (local.get $field)) (i32.const 2)) (i32.eqz (i32.load offset=60 (local.get $field)))))
          (then (call $c_real_placeholder)) (else (call $c_placeholder)))) (local.set $placeholder_n) (local.set $placeholder)
        (if (i32.load offset=44 (local.get $field))
          (then
            (call $set_text (local.get $part) (i32.const 40) (call $fmt3 (call $c_slice_sql) (local.get $variable) (local.get $variable_n) (local.get $variable) (local.get $variable_n) (local.get $placeholder) (local.get $placeholder_n)))
            (call $line (call $fmt1 (call $c_slice_push) (local.get $variable) (local.get $variable_n))))
          (else
            (call $set_text (local.get $part) (i32.const 40) (local.get $placeholder) (local.get $placeholder_n))
            (call $line (call $fmt1 (call $c_scalar_push) (local.get $variable) (local.get $variable_n)))))))
    (local.set $part (call $next (local.get $part))) (br $parts)))
  (local.set $start (call $text_mark)) (call $text_append (local.get $header) (local.get $header_n))
  (local.set $part (i32.load offset=56 (local.get $plan)))
  (block $joined (loop $join
    (br_if $joined (i32.eqz (local.get $part)))
    (call $text_append (call $c_plus)) (call $text_append (call $get_text (local.get $part) (i32.const 40)))
    (local.set $part (call $next (local.get $part))) (br $join)))
  (call $line (call $fmt1 (call $c_dynamic_sql) (local.get $start) (i32.sub (call $text_mark) (local.get $start))))
  (call $c_bindings_variable) (call $c_sql_variable))

(func $emit_query (param $m i32) (param $plan i32)
  (local $q i32) (local $cmd i32) (local $result i32) (local $result_n i32)
  (local $sync i32) (local $comments i32) (local $start i32)
  (local.set $q (i32.load offset=8 (local.get $plan))) (local.set $cmd (i32.load offset=12 (local.get $plan)))
  (if (i32.and (i32.eqz (global.get $opt_types_only)) (i32.or (global.get $opt_sql_const) (i32.eqz (i32.load offset=60 (local.get $plan))))) (then
    (call $line (call $fmt3 (call $c_sql_constant)
      (if (result i32 i32) (global.get $opt_sql_const) (then (call $c_export_space)) (else (call $c_empty)))
      (call $get_text (local.get $plan) (i32.const 24))
      (call $template (call $concat (call $query_header (local.get $q)) (call $get_text (local.get $plan) (i32.const 64))))))
    (call $line (call $c_empty))))
  (if (i32.load offset=36 (local.get $plan)) (then (call $emit_interface (local.get $m) (call $get_text (local.get $plan) (i32.const 32)) (i32.load offset=48 (local.get $plan)) (i32.const 1))))
  (if (i32.load offset=44 (local.get $plan)) (then (call $emit_interface (local.get $m) (call $get_text (local.get $plan) (i32.const 40)) (i32.load offset=52 (local.get $plan)) (i32.const 0))))
  (if (global.get $opt_types_only) (then return))
  (call $c_void) (local.set $result_n) (local.set $result)
  (if (i32.eq (local.get $cmd) (i32.const 1)) (then
    (call $concat (call $get_text (local.get $plan) (i32.const 40)) (call $concat (call $c_union) (call $null_text))) (local.set $result_n) (local.set $result)))
  (if (i32.eq (local.get $cmd) (i32.const 2)) (then
    (call $concat (call $get_text (local.get $plan) (i32.const 40)) (call $c_array_suffix)) (local.set $result_n) (local.set $result)))
  (if (i32.or (i32.eq (local.get $cmd) (i32.const 4)) (i32.eq (local.get $cmd) (i32.const 5))) (then
    (call $c_bigint) (local.set $result_n) (local.set $result)
    (if (i32.eq (local.get $cmd) (i32.const 5)) (then
      (if (i32.eq (global.get $opt_driver) (i32.const 3)) (then
        (call $c_number) (local.set $result_n) (local.set $result)
        (if (global.get $opt_mysql_support) (then
          (if (result i32 i32) (global.get $opt_mysql_strings) (then (call $c_string)) (else (call $c_number_string))) (local.set $result_n) (local.set $result)))))
      (if (i32.and (i32.eq (global.get $opt_driver) (i32.const 5)) (i32.eqz (global.get $opt_mode_native))) (then
        (call $c_number) (local.set $result_n) (local.set $result)))))))
  (if (i32.eq (local.get $cmd) (i32.const 6)) (then
    (call $runtime_import (local.get $m) (call $c_exec_result) (i32.const 1)) (local.set $result_n) (local.set $result)))
  (local.set $sync (i32.or (i32.eq (global.get $opt_driver) (i32.const 5))
    (i32.and (i32.eq (global.get $opt_driver) (i32.const 4)) (global.get $opt_mode_native))))
  (if (i32.eqz (local.get $sync)) (then (call $fmt1 (call $c_promise) (local.get $result) (local.get $result_n)) (local.set $result_n) (local.set $result)))
  (local.set $comments (call $child (local.get $q) (i32.const 6)))
  (if (local.get $comments) (then
    (local.set $start (call $text_mark)) (call $comment_begin)
    (loop $comments (call $comment_add (call $text (local.get $comments) (i32.const 1)))
      (local.set $comments (call $next (local.get $comments))) (br_if $comments (local.get $comments)))
    (call $comment_end) (call $line (local.get $start) (i32.sub (call $text_mark) (local.get $start)))))
  (call $line (call $fmt5 (call $c_function_line)
    (if (result i32 i32) (local.get $sync) (then (call $c_empty)) (else (call $c_async)))
    (call $get_text (local.get $plan) (i32.const 16)) (call $database_type (local.get $m))
    (if (result i32 i32) (i32.load offset=36 (local.get $plan))
      (then (call $fmt1 (call $c_args_decl) (call $get_text (local.get $plan) (i32.const 32)))) (else (call $c_empty)))
    (local.get $result) (local.get $result_n)))
  (call $indent)
  (call $emit_driver_query (local.get $m) (local.get $plan) (call $emit_bindings (local.get $m) (local.get $plan)))
  (call $dedent) (call $line (call $c_close_brace)) (call $line (call $c_empty)))
