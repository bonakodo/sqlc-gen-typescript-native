CREATE TABLE authors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL,
  notes TEXT,
  settings TEXT NOT NULL
);

CREATE TABLE records (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES authors(id),
  expires_at INTEGER NOT NULL
);
