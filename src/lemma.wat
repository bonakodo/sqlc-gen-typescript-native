;; Optional LemmaScript contracts describe an external database interface.
;; They never turn SQL metadata or a user assertion into a verified theorem.
;; Directive parsing returns a view into input; ordinary comments return 0,0.
(func $lemma_directive (param $p i32) (param $n i32) (result i32 i32)
  (local $end i32) (local $at i32) (local $r i32) (local $payload i32)
  (call $trim_space (local.get $p) (local.get $n)) local.set $n local.set $p
  (if (i32.eqz (call $starts_with (local.get $p) (local.get $n) (call $c_lemma_prefix)))
    (then (return (i32.const 0) (i32.const 0))))
  ;; Newlines and Unicode line separators must never leave a generated // line.
  (local.set $end (i32.add (local.get $p) (local.get $n))) (local.set $at (local.get $p))
  (block $scanned (loop $scan
    (br_if $scanned (i32.ge_u (local.get $at) (local.get $end)))
    (call $rune (local.get $at) (local.get $end)) local.set $r local.set $at
    (if (i32.or (i32.and (i32.lt_u (local.get $r) (i32.const 32)) (i32.ne (local.get $r) (i32.const 9)))
      (i32.or (i32.eq (local.get $r) (i32.const 127))
        (i32.or (i32.eq (local.get $r) (i32.const 8232)) (i32.eq (local.get $r) (i32.const 8233)))))
      (then (call $error (call $c_lemma_invalid))))
    (br $scan)))
  (if (i32.or (i32.le_u (local.get $n) (i32.const 6))
    (i32.eqz (i32.or (i32.eq (i32.load8_u offset=6 (local.get $p)) (i32.const 32))
      (i32.eq (i32.load8_u offset=6 (local.get $p)) (i32.const 9)))))
    (then (call $error (call $c_lemma_invalid))))
  (call $trim_space (i32.add (local.get $p) (i32.const 6)) (i32.sub (local.get $n) (i32.const 6))) local.set $n local.set $p
  (if (call $starts_with (local.get $p) (local.get $n) (call $c_lemma_requires)) (then (local.set $payload (i32.const 9))))
  (if (call $starts_with (local.get $p) (local.get $n) (call $c_lemma_ensures)) (then (local.set $payload (i32.const 8))))
  (if (call $starts_with (local.get $p) (local.get $n) (call $c_lemma_contract)) (then (local.set $payload (i32.const 9))))
  (if (i32.or (i32.eqz (local.get $payload)) (i32.le_u (local.get $n) (local.get $payload)))
    (then (call $error (call $c_lemma_invalid))))
  (local.get $p) (local.get $n))

(func $lemma_validate (param $q i32) (local $comment i32)
  (local.set $comment (call $child (local.get $q) (i32.const 6)))
  (block $done (loop $comments
    (br_if $done (i32.eqz (local.get $comment)))
    (call $lemma_directive (call $text (local.get $comment) (i32.const 1))) drop drop
    (local.set $comment (call $next (local.get $comment))) (br $comments))))

;; Keep the old JSDoc byte-for-byte when disabled, including @lemma text.
(func $lemma_query_comments (param $q i32)
  (local $comment i32) (local $start i32) (local $started i32) (local $directive i32)
  (local.set $comment (call $child (local.get $q) (i32.const 6)))
  (block $done (loop $comments
    (br_if $done (i32.eqz (local.get $comment)))
    (local.set $directive (i32.const 0))
    (if (global.get $opt_lemmascript) (then
      (call $lemma_directive (call $text (local.get $comment) (i32.const 1))) local.set $directive drop))
    (if (i32.eqz (local.get $directive)) (then
      (if (i32.eqz (local.get $started)) (then
        (local.set $start (call $text_mark)) (call $comment_begin) (local.set $started (i32.const 1))))
      (call $comment_add (call $text (local.get $comment) (i32.const 1)))))
    (local.set $comment (call $next (local.get $comment))) (br $comments)))
  (if (local.get $started) (then
    (call $comment_end) (call $line (local.get $start) (i32.sub (call $text_mark) (local.get $start))))))

(func $lemma_query_contract (param $plan i32)
  (local $q i32) (local $cmd i32) (local $field i32) (local $part i32) (local $number i32)
  (local $occurrence i32) (local $comment i32) (local $p i32) (local $n i32)
  (local.set $q (i32.load offset=8 (local.get $plan))) (local.set $cmd (i32.load offset=12 (local.get $plan)))
  (call $line (call $c_lemma_boundary))
  (call $line (call $fmt5 (call $c_lemma_query)
    (call $go_quote (call $text (local.get $q) (i32.const 2)))
    (call $go_quote (call $text (local.get $q) (i32.const 7)))
    (call $text (local.get $q) (i32.const 3)) (call $engine_text) (call $opt_driver_name)))
  (call $line (call $c_lemma_state))
  (call $line (call $c_lemma_errors))
  (call $line (call $c_lemma_numbers))
  (if (i32.eq (local.get $cmd) (i32.const 1)) (then (call $line (call $fmt1 (call $c_lemma_one) (call $null_text)))))
  (if (i32.eq (local.get $cmd) (i32.const 2)) (then
    (call $line (call $c_lemma_many))))
  (if (i32.eq (local.get $cmd) (i32.const 3)) (then (call $line (call $c_lemma_exec))))
  (if (i32.eq (local.get $cmd) (i32.const 4)) (then (call $line (call $c_lemma_execrows))))
  (if (i32.eq (local.get $cmd) (i32.const 5)) (then (call $line (call $c_lemma_lastid))))
  (if (i32.eq (local.get $cmd) (i32.const 6)) (then (call $line (call $c_lemma_execresult))))
  (local.set $field (i32.load offset=48 (local.get $plan)))
  (block $args_done (loop $args
    (br_if $args_done (i32.eqz (local.get $field)))
    (call $line (call $fmt5 (call $c_lemma_argument)
      (call $decimal_i32 (i32.load offset=64 (local.get $field)))
      (call $go_quote (call $get_text (local.get $field) (i32.const 16)))
      (call $go_quote (call $argument_type_text (local.get $field)))
      (call $bool_text (i32.load offset=36 (local.get $field)))
      (call $bool_text (i32.and (global.get $opt_optional_args)
        (i32.and (i32.load offset=36 (local.get $field)) (i32.eqz (i32.load offset=44 (local.get $field))))))))
    (if (i32.load offset=44 (local.get $field)) (then
      (call $line (call $fmt1 (call $c_lemma_slice) (call $go_quote (call $get_text (local.get $field) (i32.const 16)))))))
    (call $lemma_field_details (local.get $field) (call $access (call $c_args) (call $get_text (local.get $field) (i32.const 16))))
    (local.set $field (call $next (local.get $field))) (br $args)))
  (call $lemma_result_fields (i32.load offset=52 (local.get $plan)) (call $c_lemma_row))
  (if (i32.load offset=48 (local.get $plan)) (then
    (call $line (if (result i32 i32) (i32.eq (global.get $gen_engine) (i32.const 2))
      (then (call $c_lemma_pg_bindings)) (else (call $c_lemma_other_bindings))))))
  (local.set $part (i32.load offset=56 (local.get $plan)))
  (block $parts_done (loop $parts
    (br_if $parts_done (i32.eqz (local.get $part)))
    (local.set $number (i32.load offset=16 (local.get $part)))
    (if (local.get $number) (then
      (local.set $occurrence (i32.add (local.get $occurrence) (i32.const 1)))
      (local.set $field (call $bind_find_parameter (i32.load offset=48 (local.get $plan)) (local.get $number)))
      (call $line (call $fmt4 (call $c_lemma_binding)
        (call $decimal_i32 (local.get $occurrence)) (call $decimal_i32 (local.get $number))
        (call $go_quote (call $get_text (local.get $field) (i32.const 16)))
        (if (result i32 i32) (i32.load offset=44 (local.get $field))
          (then (call $c_lemma_binding_slice)) (else (call $c_lemma_binding_scalar)))))))
    (local.set $part (call $next (local.get $part))) (br $parts)))
  (local.set $comment (call $child (local.get $q) (i32.const 6)))
  (block $comments_done (loop $comments
    (br_if $comments_done (i32.eqz (local.get $comment)))
    (call $lemma_directive (call $text (local.get $comment) (i32.const 1))) local.set $n local.set $p
    (if (local.get $n) (then (call $line (call $fmt1 (call $c_lemma_directive) (local.get $p) (local.get $n)))))
    (local.set $comment (call $next (local.get $comment))) (br $comments))))

(func $lemma_field_details (param $field i32) (param $path i32) (param $path_n i32)
  (if (i32.load offset=60 (local.get $field)) (then
    (call $line (call $fmt1 (call $c_lemma_codec) (call $go_quote (local.get $path) (local.get $path_n))))))
  (if (i32.load offset=40 (local.get $field)) (then
    (call $line (call $fmt2 (call $c_lemma_array)
      (call $go_quote (local.get $path) (local.get $path_n))
      (call $decimal_i32 (i32.load offset=40 (local.get $field))))))))

(func $lemma_result_fields (param $field i32) (param $parent i32) (param $parent_n i32)
  (local $path i32) (local $path_n i32)
  (block $done (loop $fields
    (br_if $done (i32.eqz (local.get $field)))
    (call $access (local.get $parent) (local.get $parent_n) (call $get_text (local.get $field) (i32.const 16))) local.set $path_n local.set $path
    (if (i32.load offset=12 (local.get $field))
      (then
        (call $line (call $fmt2 (call $c_lemma_embed)
          (call $go_quote (local.get $path) (local.get $path_n)) (call $go_quote (call $type_text (local.get $field)))))
        (call $lemma_result_fields (i32.load offset=12 (local.get $field)) (local.get $path) (local.get $path_n)))
      (else
        (call $line (call $fmt4 (call $c_lemma_field)
          (call $go_quote (local.get $path) (local.get $path_n))
          (call $go_quote (call $type_text (local.get $field)))
          (call $bool_text (i32.load offset=36 (local.get $field)))
          (call $kind_text (i32.load offset=32 (local.get $field)))))
        (call $lemma_field_details (local.get $field) (local.get $path) (local.get $path_n))))
    (local.set $field (call $next (local.get $field))) (br $fields))))
