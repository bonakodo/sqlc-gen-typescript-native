;; Generator records reuse the input tail AFTER protobuf parsing has compacted
;; all retained strings. The raw tags, lengths, unknown fields and abandoned
;; scalar occurrences no longer have readers, so overwriting them is safe.
;;
;; This is an application-specific fixed record table, not a malloc heap. Each
;; entry is 256 bytes, its fields have one documented role, and a module's
;; temporary records can later be discarded together. Memory never grows.
(global $work_cursor (mut i32) (i32.const 33554432))
(global $gen_request (mut i32) (i32.const 0))
(global $gen_settings (mut i32) (i32.const 0))
(global $gen_catalog (mut i32) (i32.const 0))
(global $gen_engine (mut i32) (i32.const 0)) ;; 1 SQLite, 2 PostgreSQL, 3 MySQL
(global $gen_options (mut i32) (i32.const -1))
(global $gen_models (mut i32) (i32.const 0))
(global $gen_enums (mut i32) (i32.const 0))
(global $gen_groups (mut i32) (i32.const 0))
(global $gen_query_count (mut i32) (i32.const 0))
(global $gen_current_module (mut i32) (i32.const 0))

(func $work_init
  (global.set $work_cursor (i32.and (i32.add (global.get $pb_text) (i32.const 255)) (i32.const -256))))
(func $work_record (param $kind i32) (result i32) (local $r i32)
  (local.set $r (global.get $work_cursor))
  (if (i32.gt_u (local.get $r) (i32.const 50331392)) (then (call $fail (i32.const 17))))
  (memory.fill (local.get $r) (i32.const 0) (i32.const 256))
  (i32.store (local.get $r) (local.get $kind))
  (global.set $work_cursor (i32.add (local.get $r) (i32.const 256)))
  (local.get $r))

;; get/set a pointer-length pair at a STRUCT offset (not a protobuf number).
(func $get_text (param $r i32) (param $offset i32) (result i32 i32)
  (i32.load (i32.add (local.get $r) (local.get $offset)))
  (i32.load offset=4 (i32.add (local.get $r) (local.get $offset))))
(func $set_text (param $r i32) (param $offset i32) (param $p i32) (param $n i32)
  (i32.store (i32.add (local.get $r) (local.get $offset)) (local.get $p))
  (i32.store offset=4 (i32.add (local.get $r) (local.get $offset)) (local.get $n)))

;; Stable insertion into a linked list sorted on one pointer-length field.
;; The list uses word1 (offset4) for its next link. Existing equal entries stay
;; before the inserted entry, matching Go's stable query ordering.
(func $sorted_insert (param $head i32) (param $item i32) (param $key i32) (result i32)
  (local $at i32) (local $previous i32)
  (local.set $at (local.get $head))
  (block $position (loop $scan
    (br_if $position (i32.eqz (local.get $at)))
    (br_if $position (i32.lt_s (call $compare (call $get_text (local.get $item) (local.get $key))
                                             (call $get_text (local.get $at) (local.get $key))) (i32.const 0)))
    (local.set $previous (local.get $at))
    (local.set $at (call $next (local.get $at)))
    (br $scan)))
  (i32.store offset=4 (local.get $item) (local.get $at))
  (if (result i32) (local.get $previous)
    (then (i32.store offset=4 (local.get $previous) (local.get $item)) (local.get $head))
    (else (local.get $item))))

(func $emits_runtime (result i32)
  (i32.and (i32.eqz (global.get $opt_types_only))
    (i32.or (i32.ne (global.get $gen_query_count) (i32.const 0)) (global.get $opt_factory))))
(func $emits_json (result i32)
  (i32.or (i32.ne (global.get $gen_engine) (i32.const 1)) (call $emits_runtime)))
