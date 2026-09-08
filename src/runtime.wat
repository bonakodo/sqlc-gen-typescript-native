;; Runtime templates are a build-time declaration graph. The request records
;; imported declarations and scalar kinds, then expands only their dependencies.
;; The selection table occupies one work record; template text stays read-only.
(global $runtime_used (mut i32) (i32.const 0))
(global $runtime_kinds (mut i32) (i32.const 0))
(global $runtime_changed (mut i32) (i32.const 0))

(func $runtime_reset
  (global.set $runtime_used (call $work_record (i32.const 119)))
  (memory.fill (global.get $runtime_used) (i32.const 0) (i32.const 256))
  (global.set $runtime_kinds (i32.const 0)))

;; External codec modules may import any documented SQLite preset or factory.
;; The generator cannot inspect them, so retain that small public codec family.
(func $runtime_external_sqlite_codec
  (i32.store8 (i32.add (global.get $runtime_used) (global.get $asset_runtime_sqlite_codecs_i)) (i32.const 1)))

(func $runtime_file_path (param $file i32) (result i32 i32)
  (if (i32.eqz (local.get $file)) (then
    (return (global.get $asset_runtime_common_path_p) (global.get $asset_runtime_common_path_n))))
  (if (i32.eq (local.get $file) (i32.const 1)) (then
    (return (global.get $asset_runtime_sqlite_path_p) (global.get $asset_runtime_sqlite_path_n))))
  (if (i32.eq (local.get $file) (i32.const 2)) (then
    (return (global.get $asset_runtime_postgresql_path_p) (global.get $asset_runtime_postgresql_path_n))))
  (global.get $asset_runtime_mysql_path_p) (global.get $asset_runtime_mysql_path_n))

(func $runtime_path (param $name i32) (param $n i32) (result i32 i32)
  (local $index i32) (local $part i32) (local $bit i32)
  (local.set $part (global.get $asset_runtime_parts_p))
  (local.set $bit (i32.shl (i32.const 1) (global.get $opt_driver)))
  (block $done (loop $parts
    (br_if $done (i32.eq (local.get $index) (global.get $asset_runtime_parts_n)))
    (if (i32.and (i32.load (local.get $part)) (local.get $bit)) (then
      (if (call $eq (local.get $name) (local.get $n) (i32.load offset=8 (local.get $part)) (i32.load offset=12 (local.get $part))) (then
        (i32.store8 (i32.add (global.get $runtime_used) (local.get $index)) (i32.const 1))
        (return (call $runtime_file_path (i32.load offset=4 (local.get $part))))))))
    (local.set $part (i32.add (local.get $part) (i32.const 36)))
    (local.set $index (i32.add (local.get $index) (i32.const 1)))
    (br $parts)))
  ;; Every generated runtime import has a declaration in the checked template.
  (call $fail (i32.const 3)) unreachable)

(func $runtime_kind (param $name i32) (param $n i32)
  (local $index i32) (local $part i32)
  (local.set $part (global.get $asset_runtime_kinds_p))
  (block $done (loop $kinds
    (br_if $done (i32.eq (local.get $index) (global.get $asset_runtime_kinds_n)))
    (if (call $eq (local.get $name) (local.get $n) (i32.load (local.get $part)) (i32.load offset=4 (local.get $part))) (then
      (global.set $runtime_kinds (i32.or (global.get $runtime_kinds) (i32.shl (i32.const 1) (local.get $index))))
      (return)))
    (local.set $part (i32.add (local.get $part) (i32.const 8)))
    (local.set $index (i32.add (local.get $index) (i32.const 1)))
    (br $kinds)))
  (call $fail (i32.const 3)))

(func $runtime_dependencies (param $p i32) (param $n i32)
  (local $index i32) (local $used i32) (local $part i32)
  (block $done (loop $dependencies
    (br_if $done (i32.eqz (local.get $n)))
    (local.set $index (i32.load (local.get $p)))
    (local.set $part (i32.add (global.get $asset_runtime_parts_p) (i32.mul (local.get $index) (i32.const 36))))
    (local.set $used (i32.add (global.get $runtime_used) (local.get $index)))
    (if (i32.and
      (i32.eqz (i32.load8_u (local.get $used)))
      (i32.ne (i32.and (i32.load (local.get $part)) (i32.shl (i32.const 1) (global.get $opt_driver))) (i32.const 0))) (then
      (i32.store8 (local.get $used) (i32.const 1))
      (global.set $runtime_changed (i32.const 1))))
    (local.set $p (i32.add (local.get $p) (i32.const 4)))
    (local.set $n (i32.sub (local.get $n) (i32.const 1))) (br $dependencies))))

(func $runtime_fragment_used (param $part i32) (result i32)
  (i32.or (i32.eqz (i32.load (local.get $part)))
    (i32.ne (i32.and (i32.load (local.get $part)) (global.get $runtime_kinds)) (i32.const 0))))

(func $runtime_expand
  (local $index i32) (local $part i32) (local $fragment i32) (local $remaining i32) (local $kinds i32)
  (loop $closure
    (global.set $runtime_changed (i32.const 0))
    (local.set $index (i32.const 0))
    (local.set $part (global.get $asset_runtime_parts_p))
    (block $done (loop $parts
      (br_if $done (i32.eq (local.get $index) (global.get $asset_runtime_parts_n)))
      (if (i32.load8_u (i32.add (global.get $runtime_used) (local.get $index))) (then
        (local.set $kinds (i32.or (global.get $runtime_kinds) (i32.load offset=32 (local.get $part))))
        (if (i32.ne (local.get $kinds) (global.get $runtime_kinds)) (then
          (global.set $runtime_kinds (local.get $kinds)) (global.set $runtime_changed (i32.const 1))))
        (call $runtime_dependencies (i32.load offset=24 (local.get $part)) (i32.load offset=28 (local.get $part)))
        (local.set $fragment (i32.load offset=16 (local.get $part)))
        (local.set $remaining (i32.load offset=20 (local.get $part)))
        (block $fragments_done (loop $fragments
          (br_if $fragments_done (i32.eqz (local.get $remaining)))
          (if (call $runtime_fragment_used (local.get $fragment)) (then
            (call $runtime_dependencies (i32.load offset=12 (local.get $fragment)) (i32.load offset=16 (local.get $fragment)))))
          (local.set $fragment (i32.add (local.get $fragment) (i32.const 20)))
          (local.set $remaining (i32.sub (local.get $remaining) (i32.const 1))) (br $fragments)))))
      (local.set $part (i32.add (local.get $part) (i32.const 36)))
      (local.set $index (i32.add (local.get $index) (i32.const 1))) (br $parts)))
    (br_if $closure (global.get $runtime_changed))))

(func $client_source (result i32 i32)
  (local $specifier i32) (local $specifier_n i32)
  (call $quote (call $opt_driver_specifier)) (local.set $specifier_n) (local.set $specifier)
  (if (i32.eq (global.get $opt_driver) (i32.const 1)) (then
    (return (call $fmt2 (call $c_client_pg)
      (if (result i32 i32) (i32.eq (global.get $opt_runtime) (i32.const 3)) (then (call $c_client_pg_deno)) (else (call $c_empty)))
      (local.get $specifier) (local.get $specifier_n)))))
  (if (i32.eq (global.get $opt_driver) (i32.const 2)) (then
    (return (call $fmt1 (call $c_client_postgres) (local.get $specifier) (local.get $specifier_n)))))
  (if (i32.eq (global.get $opt_driver) (i32.const 3)) (then
    (return (call $fmt1 (call $c_client_mysql) (local.get $specifier) (local.get $specifier_n)))))
  (if (i32.eq (global.get $opt_driver) (i32.const 4)) (then
    (return (call $fmt2 (call $c_client_better)
      (if (result i32 i32) (i32.eq (global.get $opt_runtime) (i32.const 3)) (then (call $c_client_better_deno)) (else (call $c_empty)))
      (local.get $specifier) (local.get $specifier_n)))))
  (call $fmt1 (call $c_client_bonakodo) (local.get $specifier) (local.get $specifier_n)))


(func $emit_runtime_file (param $file i32)
  (local $path i32) (local $path_n i32) (local $index i32) (local $part i32) (local $fragment i32) (local $remaining i32)
  (call $runtime_file_path (local.get $file)) (local.set $path_n) (local.set $path)
  (call $file_begin (i32.add (local.get $path) (i32.const 2)) (i32.sub (local.get $path_n) (i32.const 2)))
  (call $emit (call $c_header))
  (if (local.get $file) (then (call $emit (call $client_source))))
  (local.set $part (global.get $asset_runtime_parts_p))
  (block $done (loop $parts
    (br_if $done (i32.eq (local.get $index) (global.get $asset_runtime_parts_n)))
    (if (i32.and (i32.eq (i32.load offset=4 (local.get $part)) (local.get $file))
      (i32.ne (i32.load8_u (i32.add (global.get $runtime_used) (local.get $index))) (i32.const 0))) (then
      (local.set $fragment (i32.load offset=16 (local.get $part)))
      (local.set $remaining (i32.load offset=20 (local.get $part)))
      (block $fragments_done (loop $fragments
        (br_if $fragments_done (i32.eqz (local.get $remaining)))
        (if (call $runtime_fragment_used (local.get $fragment)) (then
          (call $emit (i32.load offset=4 (local.get $fragment)) (i32.load offset=8 (local.get $fragment)))))
        (local.set $fragment (i32.add (local.get $fragment) (i32.const 20)))
        (local.set $remaining (i32.sub (local.get $remaining) (i32.const 1))) (br $fragments)))))
    (local.set $part (i32.add (local.get $part) (i32.const 36)))
    (local.set $index (i32.add (local.get $index) (i32.const 1))) (br $parts)))
  (call $finish_line (global.get $file_start))
  (call $file_end))

(func $emit_runtime
  (call $runtime_expand)
  (call $emit_runtime_file (i32.const 0))
  (call $emit_runtime_file (global.get $gen_engine)))
