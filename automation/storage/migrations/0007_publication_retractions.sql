-- Publications are immutable audit rows, so a post removed from the site cannot be
-- deleted or updated there. A retraction records that the published artifact no
-- longer exists, which lets curriculum scheduling rewind to that lesson.
CREATE TABLE publication_retractions (
  publication_id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  file_path TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (publication_id) REFERENCES publications(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX publication_retractions_lesson ON publication_retractions(lesson_id);
