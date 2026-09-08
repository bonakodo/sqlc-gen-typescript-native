;; Module/import records live in the reclaimed request tail. Import lookup is
;; a bounded list scan, and insertion keeps path/name order deterministic.
;; No hash map, string interning table, or per-import heap allocation is needed.
(func $module_new (param $p i32) (param $n i32) (result i32) (local $m i32) (local $scope i32)
  (local.set $m (call $work_record (i32.const 103)))
  (call $set_text (local.get $m) (i32.const 8) (local.get $p) (local.get $n))
  (local.set $scope (call $name_scope))
  (call $reserve (local.get $scope) (call $c_compatible))
  (i32.store offset=16 (local.get $m) (local.get $scope))
  (local.get $m))

(func $module_import (param $m i32) (param $p i32) (param $n i32)
  (param $name i32) (param $name_n i32) (param $type_only i32) (result i32 i32)
  (local $at i32) (local $previous i32) (local $r i32) (local $order i32)
  (if (call $starts_with (local.get $p) (local.get $n) (call $c_dot)) (then
    (call $path_relative (call $path_dir (call $get_text (local.get $m) (i32.const 8))) (local.get $p) (local.get $n))
    (local.set $n) (local.set $p)
    (if (i32.eqz (call $starts_with (local.get $p) (local.get $n) (call $c_dot)))
      (then (call $concat (call $c_dot_slash) (local.get $p) (local.get $n)) (local.set $n) (local.set $p)))))
  (local.set $at (i32.load offset=20 (local.get $m)))
  (block $position (loop $find
    (br_if $position (i32.eqz (local.get $at)))
    (local.set $order (call $compare (local.get $p) (local.get $n) (call $get_text (local.get $at) (i32.const 8))))
    (if (i32.eqz (local.get $order)) (then
      (local.set $order (call $compare (local.get $name) (local.get $name_n) (call $get_text (local.get $at) (i32.const 16))))
      (if (i32.eqz (local.get $order)) (then
        ;; A later value use upgrades an earlier type-only import permanently.
        (i32.store offset=32 (local.get $at) (i32.and (i32.load offset=32 (local.get $at)) (local.get $type_only)))
        (return (call $get_text (local.get $at) (i32.const 24)))))))
    (br_if $position (i32.lt_s (local.get $order) (i32.const 0)))
    (local.set $previous (local.get $at)) (local.set $at (call $next (local.get $at))) (br $find)))
  (local.set $r (call $work_record (i32.const 104)))
  ;; Imports survive per-query scratch resets until the module prefix is
  ;; printed. Retain computed paths and names explicitly; static/input spans
  ;; already have request-wide lives. name_take retains the alias itself.
  (call $set_text (local.get $r) (i32.const 8) (call $retain_text (local.get $p) (local.get $n)))
  (call $set_text (local.get $r) (i32.const 16) (call $retain_text (local.get $name) (local.get $name_n)))
  (call $set_text (local.get $r) (i32.const 24)
    (call $name_take (i32.load offset=16 (local.get $m))
      (call $concat (call $c_import_prefix) (call $upper_first (local.get $name) (local.get $name_n)))))
  (i32.store offset=32 (local.get $r) (local.get $type_only))
  (i32.store offset=4 (local.get $r) (local.get $at))
  (if (local.get $previous)
    (then (i32.store offset=4 (local.get $previous) (local.get $r)))
    (else (i32.store offset=20 (local.get $m) (local.get $r))))
  (call $get_text (local.get $r) (i32.const 24)))

(func $runtime_import (param $m i32) (param $name i32) (param $n i32) (param $type_only i32) (result i32 i32)
  (call $module_import (local.get $m) (call $c_runtime_path) (local.get $name) (local.get $n) (local.get $type_only)))

(func $module_begin (param $m i32)
  (call $file_begin (call $get_text (local.get $m) (i32.const 8)))
  (i32.store offset=28 (local.get $m) (global.get $out_cursor))
  (global.set $gen_current_module (local.get $m)))

(func $module_imports (param $m i32)
  (local $group i32) (local $end i32) (local $at i32) (local $typed i32) (local $first i32)
  (local $path i32) (local $path_n i32)
  (local.set $group (i32.load offset=20 (local.get $m)))
  (block $done (loop $groups
    (br_if $done (i32.eqz (local.get $group)))
    (local.set $end (call $next (local.get $group)))
    (block $group_end (loop $same_path
      (br_if $group_end (i32.eqz (local.get $end)))
      (br_if $group_end (i32.eqz (call $eq (call $get_text (local.get $group) (i32.const 8)) (call $get_text (local.get $end) (i32.const 8)))))
      (local.set $end (call $next (local.get $end))) (br $same_path)))
    (call $quote (call $get_text (local.get $group) (i32.const 8))) (local.set $path_n) (local.set $path)
    (local.set $typed (i32.const 1))
    (block $types_done (loop $types
      (local.set $first (i32.const 1)) (local.set $at (local.get $group))
      (block $items_done (loop $items
        (br_if $items_done (i32.eq (local.get $at) (local.get $end)))
        (if (i32.eq (i32.load offset=32 (local.get $at)) (local.get $typed)) (then
          (if (local.get $first)
            (then
              (call $emit (call $c_import_start))
              (if (local.get $typed) (then (call $emit (call $c_type_space))))
              (call $emit (call $c_import_open)))
            (else (call $emit (call $c_comma))))
          (local.set $first (i32.const 0))
          (call $emit (call $get_text (local.get $at) (i32.const 16)))
          (if (i32.eqz (call $eq (call $get_text (local.get $at) (i32.const 16)) (call $get_text (local.get $at) (i32.const 24))))
            (then (call $emit (call $c_import_as)) (call $emit (call $get_text (local.get $at) (i32.const 24)))))))
        (local.set $at (call $next (local.get $at))) (br $items)))
      (if (i32.eqz (local.get $first)) (then
        (call $emit (call $c_import_from))
        (call $emit (local.get $path) (local.get $path_n))
        (call $emit (call $c_semicolon_lf))))
      (br_if $types_done (i32.eqz (local.get $typed)))
      (local.set $typed (i32.const 0)) (br $types)))
    (local.set $group (local.get $end)) (br $groups)))
  (if (i32.load offset=20 (local.get $m)) (then (call $emit_byte (i32.const 10)))))

(func $module_end (param $m i32) (local $start i32) (local $prefix i32) (local $body_n i32)
  (local.set $start (i32.load offset=28 (local.get $m)))
  ;; Normalize the body's last line before imports take the next output bytes.
  ;; An empty/all-LF body instead gets its final LF from the prefix. This keeps
  ;; the same bytes as trimming [prefix][body], without moving either span.
  (call $finish_line (local.get $start))
  (if (i32.eq (global.get $out_cursor) (i32.add (local.get $start) (i32.const 1)))
    (then (global.set $out_cursor (local.get $start))))
  (local.set $prefix (global.get $out_cursor))
  (local.set $body_n (i32.sub (local.get $prefix) (local.get $start)))
  (global.set $out_indent (i32.const 0))
  (call $emit (call $c_header))
  (call $module_imports (local.get $m))
  (if (i32.load offset=24 (local.get $m)) (then
    (call $line (call $c_compatible_line)) (call $line (call $c_empty))))
  (if (i32.eqz (local.get $body_n)) (then (call $finish_line (local.get $prefix))))
  (i32.store offset=32 (local.get $m) (i32.sub (global.get $out_cursor) (local.get $start)))
  (call $file_end_parts (local.get $prefix) (i32.sub (global.get $out_cursor) (local.get $prefix))
    (local.get $start) (local.get $body_n)))
