;; This is the complete generation pass over decoded protobuf records. Each
;; output file occupies one final span. Index text is emitted last because its
;; imports and namespace names depend on all query modules; its name scope is
;; created early to retain the reference generator's name-allocation order.
(func $group_queries
  (local $q i32) (local $next i32) (local $group i32)
  (local.set $q (call $child (global.get $gen_request) (i32.const 3)))
  (block $done (loop $queries
    (br_if $done (i32.eqz (local.get $q)))
    (local.set $next (call $next (local.get $q)))
    (if (i32.eqz (call $text_len (local.get $q) (i32.const 2))) (then (call $error (call $c_missing_query))))
    (local.set $group (global.get $gen_groups))
    (block $found (loop $find
      (br_if $found (i32.eqz (local.get $group)))
      (br_if $found (call $eq (call $get_text (local.get $group) (i32.const 8)) (call $text (local.get $q) (i32.const 7))))
      (local.set $group (call $next (local.get $group))) (br $find)))
    (if (i32.eqz (local.get $group)) (then
      (local.set $group (call $work_record (i32.const 108)))
      (call $set_text (local.get $group) (i32.const 8) (call $text (local.get $q) (i32.const 7)))
      (global.set $gen_groups (call $sorted_insert (global.get $gen_groups) (local.get $group) (i32.const 8)))))
    ;; Query.name lives at protobuf record offset 32 + 2*12 = 56.
    (i32.store offset=16 (local.get $group) (call $sorted_insert (i32.load offset=16 (local.get $group)) (local.get $q) (i32.const 56)))
    (local.set $q (local.get $next)) (br $queries))))

(func $reserve_models (param $m i32) (local $model i32)
  (local.set $model (global.get $gen_models))
  (block $done (loop $models
    (br_if $done (i32.eqz (local.get $model)))
    (call $reserve (i32.load offset=16 (local.get $m)) (call $get_text (local.get $model) (i32.const 16)))
    (local.set $model (call $next (local.get $model))) (br $models))))

(func $asset_file (param $name i32) (param $name_n i32) (param $p i32) (param $n i32)
  (call $file_begin (local.get $name) (local.get $name_n)) (call $emit (local.get $p) (local.get $n)) (call $file_end))

(func $generate (param $request i32)
  (local $m i32) (local $index i32) (local $item i32) (local $group i32)
  (local $q i32) (local $plan i32) (local $tail i32) (local $used_files i32) (local $factory_names i32)
  (local $factory i32) (local $factory_n i32) (local $scope i32) (local $scratch i32)
  (global.set $gen_request (local.get $request))
  (global.set $gen_settings (call $child (local.get $request) (i32.const 1)))
  (global.set $gen_catalog (call $child (local.get $request) (i32.const 2)))
  (if (i32.or (i32.eqz (global.get $gen_settings)) (i32.eqz (global.get $gen_catalog)))
    (then (call $error (call $c_missing_catalog))))
  (global.set $err_options (i32.const 1))
  (global.set $gen_options (call $options_parse (call $text (local.get $request) (i32.const 5))))
  (global.set $err_options (i32.const 0))
  (call $opt_validate_engine (call $text (global.get $gen_settings) (i32.const 2)))
  (global.set $gen_engine (i32.const 1))
  (if (call $eq (call $text (global.get $gen_settings) (i32.const 2)) (call $c_postgresql)) (then (global.set $gen_engine (i32.const 2))))
  (if (call $eq (call $text (global.get $gen_settings) (i32.const 2)) (call $c_mysql)) (then (global.set $gen_engine (i32.const 3))))
  (global.set $gen_query_count (call $present (local.get $request) (i32.const 3)))
  (call $prepare_overrides) (call $build_models) (call $build_enums)
  (local.set $m (call $module_new (call $c_models_file))) (call $reserve_models (local.get $m)) (call $module_begin (local.get $m))
  (local.set $item (global.get $gen_models))
  (block $models_done (loop $models
    (br_if $models_done (i32.eqz (local.get $item)))
    ;; These fields are needed only while printing one model. Imports retain
    ;; their names explicitly; all other temporary text can be reused at once.
    (local.set $scratch (call $text_mark))
    (call $emit_model (local.get $m) (local.get $item))
    (call $text_reset (local.get $scratch))
    (local.set $item (call $next (local.get $item))) (br $models)))
  (call $module_end (local.get $m))
  (call $group_queries)
  (local.set $index (call $module_new (call $c_index_file))) (call $reserve_models (local.get $index))
  (local.set $scope (i32.load offset=16 (local.get $index)))
  (if (i32.and (global.get $opt_factory) (i32.eqz (global.get $opt_types_only)))
    (then (call $reserve (local.get $scope) (call $c_create_queries))))
  (if (global.get $gen_enums) (then
    (local.set $m (call $module_new (call $c_enums_file))) (call $module_begin (local.get $m))
    (local.set $item (global.get $gen_enums))
    (loop $enums
      (call $reserve (local.get $scope) (call $get_text (local.get $item) (i32.const 24)))
      (call $reserve (local.get $scope) (call $get_text (local.get $item) (i32.const 32)))
      (call $emit_enum (local.get $item))
      (local.set $item (call $next (local.get $item))) (br_if $enums (local.get $item)))
    (call $module_end (local.get $m))))
  (if (call $emits_json) (then
    (call $reserve (local.get $scope) (call $c_json_value))
    (call $reserve (local.get $scope) (call $c_json_object))
    (call $reserve (local.get $scope) (call $c_json_array))
    (call $asset_file (call $c_json_file) (global.get $asset_json_p) (global.get $asset_json_n))))
  (if (call $emits_runtime) (then
    (call $reserve (local.get $scope) (call $c_codec_error)) (call $reserve (local.get $scope) (call $c_codec_context))))
  (local.set $factory_names (call $name_scope))
  (local.set $used_files (call $name_scope_raw))
  (call $reserve (local.get $used_files) (call $c_models_file)) (call $reserve (local.get $used_files) (call $c_index_file))
  (call $reserve (local.get $used_files) (call $c_runtime_file)) (call $reserve (local.get $used_files) (call $c_json_file))
  (call $reserve (local.get $used_files) (call $c_enums_file)) (call $reserve (local.get $used_files) (call $c_codec_error_file))
  (local.set $group (global.get $gen_groups))
  (block $groups_done (loop $groups
    (br_if $groups_done (i32.eqz (local.get $group)))
    (call $set_text (local.get $group) (i32.const 32) (call $query_filename (call $get_text (local.get $group) (i32.const 8))))
    (if (call $name_used (local.get $used_files) (call $get_text (local.get $group) (i32.const 32)))
      (then (call $error (call $fmt1 (call $c_filename_collision) (call $get_text (local.get $group) (i32.const 32))))))
    (call $reserve (local.get $used_files) (call $get_text (local.get $group) (i32.const 32)))
    (local.set $m (call $module_new (call $get_text (local.get $group) (i32.const 32))))
    (local.set $q (i32.load offset=16 (local.get $group))) (local.set $tail (i32.const 0))
    (block $planned (loop $plans
      (br_if $planned (i32.eqz (local.get $q)))
      (global.set $err_query (local.get $q))
      (local.set $plan (call $plan_query (local.get $m) (local.get $q)))
      (if (local.get $tail) (then (i32.store offset=4 (local.get $tail) (local.get $plan)))
        (else (i32.store offset=64 (local.get $group) (local.get $plan))))
      (local.set $tail (local.get $plan)) (local.set $q (call $next (local.get $q))) (br $plans)))
    (call $module_begin (local.get $m))
    (local.set $plan (i32.load offset=64 (local.get $group)))
    (block $emitted (loop $plans
      (br_if $emitted (i32.eqz (local.get $plan)))
      (global.set $err_query (i32.load offset=8 (local.get $plan)))
      ;; Plans already own their live text. Emission adds no lasting text
      ;; except import names, which module_import copies to its fixed table.
      (local.set $scratch (call $text_mark))
      (call $emit_query (local.get $m) (local.get $plan))
      (call $text_reset (local.get $scratch))
      (local.set $plan (call $next (local.get $plan))) (br $plans)))
    (global.set $err_query (i32.const 0))
    (if (i32.and (global.get $opt_factory) (i32.eqz (global.get $opt_types_only))) (then
      (call $emit_query_factory (local.get $m) (i32.load offset=64 (local.get $group))) (local.set $factory_n) (local.set $factory)
      (call $set_text (local.get $group) (i32.const 48) (call $name_take (local.get $factory_names) (call $query_namespace (call $get_text (local.get $group) (i32.const 8)))))
      (call $set_text (local.get $group) (i32.const 56) (call $module_import (local.get $index)
        (call $concat (call $c_dot_slash) (call $get_text (local.get $group) (i32.const 32))) (local.get $factory) (local.get $factory_n) (i32.const 0)))))
    (call $module_end (local.get $m))
    (call $set_text (local.get $group) (i32.const 40) (call $name_take (local.get $scope)
      (call $declaration_name (call $without_ext (call $get_text (local.get $group) (i32.const 8))))))
    (local.set $group (call $next (local.get $group))) (br $groups)))
  (call $module_begin (local.get $index))
  (call $line (call $c_index_models))
  (if (global.get $gen_enums) (then (call $line (call $c_index_enums))))
  (if (call $emits_json) (then (call $line (call $c_index_json))))
  (if (call $emits_runtime) (then (call $line (call $c_index_codec))))
  (local.set $group (global.get $gen_groups))
  (block $index_done (loop $groups
    (br_if $index_done (i32.eqz (local.get $group)))
    (call $line (call $fmt3 (call $c_index_namespace)
      (if (result i32 i32) (global.get $opt_types_only) (then (call $c_type_space)) (else (call $c_empty)))
      (call $get_text (local.get $group) (i32.const 40))
      (call $quote (call $concat (call $c_dot_slash) (call $get_text (local.get $group) (i32.const 32))))))
    (local.set $group (call $next (local.get $group))) (br $groups)))
  (if (i32.and (global.get $opt_factory) (i32.eqz (global.get $opt_types_only))) (then (call $emit_root_factory (local.get $index))))
  (call $module_end (local.get $index))
  (if (call $emits_runtime) (then
    (call $emit_runtime)
    (call $asset_file (call $c_codec_error_file) (global.get $asset_codec_error_p) (global.get $asset_codec_error_n)))))
