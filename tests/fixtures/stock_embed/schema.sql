CREATE TABLE students (
  id integer PRIMARY KEY,
  name text NOT NULL,
  nickname text
);
CREATE TABLE test_scores (
  id integer PRIMARY KEY,
  student_id integer NOT NULL REFERENCES students(id),
  score integer NOT NULL
);
