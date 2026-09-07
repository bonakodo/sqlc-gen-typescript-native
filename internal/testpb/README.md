# Protobuf test reference

`codegen.pb.go` is the upstream sqlc v1.31.1 message implementation, with only
`package plugin` changed to `package testpb`. Protocol tests compare the custom
codec with this independent implementation. The executable does not import it.

Source: https://github.com/sqlc-dev/sqlc/blob/a95e91d70ad9e1181253c333a1cfdd75ae4b95a5/internal/plugin/codegen.pb.go

Original SHA-256: `ee064a2792bc5cad34a6721e7ce7c0652fda6e67fa19de258f3a7c454a16e668`.
The corresponding schema lives in `protocol/codegen.proto`. Keep this reference
in sync when deliberately updating the pinned protocol. See `protocol/LICENSE`
for the upstream MIT license.
