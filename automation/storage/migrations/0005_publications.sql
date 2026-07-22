CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('published', 'failed')),
  provider TEXT NOT NULL,
  branch TEXT,
  file_path TEXT,
  commit_sha TEXT,
  pull_request_url TEXT,
  deployment_url TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (revision_id) REFERENCES revisions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (approval_id) REFERENCES approvals(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (
    (status = 'published' AND file_path IS NOT NULL AND commit_sha IS NOT NULL AND error_message IS NULL) OR
    (status = 'failed' AND error_message IS NOT NULL)
  )
);

CREATE INDEX publications_lesson_completed
  ON publications(lesson_id, completed_at);

CREATE UNIQUE INDEX publications_one_success_per_revision
  ON publications(revision_id)
  WHERE status = 'published';

CREATE TRIGGER publications_validate_insert
BEFORE INSERT ON publications
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM lessons AS lesson
    JOIN approvals AS approval ON approval.lesson_id = lesson.id
    WHERE lesson.id = NEW.lesson_id
      AND lesson.state = 'publishing'
      AND approval.id = NEW.approval_id
      AND approval.status = 'active'
      AND approval.revision_id = NEW.revision_id
  ) THEN RAISE(ABORT, 'publication requires an active approval and publishing lesson') END;
END;

CREATE TRIGGER publications_are_immutable
BEFORE UPDATE ON publications
BEGIN
  SELECT RAISE(ABORT, 'publications are immutable');
END;

CREATE TRIGGER publications_cannot_be_deleted
BEFORE DELETE ON publications
BEGIN
  SELECT RAISE(ABORT, 'publications are immutable');
END;

CREATE TRIGGER publications_record_creation
AFTER INSERT ON publications
BEGIN
  INSERT INTO lesson_events (
    event_key, lesson_id, event_type, revision_id, approval_id, payload_json, created_at
  ) VALUES (
    'publication:' || NEW.id,
    NEW.lesson_id,
    CASE WHEN NEW.status = 'published' THEN 'publication_published' ELSE 'publication_failed' END,
    NEW.revision_id,
    NEW.approval_id,
    json_object(
      'provider', NEW.provider,
      'branch', NEW.branch,
      'file_path', NEW.file_path,
      'commit_sha', NEW.commit_sha,
      'pull_request_url', NEW.pull_request_url,
      'deployment_url', NEW.deployment_url,
      'error_message', NEW.error_message
    ),
    NEW.completed_at
  );
END;
