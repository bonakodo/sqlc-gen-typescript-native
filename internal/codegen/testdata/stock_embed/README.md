`request.json` captures sqlc v1.31.1's PostgreSQL plugin request for `schema.sql`
and `query.sql`, using `{"driver":"pg"}` plugin options. The capture removes the
unused system catalog schemas and the local process-plugin command from
`settings.codegen`; query and table metadata remain unchanged.

Stock sqlc omits `notNull`, `table`, and `tableAlias` from embedded result columns
for both inner and outer joins. The fixture keeps those omissions so tests do
not accidentally depend on the unmerged native host changes.
