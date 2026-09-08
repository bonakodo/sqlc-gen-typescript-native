CREATE TABLE authors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  bio TEXT,
  score REAL NOT NULL DEFAULT 0
);
CREATE TABLE records (
  id INTEGER PRIMARY KEY,
  event_count BIGINT NOT NULL,
  active BOOLEAN NOT NULL,
  created_at DATETIME NOT NULL,
  payload BLOB,
  document JSON
);
