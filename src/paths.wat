;; POSIX path operations for generated module names and relative imports.
;; SQL source filenames normalize both slash styles. Import specifiers follow
;; the existing WASI/Unix generator: only '/' is a path separator there.
;; The output cursor doubles as the component stack, so '..' pops bytes already
;; written by this call without allocating an array of path components.
(func $path_clean (param $p i32) (param $n i32) (param $windows i32) (result i32 i32)
  (local $start i32) (local $root i32) (local $end i32) (local $at i32)
  (local $part i32) (local $length i32) (local $c i32) (local $last i32) (local $pop i32)
  (local.set $start (call $text_mark))
  (local.set $end (i32.add (local.get $p) (local.get $n)))
  (if (local.get $n) (then
    (local.set $c (i32.load8_u (local.get $p)))
    (local.set $root (i32.or (i32.eq (local.get $c) (i32.const 47))
      (i32.and (local.get $windows) (i32.eq (local.get $c) (i32.const 92)))))))
  (if (local.get $root) (then (call $text_byte (i32.const 47))))
  (local.set $at (local.get $p))
  (block $done (loop $parts
    (br_if $done (i32.ge_u (local.get $at) (local.get $end)))
    (local.set $part (local.get $at))
    (block $end_part (loop $chars
      (br_if $end_part (i32.ge_u (local.get $at) (local.get $end)))
      (local.set $c (i32.load8_u (local.get $at)))
      (br_if $end_part (i32.or (i32.eq (local.get $c) (i32.const 47))
        (i32.and (local.get $windows) (i32.eq (local.get $c) (i32.const 92)))))
      (local.set $at (i32.add (local.get $at) (i32.const 1))) (br $chars)))
    (local.set $length (i32.sub (local.get $at) (local.get $part)))
    (block $skip
      (br_if $skip (i32.eqz (local.get $length)))
      (br_if $skip (call $eq (local.get $part) (local.get $length) (call $c_dot)))
      (if (call $eq (local.get $part) (local.get $length) (call $c_dot_dot)) (then
        (local.set $last (call $text_mark))
        (block $component (loop $back
          (br_if $component (i32.le_u (local.get $last) (i32.add (local.get $start) (local.get $root))))
          (br_if $component (i32.eq (i32.load8_u (i32.sub (local.get $last) (i32.const 1))) (i32.const 47)))
          (local.set $last (i32.sub (local.get $last) (i32.const 1))) (br $back)))
        (if (i32.and (i32.gt_u (call $text_mark) (i32.add (local.get $start) (local.get $root)))
          (i32.eqz (call $eq (local.get $last) (i32.sub (call $text_mark) (local.get $last)) (call $c_dot_dot))))
          (then
            (local.set $pop (local.get $last))
            (if (i32.gt_u (local.get $pop) (i32.add (local.get $start) (local.get $root)))
              (then (local.set $pop (i32.sub (local.get $pop) (i32.const 1)))))
            (global.set $txt_cursor (local.get $pop)) (br $skip)))
        (br_if $skip (local.get $root))))
      (if (i32.gt_u (call $text_mark) (i32.add (local.get $start) (local.get $root)))
        (then (call $text_byte (i32.const 47))))
      (call $text_append (local.get $part) (local.get $length)))
    (local.set $at (i32.add (local.get $at) (i32.const 1))) (br $parts)))
  (if (i32.eq (call $text_mark) (local.get $start)) (then (call $text_byte (i32.const 46))))
  (local.get $start) (i32.sub (call $text_mark) (local.get $start)))

(func $path_dir (param $p i32) (param $n i32) (result i32 i32) (local $i i32)
  (local.set $i (local.get $n))
  (block $none (loop $back
    (br_if $none (i32.eqz (local.get $i)))
    (local.set $i (i32.sub (local.get $i) (i32.const 1)))
    (if (i32.eq (i32.load8_u (i32.add (local.get $p) (local.get $i))) (i32.const 47))
      (then (return (call $path_clean (local.get $p) (i32.add (local.get $i) (i32.const 1)) (i32.const 0)))))
    (br $back)))
  (call $c_dot))

(func $without_ext (param $p i32) (param $n i32) (result i32 i32) (local $i i32) (local $c i32)
  (local.set $i (local.get $n))
  (block $none (loop $back
    (br_if $none (i32.eqz (local.get $i)))
    (local.set $i (i32.sub (local.get $i) (i32.const 1)))
    (local.set $c (i32.load8_u (i32.add (local.get $p) (local.get $i))))
    (br_if $none (i32.eq (local.get $c) (i32.const 47)))
    (if (i32.eq (local.get $c) (i32.const 46)) (then (return (local.get $p) (local.get $i))))
    (br $back)))
  (local.get $p) (local.get $n))

(func $query_filename (param $p i32) (param $n i32) (result i32 i32)
  (local $i i32) (local $c i32) (local $name i32) (local $name_n i32)
  (local $base i32) (local $start i32) (local $url i32)
  (block $checked (loop $check
    (br_if $checked (i32.ge_u (local.get $i) (local.get $n)))
    (local.set $c (i32.load8_u (i32.add (local.get $p) (local.get $i))))
    (if (i32.eqz (local.get $c)) (then (call $error (call $c_filename_nul))))
    (if (i32.or (i32.or (i32.eq (local.get $c) (i32.const 35)) (i32.eq (local.get $c) (i32.const 63)))
                (i32.eq (local.get $c) (i32.const 37)))
      (then (local.set $url (i32.const 1))))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $check)))
  ;; Check the whole string for NUL before reporting URL punctuation. The Go
  ;; validator uses two passes, so NUL wins even when '#' appeared first.
  (if (local.get $url)
    (then (call $error (call $fmt1 (call $c_filename_url) (call $go_quote (local.get $p) (local.get $n))))))
  (call $path_clean (local.get $p) (local.get $n) (i32.const 1)) (local.set $name_n) (local.set $name)
  (block $unsafe
    (if (i32.ge_u (local.get $name_n) (i32.const 2)) (then
      (local.set $c (i32.load8_u (local.get $name)))
      (br_if $unsafe (i32.and (i32.eq (i32.load8_u offset=1 (local.get $name)) (i32.const 58))
        (i32.or (i32.le_u (i32.sub (local.get $c) (i32.const 65)) (i32.const 25))
                 (i32.le_u (i32.sub (local.get $c) (i32.const 97)) (i32.const 25)))))))
    (br_if $unsafe (i32.eq (i32.load8_u (local.get $name)) (i32.const 47)))
    (br_if $unsafe (call $eq (local.get $name) (local.get $name_n) (call $c_dot)))
    (br_if $unsafe (call $eq (local.get $name) (local.get $name_n) (call $c_dot_dot)))
    (if (i32.ge_u (local.get $name_n) (i32.const 3)) (then
      (br_if $unsafe (i32.and (call $eq (local.get $name) (i32.const 2) (call $c_dot_dot))
        (i32.eq (i32.load8_u offset=2 (local.get $name)) (i32.const 47))))))
    ;; Only basename dots turn into underscores; directory dots stay intact.
    (local.set $i (i32.const 0))
    (block $base_found (loop $slashes
      (br_if $base_found (i32.ge_u (local.get $i) (local.get $name_n)))
      (if (i32.eq (i32.load8_u (i32.add (local.get $name) (local.get $i))) (i32.const 47))
        (then (local.set $base (i32.add (local.get $i) (i32.const 1)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $slashes)))
    (local.set $start (call $text_mark))
    (call $text_append (local.get $name) (local.get $base))
    (local.set $i (local.get $base))
    (block $copied (loop $copy
      (br_if $copied (i32.ge_u (local.get $i) (local.get $name_n)))
      (local.set $c (i32.load8_u (i32.add (local.get $name) (local.get $i))))
      (call $text_byte (select (i32.const 95) (local.get $c) (i32.eq (local.get $c) (i32.const 46))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $copy)))
    (call $text_append (call $c_ts_suffix))
    (return (local.get $start) (i32.sub (call $text_mark) (local.get $start))))
  (call $error (call $fmt1 (call $c_filename_unsafe) (call $go_quote (local.get $p) (local.get $n))))
  unreachable)

(func $path_relative (param $from i32) (param $from_n i32) (param $to i32) (param $to_n i32) (result i32 i32)
  (local $a i32) (local $an i32) (local $b i32) (local $bn i32)
  (local $ai i32) (local $bi i32) (local $ae i32) (local $be i32) (local $start i32)
  (call $path_clean (local.get $from) (local.get $from_n) (i32.const 0)) (local.set $an) (local.set $a)
  (call $path_clean (local.get $to) (local.get $to_n) (i32.const 0)) (local.set $bn) (local.set $b)
  (if (call $eq (local.get $a) (local.get $an) (local.get $b) (local.get $bn))
    (then (return (call $c_dot))))
  ;; filepath.Rel rejects a mix of absolute and relative paths. Its only
  ;; generator caller discards the error and uses the empty returned string.
  (if (i32.ne (i32.eq (i32.load8_u (local.get $a)) (i32.const 47))
               (i32.eq (i32.load8_u (local.get $b)) (i32.const 47)))
    (then (return (call $c_empty))))
  (if (call $eq (local.get $a) (local.get $an) (call $c_dot)) (then (local.set $an (i32.const 0))))
  (if (call $eq (local.get $b) (local.get $bn) (call $c_dot)) (then (local.set $bn (i32.const 0))))
  (block $different (loop $common
    (br_if $different (i32.or (i32.ge_u (local.get $ai) (local.get $an)) (i32.ge_u (local.get $bi) (local.get $bn))))
    (local.set $ae (local.get $ai)) (local.set $be (local.get $bi))
    (block $a_end (loop $a_scan
      (br_if $a_end (i32.ge_u (local.get $ae) (local.get $an)))
      (br_if $a_end (i32.eq (i32.load8_u (i32.add (local.get $a) (local.get $ae))) (i32.const 47)))
      (local.set $ae (i32.add (local.get $ae) (i32.const 1))) (br $a_scan)))
    (block $b_end (loop $b_scan
      (br_if $b_end (i32.ge_u (local.get $be) (local.get $bn)))
      (br_if $b_end (i32.eq (i32.load8_u (i32.add (local.get $b) (local.get $be))) (i32.const 47)))
      (local.set $be (i32.add (local.get $be) (i32.const 1))) (br $b_scan)))
    (br_if $different (i32.eqz (call $eq (i32.add (local.get $a) (local.get $ai)) (i32.sub (local.get $ae) (local.get $ai))
                                       (i32.add (local.get $b) (local.get $bi)) (i32.sub (local.get $be) (local.get $bi)))))
    (local.set $ai (select (i32.add (local.get $ae) (i32.const 1)) (local.get $ae) (i32.lt_u (local.get $ae) (local.get $an))))
    (local.set $bi (select (i32.add (local.get $be) (i32.const 1)) (local.get $be) (i32.lt_u (local.get $be) (local.get $bn))))
    (br $common)))
  ;; A remaining '..' in the base has no known parent, so Rel cannot derive
  ;; a relative path. Shared leading '..' components were consumed above.
  (local.set $ae (local.get $ai))
  (block $base_component (loop $base_scan
    (br_if $base_component (i32.ge_u (local.get $ae) (local.get $an)))
    (br_if $base_component (i32.eq (i32.load8_u (i32.add (local.get $a) (local.get $ae))) (i32.const 47)))
    (local.set $ae (i32.add (local.get $ae) (i32.const 1))) (br $base_scan)))
  (if (call $eq (i32.add (local.get $a) (local.get $ai)) (i32.sub (local.get $ae) (local.get $ai)) (call $c_dot_dot))
    (then (return (call $c_empty))))
  (local.set $start (call $text_mark))
  (block $up_done (loop $up
    (br_if $up_done (i32.ge_u (local.get $ai) (local.get $an)))
    (if (i32.gt_u (call $text_mark) (local.get $start)) (then (call $text_byte (i32.const 47))))
    (call $text_append (call $c_dot_dot))
    (block $next (loop $skip
      (br_if $next (i32.ge_u (local.get $ai) (local.get $an)))
      (local.set $ai (i32.add (local.get $ai) (i32.const 1)))
      (br_if $next (i32.eq (i32.load8_u (i32.add (local.get $a) (i32.sub (local.get $ai) (i32.const 1)))) (i32.const 47)))
      (br $skip)))
    (br $up)))
  (if (i32.lt_u (local.get $bi) (local.get $bn)) (then
    (if (i32.gt_u (call $text_mark) (local.get $start)) (then (call $text_byte (i32.const 47))))
    (call $text_append (i32.add (local.get $b) (local.get $bi)) (i32.sub (local.get $bn) (local.get $bi)))))
  (if (i32.eq (call $text_mark) (local.get $start)) (then (call $text_byte (i32.const 46))))
  (local.get $start) (i32.sub (call $text_mark) (local.get $start)))
