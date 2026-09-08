;; Runtime support is static UTF-8 output data. The build validates section
;; markers and records each span once as {driver mask, pointer, byte length}.
;; Driver IDs are validated by options.wat before this code runs.
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

(func $emit_runtime
  (local $part i32) (local $remaining i32) (local $driver_bit i32)
  (call $file_begin (call $c_runtime_file))
  (call $emit (call $c_header))
  (call $emit (call $client_source))
  (if (i32.ne (global.get $gen_engine) (i32.const 1)) (then
    (call $emit
      (if (result i32 i32) (i32.eq (global.get $opt_driver) (i32.const 2))
        (then (call $c_json_postgres)) (else (call $c_json_generic))))))
  (local.set $driver_bit (i32.shl (i32.const 1) (global.get $opt_driver)))
  (local.set $part (global.get $asset_runtime_parts_p))
  (local.set $remaining (global.get $asset_runtime_parts_n))
  (block $done (loop $parts
    (br_if $done (i32.eqz (local.get $remaining)))
    (if (i32.and (i32.load (local.get $part)) (local.get $driver_bit)) (then
      (call $emit (i32.load offset=4 (local.get $part)) (i32.load offset=8 (local.get $part)))))
    (local.set $part (i32.add (local.get $part) (i32.const 12)))
    (local.set $remaining (i32.sub (local.get $remaining) (i32.const 1)))
    (br $parts)))
  (call $file_end))
