These queries reproduce SQLite's left-to-right join precedence. Unlike
PostgreSQL and MySQL, SQLite gives commas and JOIN keywords the same precedence:
`a, b RIGHT JOIN c` means `(a CROSS JOIN b) RIGHT JOIN c`.

With empty a and b tables and c containing id=3, stock sqlc v1.31.1 and
better-sqlite3 13.0.3 produce one row with null a/b fields and c.id=3. The
end-to-end tests generate these queries with released sqlc, then execute them
against SQLite; the decoder must accept the missing left-side rows.
