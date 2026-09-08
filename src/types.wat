;; SQL value resolution and TypeScript conversion expressions, written in WAT.
;; Fields are fixed 256-byte work records of kind 105. They retain
;; pointers into compact input or the shared text buffer; no Go objects, maps,
;; regex engine, allocator, or host type resolver are used.
;;
;; Kind IDs:1integer,2number,3boolean,4date,5bytes,6json,7string,8unknown,
;; 9buffer,10point,11circle,12interval,13box,14number-or-string,15sqlite-integer.

(func $starts (param $p i32) (param $n i32) (param $q i32) (param $m i32) (result i32)
  (if (i32.lt_u (local.get $n) (local.get $m)) (then (return (i32.const 0))))
  (call $eq (local.get $p) (local.get $m) (local.get $q) (local.get $m)))
(func $prefix_list (param $list i32) (param $p i32) (param $n i32) (result i32)
  (local $end i32)
  (block $done (loop $loop
    (br_if $done (i32.eqz (i32.load8_u (local.get $list))))
    (local.set $end (local.get $list))
    (block $found (loop $word
      (br_if $found (i32.eqz (i32.load8_u (local.get $end))))
      (local.set $end (i32.add (local.get $end) (i32.const 1))) (br $word)))
    (if (call $starts (local.get $p) (local.get $n) (local.get $list) (i32.sub (local.get $end) (local.get $list))) (then (return (i32.const 1))))
    (local.set $list (i32.add (local.get $end) (i32.const 1))) (br $loop)))
  (i32.const 0))

;; Lowercase with Unicode15 rules, optionally remove pg_catalog., cut a size
;; suffix at '(', and join Unicode whitespace-separated words. Native SQLite
;; joins without spaces and intentionally does NOT trim a pg_catalog prefix.
(func $database_name (param $column i32) (param $compact i32) (param $trim_pg i32) (result i32 i32)
  (local $p i32) (local $end i32) (local $r i32) (local $lower i32) (local $start i32) (local $space i32)
  (call $text (call $child (local.get $column) (i32.const 12)) (i32.const 3)) local.set $end local.set $p
  (local.set $end (i32.add (local.get $p) (local.get $end))) (local.set $lower (global.get $txt_cursor))
  (block $lowered (loop $lower_loop
    (br_if $lowered (i32.eq (local.get $p) (local.get $end)))
    (call $rune (local.get $p) (local.get $end)) local.set $r local.set $p
    (call $put_rune (call $unicode_case (local.get $r) (i32.const 1))) (br $lower_loop)))
  (local.set $p (local.get $lower)) (local.set $end (global.get $txt_cursor))
  (if (local.get $trim_pg)
    (then (if (call $starts (local.get $p) (i32.sub (local.get $end) (local.get $p)) (call $t_pg_catalog_prefix))
      (then (local.set $p (i32.add (local.get $p) (i32.const 11)))))))
  (local.set $start (global.get $txt_cursor))
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $p) (local.get $end)))
    (call $rune (local.get $p) (local.get $end)) local.set $r local.set $p
    (br_if $done (i32.eq (local.get $r) (i32.const 40)))
    (if (i32.and (call $unicode_flags (local.get $r)) (i32.const 32))
      (then (local.set $space (i32.const 1)))
      (else
        (if (i32.and (i32.eqz (local.get $compact))
          (i32.and (local.get $space) (i32.gt_u (global.get $txt_cursor) (local.get $start))))
          (then (call $text_byte (i32.const 32))))
        (local.set $space (i32.const 0)) (call $put_rune (local.get $r))))
    (br $loop)))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))

(func $sqlite_native_type (param $column i32) (result i32 i32 i32)
  (local $p i32) (local $n i32)
  (call $database_name (local.get $column) (i32.const 1) (i32.const 0)) local.set $n local.set $p
  (if (call $word_list (call $tl_sqlite_int) (local.get $p) (local.get $n)) (then (return (i32.const 1) (call $t_bigint))))
  (if (call $word_list (call $tl_native_number) (local.get $p) (local.get $n)) (then (return (i32.const 2) (call $t_number))))
  (if (call $word_list (call $tl_bool) (local.get $p) (local.get $n)) (then (return (i32.const 3) (call $t_boolean))))
  (if (call $word_list (call $tl_date) (local.get $p) (local.get $n)) (then (return (i32.const 4) (call $t_date))))
  (if (call $eq (local.get $p) (local.get $n) (call $t_sql_blob)) (then (return (i32.const 5) (call $t_bytes))))
  (if (call $word_list (call $tl_json) (local.get $p) (local.get $n)) (then (return (i32.const 6) (call $t_bytes))))
  (if (i32.or (call $word_list (call $tl_native_text) (local.get $p) (local.get $n))
    (call $prefix_list (call $tl_native_text_prefix) (local.get $p) (local.get $n)))
    (then (return (i32.const 7) (call $t_string))))
  (i32.const 8) (call $t_unknown))
(func $sqlite_driver_type (param $column i32) (result i32 i32 i32)
  (local $p i32) (local $n i32) (local $deno i32)
  (call $database_name (local.get $column) (i32.const 1) (i32.const 1)) local.set $n local.set $p
  (local.set $deno (i32.eq (global.get $opt_driver) (i32.const 5)))
  (if (call $word_list (call $tl_sqlite_int) (local.get $p) (local.get $n))
    (then
      (if (local.get $deno) (then (return (i32.const 15) (call $t_number_bigint))))
      (return (i32.const 2) (call $t_number))))
  (if (i32.and (local.get $deno) (call $word_list (call $tl_numeric) (local.get $p) (local.get $n)))
    (then (return (i32.const 15) (call $t_number_bigint))))
  (if (call $word_list (call $tl_sqlite_number) (local.get $p) (local.get $n)) (then (return (i32.const 2) (call $t_number))))
  (if (call $word_list (call $tl_bool) (local.get $p) (local.get $n))
    (then
      (if (local.get $deno) (then (return (i32.const 2) (call $t_number))))
      (return (i32.const 3) (call $t_boolean))))
  (if (call $word_list (call $tl_date) (local.get $p) (local.get $n))
    (then
      (if (local.get $deno) (then (return (i32.const 7) (call $t_string))))
      (return (i32.const 4) (call $t_date))))
  (if (call $eq (local.get $p) (local.get $n) (call $t_sql_blob))
    (then
      (if (local.get $deno) (then (return (i32.const 5) (call $t_bytes))))
      (return (i32.const 5) (call $t_buffer))))
  (if (call $word_list (call $tl_sqlite_text) (local.get $p) (local.get $n)) (then (return (i32.const 7) (call $t_string))))
  (i32.const 8) (call $t_any))
(func $postgres_type (param $column i32) (result i32 i32 i32)
  (local $p i32) (local $n i32) (local $pg i32)
  (call $database_name (local.get $column) (i32.const 0) (i32.const 1)) local.set $n local.set $p
  (local.set $pg (i32.eq (global.get $opt_driver) (i32.const 1)))
  (if (call $word_list (call $tl_pg_number) (local.get $p) (local.get $n)) (then (return (i32.const 2) (call $t_number))))
  (if (call $word_list (call $tl_numeric) (local.get $p) (local.get $n))
    (then
      (if (i32.and (local.get $pg) (i32.or (call $number (local.get $column) (i32.const 4))
        (i32.or (i32.gt_s (call $number (local.get $column) (i32.const 17)) (i32.const 0)) (call $number (local.get $column) (i32.const 13)))))
        (then (return (i32.const 2) (call $t_number))))
      (return (i32.const 7) (call $t_string))))
  (if (call $word_list (call $tl_bool) (local.get $p) (local.get $n)) (then (return (i32.const 3) (call $t_boolean))))
  (if (call $eq (local.get $p) (local.get $n) (call $t_sql_bytea)) (then (return (i32.const 9) (call $t_buffer))))
  (if (call $word_list (call $tl_pg_date) (local.get $p) (local.get $n)) (then (return (i32.const 4) (call $t_date))))
  (if (call $word_list (call $tl_json) (local.get $p) (local.get $n)) (then (return (i32.const 6) (call $t_json))))
  (if (call $eq (local.get $p) (local.get $n) (call $t_sql_box)) (then (return (i32.const 13) (call $t_string))))
  (if (local.get $pg)
    (then
      (if (call $eq (local.get $p) (local.get $n) (call $t_sql_point)) (then (return (i32.const 10) (call $t_point))))
      (if (call $eq (local.get $p) (local.get $n) (call $t_sql_circle)) (then (return (i32.const 11) (call $t_circle))))
      (if (call $eq (local.get $p) (local.get $n) (call $t_sql_interval)) (then (return (i32.const 12) (call $t_interval))))))
  (if (i32.or (call $eq (local.get $p) (local.get $n) (call $t_sql_any)) (call $eq (local.get $p) (local.get $n) (call $t_sql_unknown)))
    (then (return (i32.const 8) (call $t_unknown))))
  (i32.const 7) (call $t_string))
(func $mysql_type (param $column i32) (result i32 i32 i32)
  (local $p i32) (local $n i32)
  (call $database_name (local.get $column) (i32.const 0) (i32.const 1)) local.set $n local.set $p
  (if (call $word_list (call $tl_mysql_bigint) (local.get $p) (local.get $n))
    (then
      (if (global.get $opt_mysql_support)
        (then
          (if (global.get $opt_mysql_strings) (then (return (i32.const 7) (call $t_string))))
          (return (i32.const 14) (call $t_number_string))))
      (return (i32.const 2) (call $t_number))))
  (if (call $word_list (call $tl_mysql_number) (local.get $p) (local.get $n)) (then (return (i32.const 2) (call $t_number))))
  (if (call $word_list (call $tl_mysql_buffer) (local.get $p) (local.get $n)) (then (return (i32.const 9) (call $t_buffer))))
  (if (call $word_list (call $tl_date) (local.get $p) (local.get $n)) (then (return (i32.const 4) (call $t_date))))
  (if (call $eq (local.get $p) (local.get $n) (call $t_sql_json)) (then (return (i32.const 6) (call $t_json))))
  (if (call $word_list (call $tl_mysql_string) (local.get $p) (local.get $n)) (then (return (i32.const 7) (call $t_string))))
  (i32.const 8) (call $t_unknown))
(func $sql_type (param $column i32) (result i32 i32 i32)
  (local $enum i32)
  (local.set $enum (call $enum_for_column (local.get $column)))
  (if (local.get $enum) (then (return (i32.const 7) (call $get_text (local.get $enum) (i32.const 24)))))
  (if (i32.eq (global.get $gen_engine) (i32.const 2)) (then (return (call $postgres_type (local.get $column)))))
  (if (i32.eq (global.get $gen_engine) (i32.const 3)) (then (return (call $mysql_type (local.get $column)))))
  (if (global.get $opt_mode_native) (then (return (call $sqlite_native_type (local.get $column)))))
  (call $sqlite_driver_type (local.get $column)))

(func $kind_text (param $kind i32) (result i32 i32)
  (if (i32.eq (local.get $kind) (i32.const 1)) (then (return (call $t_kind_1))))
  (if (i32.eq (local.get $kind) (i32.const 2)) (then (return (call $t_kind_2))))
  (if (i32.eq (local.get $kind) (i32.const 3)) (then (return (call $t_kind_3))))
  (if (i32.eq (local.get $kind) (i32.const 4)) (then (return (call $t_kind_4))))
  (if (i32.eq (local.get $kind) (i32.const 5)) (then (return (call $t_kind_5))))
  (if (i32.eq (local.get $kind) (i32.const 6)) (then (return (call $t_kind_6))))
  (if (i32.eq (local.get $kind) (i32.const 7)) (then (return (call $t_kind_7))))
  (if (i32.eq (local.get $kind) (i32.const 9)) (then (return (call $t_kind_9))))
  (if (i32.eq (local.get $kind) (i32.const 10)) (then (return (call $t_kind_10))))
  (if (i32.eq (local.get $kind) (i32.const 11)) (then (return (call $t_kind_11))))
  (if (i32.eq (local.get $kind) (i32.const 12)) (then (return (call $t_kind_12))))
  (if (i32.eq (local.get $kind) (i32.const 13)) (then (return (call $t_kind_13))))
  (if (i32.eq (local.get $kind) (i32.const 14)) (then (return (call $t_kind_14))))
  (if (i32.eq (local.get $kind) (i32.const 15)) (then (return (call $t_kind_15))))
  (call $t_kind_8))
(func $bool_text (param $value i32) (result i32 i32)
  (if (local.get $value) (then (return (call $t_true)))) (call $t_false))
(func $null_text (result i32 i32)
  (if (global.get $opt_null_undefined) (then (return (call $t_undefined)))) (call $t_null))
(func $engine_text (result i32 i32)
  (if (i32.eq (global.get $gen_engine) (i32.const 2)) (then (return (call $t_postgresql))))
  (if (i32.eq (global.get $gen_engine) (i32.const 3)) (then (return (call $t_mysql))))
  (call $t_sqlite))

;; Type construction writes nested arrays directly. No intermediate array of
;; AST objects is needed. Each dimension can contain NULL even when the column
;; is NOT NULL; unknown absorbs the innermost null union, matching Go's printer.
(func $type_text_null (param $field i32) (param $missing i32) (param $missing_n i32) (result i32 i32)
  (local $p i32) (local $n i32) (local $dims i32) (local $unknown i32) (local $start i32)
  (local $i i32) (local $wrap i32) (local $nullable i32)
  (call $get_text (local.get $field) (i32.const 24)) local.set $n local.set $p
  (local.set $dims (i32.load offset=40 (local.get $field)))
  (local.set $unknown (call $eq (local.get $p) (local.get $n) (call $t_unknown)))
  (local.set $nullable (i32.and (i32.load offset=36 (local.get $field)) (i32.or (i32.eqz (local.get $unknown)) (i32.ne (local.get $dims) (i32.const 0)))))
  (local.set $wrap (i32.and (i32.eqz (call $type_precedence (local.get $p) (local.get $n)))
    (i32.or (i32.and (i32.ne (local.get $dims) (i32.const 0)) (i32.eqz (local.get $unknown))) (local.get $nullable))))
  (local.set $start (global.get $txt_cursor))
  (if (i32.load offset=44 (local.get $field)) (then (call $text_append (call $t_readonly_array))))
  (block $opened (loop $open
    (br_if $opened (i32.eq (local.get $i) (local.get $dims)))
    (call $text_append (call $t_readonly_array)) (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $open)))
  (if (local.get $wrap) (then (call $text_byte (i32.const 40))))
  (call $text_append (local.get $p) (local.get $n))
  (if (local.get $wrap) (then (call $text_byte (i32.const 41))))
  (local.set $i (i32.const 0))
  (block $closed (loop $close
    (br_if $closed (i32.eq (local.get $i) (local.get $dims)))
    (if (i32.or (i32.eqz (local.get $unknown)) (i32.gt_u (local.get $i) (i32.const 0)))
      (then (call $text_append (call $t_union)) (call $text_append (local.get $missing) (local.get $missing_n))))
    (call $text_byte (i32.const 62)) (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $close)))
  (if (local.get $nullable) (then (call $text_append (call $t_union)) (call $text_append (local.get $missing) (local.get $missing_n))))
  (if (i32.load offset=44 (local.get $field)) (then (call $text_byte (i32.const 62))))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))
(func $type_text (param $field i32) (result i32 i32)
  (call $type_text_null (local.get $field) (call $null_text)))
(func $argument_type_text (param $field i32) (result i32 i32)
  (local $token i32) (local $start i32) (local $n i32)
  (local.set $token (call $opt_get (global.get $opt_root) (call $t_optional_args)))
  (if (i32.and (i32.ne (call $json_kind (local.get $token)) (i32.const 5)) (i32.ne (call $json_kind (local.get $token)) (i32.const 6)))
    (then (return (call $type_text (local.get $field)))))
  (call $type_text_null (local.get $field) (call $t_null)) local.set $n local.set $start
  (if (i32.and (global.get $opt_optional_args)
    (i32.and (i32.load offset=36 (local.get $field)) (i32.eqz (i32.load offset=44 (local.get $field)))))
    (then
      (if (i32.or (i32.eqz (call $eq (call $get_text (local.get $field) (i32.const 24)) (call $t_unknown))) (i32.ne (i32.load offset=40 (local.get $field)) (i32.const 0)))
        (then (call $text_append (call $t_union)) (call $text_append (call $t_undefined))))))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))

;; Probe an import reference before registering an import. The parser changes
;; only type identifiers, never object keys or quoted strings. Unused imports
;; would fail the generated project's noUnusedLocals checks.
(func $import_value_ref (param $module i32) (param $field i32) (param $path i32) (param $path_n i32) (param $name i32) (param $name_n i32)
  (local $p i32) (local $n i32) (local $probe i32) (local $probe_n i32) (local $ok i32)
  (local $alias i32) (local $alias_n i32)
  (call $get_text (local.get $field) (i32.const 24)) local.set $n local.set $p
  (call $parse_type (local.get $p) (local.get $n) (local.get $name) (local.get $name_n)
    (call $concat (local.get $name) (local.get $name_n) (call $t_reference))) local.set $probe_n local.set $probe local.set $ok
  (if (i32.or (i32.eqz (local.get $ok)) (call $eq (local.get $p) (local.get $n) (local.get $probe) (local.get $probe_n))) (then (return)))
  (call $module_import (local.get $module) (local.get $path) (local.get $path_n) (local.get $name) (local.get $name_n) (i32.const 1)) local.set $alias_n local.set $alias
  (call $parse_type (local.get $p) (local.get $n) (local.get $name) (local.get $name_n) (local.get $alias) (local.get $alias_n)) local.set $n local.set $p drop
  (call $set_text (local.get $field) (i32.const 24) (local.get $p) (local.get $n)))
(func $import_sql_type (param $module i32) (param $field i32) (param $column i32)
  (local $enum i32) (local $kind i32)
  (local.set $enum (call $enum_for_column (local.get $column)))
  (if (local.get $enum)
    (then (call $import_value_ref (local.get $module) (local.get $field) (call $t_enums_path) (call $get_text (local.get $enum) (i32.const 24))) (return)))
  (local.set $kind (i32.load offset=32 (local.get $field)))
  (if (i32.or (i32.eq (local.get $kind) (i32.const 9)) (i32.eq (local.get $kind) (i32.const 5)))
    (then (call $import_value_ref (local.get $module) (local.get $field) (call $t_node_buffer) (call $t_buffer)) (return)))
  (if (i32.eq (local.get $kind) (i32.const 12))
    (then (call $import_value_ref (local.get $module) (local.get $field) (call $t_pg_interval) (call $t_interval)) (return)))
  (if (i32.and (i32.eq (local.get $kind) (i32.const 6)) (i32.ne (global.get $gen_engine) (i32.const 1)))
    (then (call $import_value_ref (local.get $module) (local.get $field) (call $t_json_path) (call $t_json)))))
(func $checked_kind (param $p i32) (param $n i32) (result i32)
  (if (call $eq (local.get $p) (local.get $n) (call $t_string)) (then (return (i32.const 7))))
  (if (call $eq (local.get $p) (local.get $n) (call $t_number)) (then (return (i32.const 2))))
  (if (call $eq (local.get $p) (local.get $n) (call $t_boolean)) (then (return (i32.const 3))))
  (if (call $eq (local.get $p) (local.get $n) (call $t_date)) (then (return (i32.const 4))))
  (if (call $eq (local.get $p) (local.get $n) (call $t_bytes)) (then (return (i32.const 5))))
  (if (i32.and (i32.eq (global.get $gen_engine) (i32.const 1)) (call $eq (local.get $p) (local.get $n) (call $t_bigint))) (then (return (i32.const 1))))
  (i32.const 0))
(func $preset_type (param $token i32) (result i32 i32)
  (local $p i32) (local $n i32)
  (call $override_preset (local.get $token)) local.set $n local.set $p
  (if (call $eq (local.get $p) (local.get $n) (call $t_safe_integer)) (then (return (call $t_number))))
  (if (call $eq (local.get $p) (local.get $n) (call $t_epoch_milliseconds)) (then (return (call $t_date))))
  (if (call $eq (local.get $p) (local.get $n) (call $t_sqlite_boolean)) (then (return (call $t_boolean))))
  (i32.const 0) (i32.const 0))
(func $type_compatible (param $module i32) (param $field i32) (param $base i32) (param $base_n i32) (param $p i32) (param $n i32)
  (i32.store offset=24 (local.get $module) (i32.const 1))
  (call $set_text (local.get $field) (i32.const 24)
    (call $fmt2 (call $t_compatible) (local.get $base) (local.get $base_n) (local.get $p) (local.get $n))))

;; Resolution validates metadata before making records. A query override can
;; supply a checked primitive for a compiler-unknown expression; a schema
;; override retains the stricter requirement for an explicit codec.
(func $resolve_type (param $module i32) (param $column i32) (param $force_nullable i32) (param $override i32) (param $query_override i32) (result i32)
  (local $field i32) (local $dims i32) (local $kind i32) (local $base i32) (local $base_n i32)
  (local $p i32) (local $n i32) (local $ok i32) (local $name i32) (local $name_n i32)
  (local $preset i32) (local $preset_n i32) (local $checked i32)
  (local.set $dims (call $number (local.get $column) (i32.const 17)))
  (if (i32.gt_u (local.get $dims) (i32.const 6))
    (then (call $error (call $fmt2 (call $t_dimensions_error) (call $go_quote (call $text (local.get $column) (i32.const 1))) (call $text_i32 (local.get $dims))))))
  (if (i32.and (i32.eq (global.get $gen_engine) (i32.const 2)) (call $number (local.get $column) (i32.const 13)))
    (then (call $error (call $fmt1 (call $t_pg_slice_error) (call $go_quote (call $text (local.get $column) (i32.const 1)))))))
  (call $sql_type (local.get $column)) local.set $base_n local.set $base local.set $kind
  (local.set $field (call $work_record (i32.const 105)))
  (i32.store offset=8 (local.get $field) (local.get $column))
  (call $set_text (local.get $field) (i32.const 24) (local.get $base) (local.get $base_n))
  (i32.store offset=32 (local.get $field) (local.get $kind))
  (i32.store offset=36 (local.get $field) (i32.or (i32.eqz (call $number (local.get $column) (i32.const 3))) (local.get $force_nullable)))
  (i32.store offset=44 (local.get $field) (call $number (local.get $column) (i32.const 13)))
  (if (i32.or (call $number (local.get $column) (i32.const 4)) (i32.ne (local.get $dims) (i32.const 0)))
    (then
      (if (i32.eq (global.get $gen_engine) (i32.const 2))
        (then
          (i32.store offset=40 (local.get $field) (select (local.get $dims) (i32.const 1) (local.get $dims)))
          (i32.store offset=44 (local.get $field) (i32.const 0)))
        (else (if (i32.eqz (call $number (local.get $column) (i32.const 13)))
          (then (call $error (call $fmt2 (call $t_array_error) (call $engine_text) (call $go_quote (call $text (local.get $column) (i32.const 1)))))))))))
  (if (i32.lt_s (local.get $override) (i32.const 0)) (then (local.set $override (call $matching_override (local.get $column)))))
  (if (i32.ge_s (local.get $override) (i32.const 0))
    (then
      (call $parse_type (call $override_type (local.get $override)) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)) local.set $n local.set $p local.set $ok
      (if (i32.eqz (local.get $ok))
        (then (call $error (call $fmt2 (call $t_override_error) (call $go_quote (call $text (local.get $column) (i32.const 1))) (global.get $type_error_p) (global.get $type_error_n)))))
      (call $set_text (local.get $field) (i32.const 24) (local.get $p) (local.get $n))
      (call $override_import_name (local.get $override)) local.set $name_n local.set $name
      (if (local.get $name_n)
        (then
          (if (i32.eqz (call $identifier (local.get $name) (local.get $name_n)))
            (then (call $error (call $fmt1 (call $t_import_error) (call $go_quote (local.get $name) (local.get $name_n))))))
          (call $import_value_ref (local.get $module) (local.get $field) (call $override_import_path (local.get $override)) (local.get $name) (local.get $name_n))
          (call $get_text (local.get $field) (i32.const 24)) local.set $n local.set $p))
      (call $preset_type (local.get $override)) local.set $preset_n local.set $preset
      (if (i32.and (i32.ne (local.get $preset_n) (i32.const 0)) (i32.eqz (call $eq (local.get $preset) (local.get $preset_n) (local.get $p) (local.get $n))))
        (then (call $type_compatible (local.get $module) (local.get $field) (local.get $preset) (local.get $preset_n) (local.get $p) (local.get $n))))
      (call $override_codec_name (local.get $override)) local.set $name_n local.set $name
      (if (i32.and (local.get $query_override) (i32.and (i32.eqz (local.get $name_n))
        (i32.or (call $eq (local.get $base) (local.get $base_n) (call $t_unknown)) (call $eq (local.get $base) (local.get $base_n) (call $t_any)))))
        (then
          (local.set $checked (call $checked_kind (local.get $p) (local.get $n)))
          (if (local.get $checked)
            (then (local.set $kind (local.get $checked)) (local.set $base (local.get $p)) (local.set $base_n (local.get $n))
              (i32.store offset=32 (local.get $field) (local.get $kind))))))
      (if (local.get $name_n)
        (then
          (if (i32.eqz (call $identifier (local.get $name) (local.get $name_n)))
            (then (call $error (call $fmt1 (call $t_codec_error) (call $go_quote (local.get $name) (local.get $name_n))))))
          (call $set_text (local.get $field) (i32.const 48) (call $override_codec_path (local.get $override)))
          (call $set_text (local.get $field) (i32.const 56) (local.get $name) (local.get $name_n)))
        (else
          (if (i32.and (i32.eqz (call $eq (local.get $p) (local.get $n) (local.get $base) (local.get $base_n)))
            (i32.or (i32.ne (local.get $kind) (i32.const 6)) (i32.eq (global.get $gen_engine) (i32.const 1))))
            (then
              (if (i32.or (call $word_list (call $tl_primitive) (local.get $p) (local.get $n))
                (i32.or (call $eq (local.get $base) (local.get $base_n) (call $t_unknown)) (call $eq (local.get $base) (local.get $base_n) (call $t_any))))
                (then (call $error (call $fmt3 (call $t_requires_codec) (call $go_quote (call $text (local.get $column) (i32.const 1))) (local.get $base) (local.get $base_n) (local.get $p) (local.get $n)))))
              (call $type_compatible (local.get $module) (local.get $field) (local.get $base) (local.get $base_n) (local.get $p) (local.get $n))))))))
  (call $import_sql_type (local.get $module) (local.get $field) (local.get $column))
  (local.get $field))

;; Changing a query's nullability must not mutate schema columns or another
;; query. A single fixed record copy retains all source text pointers.
(func $column_nullable (param $column i32) (param $nullable i32) (result i32)
  (local $copy i32)
  (if (i32.lt_s (local.get $nullable) (i32.const 0)) (then (return (local.get $column))))
  (local.set $copy (call $work_record (i32.const 12)))
  (memory.copy (local.get $copy) (local.get $column) (i32.const 256))
  (i64.store (call $slot (local.get $copy) (i32.const 3)) (i64.extend_i32_u (i32.eqz (local.get $nullable))))
  (local.get $copy))
(func $resolve_query_type (param $module i32) (param $query i32) (param $column i32) (param $force_nullable i32) (param $parameter i32) (result i32)
  (local $override i32) (local $nullable i32)
  (if (i32.or (i32.eqz (local.get $query)) (i32.eqz (local.get $column)))
    (then (return (call $resolve_type (local.get $module) (local.get $column) (local.get $force_nullable) (i32.const -1) (i32.const 0)))))
  (call $query_override (local.get $query) (local.get $column) (local.get $parameter)) local.set $nullable local.set $override
  (call $resolve_type (local.get $module) (call $column_nullable (local.get $column) (local.get $nullable))
    (local.get $force_nullable) (local.get $override) (i32.ge_s (local.get $override) (i32.const 0))))

;; Field names use a raw collision scope, so a keyword may stay a quoted
;; property. Embedded table fields borrow a model type and recursively build
;; the positional child fields only when runtime functions will be emitted.
(func $make_fields (param $module i32) (param $columns i32) (param $query i32) (param $force_nullable i32) (result i32)
  (local $head i32) (local $tail i32) (local $field i32) (local $scope i32) (local $index i32)
  (local $column i32) (local $override i32) (local $nullable i32) (local $model i32)
  (local $alias i32) (local $alias_n i32) (local $name i32) (local $name_n i32)
  (local.set $scope (call $name_scope_raw))
  (block $done (loop $loop
    (br_if $done (i32.eqz (local.get $columns)))
    (local.set $column (local.get $columns)) (local.set $columns (call $next (local.get $columns)))
    (local.set $index (i32.add (local.get $index) (i32.const 1)))
    (if (i32.and (i32.ne (local.get $query) (i32.const 0)) (i32.ne (call $child (local.get $column) (i32.const 14)) (i32.const 0)))
      (then
        (call $query_override (local.get $query) (local.get $column) (i32.const 0)) local.set $nullable local.set $override
        (if (i32.ge_s (local.get $override) (i32.const 0))
          (then (call $error (call $fmt1 (call $t_embedded_override) (call $go_quote (call $text (local.get $column) (i32.const 1)))))))
        (local.set $column (call $column_nullable (local.get $column) (local.get $nullable)))))
    (call $name_take (local.get $scope) (call $field_name (call $text (local.get $column) (i32.const 1))
      (call $concat (call $t_col_prefix) (call $text_i32 (local.get $index))))) local.set $name_n local.set $name
    (if (call $child (local.get $column) (i32.const 14))
      (then
        (local.set $model (call $find_model (call $child (local.get $column) (i32.const 14))))
        (if (i32.eqz (local.get $model))
          (then (call $error (call $fmt1 (call $t_missing_embed) (call $go_quote (call $text (call $child (local.get $column) (i32.const 14)) (i32.const 3)))))))
        (local.set $field (call $work_record (i32.const 105)))
        (i32.store offset=8 (local.get $field) (local.get $column))
        (call $module_import (local.get $module) (call $t_models_path) (call $get_text (local.get $model) (i32.const 16)) (i32.const 1)) local.set $alias_n local.set $alias
        (call $set_text (local.get $field) (i32.const 24) (local.get $alias) (local.get $alias_n))
        (local.set $nullable (i32.or (i32.eqz (call $number (local.get $column) (i32.const 3))) (local.get $force_nullable)))
        (if (local.get $nullable)
          (then (call $set_text (local.get $field) (i32.const 24)
            (call $fmt3 (call $t_embed_type) (local.get $alias) (local.get $alias_n) (local.get $alias) (local.get $alias_n) (call $null_text)))))
        (if (i32.eqz (global.get $opt_types_only))
          (then (i32.store offset=12 (local.get $field) (call $make_fields (local.get $module) (i32.load offset=12 (local.get $model)) (i32.const 0) (local.get $nullable))))))
      (else (local.set $field (call $resolve_query_type (local.get $module) (local.get $query) (local.get $column) (local.get $force_nullable) (i32.const 0)))))
    (call $set_text (local.get $field) (i32.const 16) (local.get $name) (local.get $name_n))
    (if (local.get $tail) (then (i32.store offset=4 (local.get $tail) (local.get $field))) (else (local.set $head (local.get $field))))
    (local.set $tail (local.get $field)) (br $loop)))
  (local.get $head))

;; Build a checked encode/decode call after resolving helper imports. Literal
;; punctuation writes directly into one result span. Context expressions are
;; already printed source; they remain unchanged and appear only when present.
(func $value_call (param $module i32) (param $field i32) (param $expression i32) (param $expression_n i32) (param $context i32) (param $context_n i32) (param $decode i32) (result i32 i32)
  (local $dims i32) (local $custom i32) (local $name i32) (local $name_n i32)
  (local $codec i32) (local $codec_n i32) (local $typ i32) (local $typ_n i32) (local $start i32)
  (if (global.get $compact_active) (then (call $runtime_kind (call $kind_text (i32.load offset=32 (local.get $field))))))
  (local.set $dims (i32.load offset=40 (local.get $field)))
  (local.set $custom (i32.ne (i32.load offset=60 (local.get $field)) (i32.const 0)))
  (if (local.get $decode)
    (then
      (call $type_text (local.get $field)) local.set $typ_n local.set $typ
      (if (local.get $dims)
        (then (if (local.get $custom) (then (call $t_decodeArrayCustom) local.set $name_n local.set $name) (else (call $t_decodeArray) local.set $name_n local.set $name)))
        (else (if (local.get $custom) (then (call $t_decodeCustom) local.set $name_n local.set $name) (else (call $t_decodeValue) local.set $name_n local.set $name)))))
    (else
      (if (local.get $dims)
        (then (if (local.get $custom) (then (call $t_encodeArrayCustom) local.set $name_n local.set $name) (else (call $t_encodeArray) local.set $name_n local.set $name)))
        (else (if (local.get $custom) (then (call $t_encodeCustom) local.set $name_n local.set $name) (else (call $t_encodeValue) local.set $name_n local.set $name))))))
  (call $runtime_import (local.get $module) (local.get $name) (local.get $name_n) (i32.const 0)) local.set $name_n local.set $name
  (if (local.get $custom)
    (then
      (if (result i32 i32) (i32.and (global.get $compact_active)
        (i32.or
          (call $eq (call $get_text (local.get $field) (i32.const 48)) (call $c_runtime_path))
          (i32.or
            (call $eq (call $get_text (local.get $field) (i32.const 48)) (call $runtime_file_path (global.get $gen_engine)))
            (call $eq (call $get_text (local.get $field) (i32.const 48)) (call $runtime_file_path (i32.const 0))))))
        (then (call $runtime_import (local.get $module) (call $get_text (local.get $field) (i32.const 56)) (i32.const 0)))
        (else
          (if (i32.and (global.get $compact_active) (i32.eq (global.get $gen_engine) (i32.const 1)))
            (then (call $runtime_external_sqlite_codec)))
          (call $module_import (local.get $module) (call $get_text (local.get $field) (i32.const 48)) (call $get_text (local.get $field) (i32.const 56)) (i32.const 0))))
      local.set $codec_n local.set $codec))
  (local.set $start (global.get $txt_cursor)) (call $text_append (local.get $name) (local.get $name_n))
  (if (i32.or (local.get $decode) (local.get $custom))
    (then
      (call $text_byte (i32.const 60))
      (if (local.get $decode)
        (then
          (call $text_append (local.get $typ) (local.get $typ_n))
          (if (i32.and (local.get $custom) (i32.ne (local.get $dims) (i32.const 0)))
            (then (call $text_append (call $t_comma)) (call $text_append (call $get_text (local.get $field) (i32.const 24))))))
        (else (call $text_append (call $get_text (local.get $field) (i32.const 24)))))
      (call $text_byte (i32.const 62))))
  (call $text_byte (i32.const 40))
  (if (local.get $custom) (then (call $text_append (local.get $codec) (local.get $codec_n)) (call $text_append (call $t_comma))))
  (if (i32.or (i32.ne (local.get $dims) (i32.const 0)) (i32.eqz (local.get $custom)))
    (then (call $quote (call $kind_text (i32.load offset=32 (local.get $field)))) drop drop (call $text_append (call $t_comma))))
  (call $text_append (local.get $expression) (local.get $expression_n))
  (if (local.get $dims) (then (call $text_append (call $t_comma)) (call $text_i32 (local.get $dims)) drop drop))
  (if (i32.or (i32.or (local.get $decode) (local.get $custom))
    (i32.or (i32.ne (local.get $context_n) (i32.const 0))
      (i32.and (i32.eqz (local.get $dims)) (i32.ne (global.get $gen_engine) (i32.const 1)))))
    (then (call $text_append (call $t_comma)) (call $text_append (call $bool_text (i32.load offset=36 (local.get $field))))))
  (if (local.get $decode) (then (call $text_append (call $t_comma)) (call $text_append (call $bool_text (global.get $opt_null_undefined)))))
  (if (local.get $context_n) (then (call $text_append (call $t_comma)) (call $text_append (local.get $context) (local.get $context_n))))
  (call $text_byte (i32.const 41))
  (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start)))
(func $encode_context (param $module i32) (param $field i32) (param $p i32) (param $n i32) (param $context i32) (param $context_n i32) (result i32 i32)
  (call $value_call (local.get $module) (local.get $field) (local.get $p) (local.get $n) (local.get $context) (local.get $context_n) (i32.const 0)))
(func $decode_context (param $module i32) (param $field i32) (param $p i32) (param $n i32) (param $context i32) (param $context_n i32) (result i32 i32)
  (call $value_call (local.get $module) (local.get $field) (local.get $p) (local.get $n) (local.get $context) (local.get $context_n) (i32.const 1)))

;; Indent each JSDoc line through the shared writer, matching tsast.emitComment.
(func $emit_comment (param $p i32) (param $n i32)
  (local $start i32) (local $end i32) (local $at i32)
  (local.set $start (global.get $txt_cursor))
  (call $comment_begin) (call $comment_add (local.get $p) (local.get $n)) (call $comment_end)
  (local.set $end (global.get $txt_cursor)) (local.set $at (local.get $start))
  (block $done (loop $loop
    (br_if $done (i32.eq (local.get $at) (local.get $end)))
    (if (i32.eq (i32.load8_u (local.get $at)) (i32.const 10))
      (then (call $line (local.get $start) (i32.sub (local.get $at) (local.get $start)))
        (local.set $start (i32.add (local.get $at) (i32.const 1)))))
    (local.set $at (i32.add (local.get $at) (i32.const 1))) (br $loop)))
  (call $line (local.get $start) (i32.sub (local.get $end) (local.get $start))))
(func $emit_interface (param $module i32) (param $name i32) (param $name_n i32) (param $fields i32) (param $args i32)
  (local $p i32) (local $n i32) (local $type i32) (local $type_n i32) (local $optional i32) (local $optional_n i32)
  (call $line (call $fmt1 (call $t_interface_header) (local.get $name) (local.get $name_n)))
  (call $indent)
  (block $done (loop $field
    (br_if $done (i32.eqz (local.get $fields)))
    (call $text (i32.load offset=8 (local.get $fields)) (i32.const 5)) local.set $n local.set $p
    (if (local.get $n) (then (call $emit_comment (local.get $p) (local.get $n))))
    (if (local.get $args)
      (then (call $argument_type_text (local.get $fields)) local.set $type_n local.set $type)
      (else (call $type_text (local.get $fields)) local.set $type_n local.set $type))
    (call $t_empty) local.set $optional_n local.set $optional
    (if (i32.and (local.get $args) (i32.and (global.get $opt_optional_args)
      (i32.and (i32.load offset=36 (local.get $fields)) (i32.eqz (i32.load offset=44 (local.get $fields))))))
      (then (call $t_question) local.set $optional_n local.set $optional))
    (call $line (call $fmt3 (call $t_property_line) (call $property (call $get_text (local.get $fields) (i32.const 16)))
      (local.get $optional) (local.get $optional_n) (local.get $type) (local.get $type_n)))
    (local.set $fields (call $next (local.get $fields))) (br $field)))
  (call $dedent) (call $line (call $t_brace_close)) (call $line (call $t_empty)))
(func $emit_model (param $module i32) (param $model i32)
  (local $fields i32)
  (call $get_text (local.get $model) (i32.const 16)) global.set $err_model_n global.set $err_model_p
  (local.set $fields (call $make_fields (local.get $module) (i32.load offset=12 (local.get $model)) (i32.const 0) (i32.const 0)))
  (call $emit_interface (local.get $module) (call $get_text (local.get $model) (i32.const 16)) (local.get $fields) (i32.const 0))
  (global.set $err_model_p (i32.const 0)) (global.set $err_model_n (i32.const 0)))
