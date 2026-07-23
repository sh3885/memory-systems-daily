-- Rebuild the parent table so one Korean calendar date can hold multiple
-- curriculum lessons. Child foreign keys resolve to the restored lessons table.
PRAGMA foreign_keys = OFF;

DROP TRIGGER lessons_validate_state_transition;
DROP TRIGGER lessons_require_current_approval;
DROP TRIGGER lessons_record_state_transition;
DROP TRIGGER lessons_prevent_version_without_transition;
DROP TRIGGER revisions_validate_insert;
DROP TRIGGER revisions_activate_new_revision;
DROP TRIGGER approval_challenges_validate_insert;
DROP TRIGGER approvals_validate_insert;
DROP TRIGGER publications_validate_insert;

CREATE TABLE lessons_rebuilt (
  id TEXT PRIMARY KEY,
  lesson_date TEXT NOT NULL,
  curriculum_ref TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'scheduled', 'researching', 'draft_ready', 'discussing', 'review_ready',
    'approved', 'publishing', 'published', 'research_failed', 'publish_failed'
  )),
  state_version INTEGER NOT NULL CHECK (state_version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(lesson_date) = 10),
  UNIQUE (lesson_date, curriculum_ref)
);

INSERT INTO lessons_rebuilt (
  id, lesson_date, curriculum_ref, state, state_version, created_at, updated_at
)
SELECT id, lesson_date, curriculum_ref, state, state_version, created_at, updated_at
FROM lessons;

DROP TABLE lessons;
ALTER TABLE lessons_rebuilt RENAME TO lessons;

CREATE INDEX lessons_date_order ON lessons(lesson_date, created_at);

CREATE TRIGGER lessons_validate_state_transition
BEFORE UPDATE OF state ON lessons
WHEN OLD.state <> NEW.state
BEGIN
  SELECT CASE
    WHEN NEW.state_version <> OLD.state_version + 1
      THEN RAISE(ABORT, 'state_version must increment by one')
    WHEN NOT (
      (OLD.state = 'scheduled' AND NEW.state = 'researching') OR
      (OLD.state = 'researching' AND NEW.state IN ('draft_ready', 'research_failed')) OR
      (OLD.state = 'research_failed' AND NEW.state = 'researching') OR
      (OLD.state = 'draft_ready' AND NEW.state IN ('discussing', 'review_ready')) OR
      (OLD.state = 'discussing' AND NEW.state = 'review_ready') OR
      (OLD.state = 'review_ready' AND NEW.state IN ('discussing', 'approved')) OR
      (OLD.state = 'approved' AND NEW.state IN ('discussing', 'publishing')) OR
      (OLD.state = 'publishing' AND NEW.state IN ('published', 'publish_failed')) OR
      (OLD.state = 'publish_failed' AND NEW.state IN ('discussing', 'publishing'))
    ) THEN RAISE(ABORT, 'illegal lesson state transition')
  END;
END;

CREATE TRIGGER lessons_require_current_approval
BEFORE UPDATE OF state ON lessons
WHEN OLD.state <> NEW.state AND NEW.state IN ('approved', 'publishing')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM approvals AS approval
    JOIN lesson_heads AS head ON head.lesson_id = approval.lesson_id
    WHERE approval.lesson_id = NEW.id
      AND approval.status = 'active'
      AND approval.revision_id = head.revision_id
      AND approval.revision_number = head.revision_number
      AND approval.content_hash = head.content_hash
      AND approval.expires_at > NEW.updated_at
  ) THEN RAISE(ABORT, 'current unexpired approval is required') END;
END;

CREATE TRIGGER lessons_record_state_transition
AFTER UPDATE OF state ON lessons
WHEN OLD.state <> NEW.state
BEGIN
  INSERT INTO lesson_events (
    event_key, lesson_id, event_type, from_state, to_state, payload_json, created_at
  ) VALUES (
    'state:' || NEW.id || ':' || NEW.state_version,
    NEW.id,
    'state_transition',
    OLD.state,
    NEW.state,
    '{}',
    NEW.updated_at
  );

  UPDATE approvals
  SET status = 'invalidated',
      invalidated_at = NEW.updated_at,
      invalidation_reason = 'returned_to_discussion'
  WHERE NEW.state = 'discussing'
    AND lesson_id = NEW.id
    AND status = 'active';
END;

CREATE TRIGGER lessons_prevent_version_without_transition
BEFORE UPDATE OF state_version ON lessons
WHEN OLD.state = NEW.state AND OLD.state_version <> NEW.state_version
BEGIN
  SELECT RAISE(ABORT, 'state_version cannot change without a state transition');
END;

CREATE TRIGGER revisions_validate_insert
BEFORE INSERT ON revisions
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM lessons WHERE id = NEW.lesson_id AND state IN ('publishing', 'published')
  ) THEN RAISE(ABORT, 'cannot revise while publishing or after publication') END;

  SELECT CASE WHEN NEW.revision_number <> COALESCE((
    SELECT revision_number + 1 FROM lesson_heads WHERE lesson_id = NEW.lesson_id
  ), 1) THEN RAISE(ABORT, 'revision_number must be next') END;
END;

CREATE TRIGGER revisions_activate_new_revision
AFTER INSERT ON revisions
BEGIN
  UPDATE approvals
  SET status = 'invalidated',
      invalidated_at = NEW.created_at,
      invalidation_reason = 'new_revision'
  WHERE lesson_id = NEW.lesson_id AND status = 'active';

  UPDATE approval_challenges
  SET status = 'invalidated',
      invalidated_at = NEW.created_at,
      invalidation_reason = 'new_revision'
  WHERE lesson_id = NEW.lesson_id AND status = 'pending';

  INSERT INTO lesson_heads (
    lesson_id, revision_id, revision_number, content_hash, updated_at
  ) VALUES (
    NEW.lesson_id, NEW.id, NEW.revision_number, NEW.content_hash, NEW.created_at
  ) ON CONFLICT(lesson_id) DO UPDATE SET
    revision_id = excluded.revision_id,
    revision_number = excluded.revision_number,
    content_hash = excluded.content_hash,
    updated_at = excluded.updated_at;

  UPDATE lessons
  SET state = CASE
        WHEN state IN ('review_ready', 'approved', 'publish_failed') THEN 'discussing'
        ELSE state
      END,
      state_version = state_version + CASE
        WHEN state IN ('review_ready', 'approved', 'publish_failed') THEN 1
        ELSE 0
      END,
      updated_at = NEW.created_at
  WHERE id = NEW.lesson_id;

  INSERT INTO lesson_events (
    event_key, lesson_id, event_type, revision_id, payload_json, created_at
  ) VALUES (
    'revision:' || NEW.id,
    NEW.lesson_id,
    'revision_created',
    NEW.id,
    json_object(
      'revision_number', NEW.revision_number,
      'content_hash', NEW.content_hash,
      'operation_key', NEW.operation_key
    ),
    NEW.created_at
  );
END;

CREATE TRIGGER approval_challenges_validate_insert
BEFORE INSERT ON approval_challenges
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM lessons AS lesson
    JOIN lesson_heads AS head ON head.lesson_id = lesson.id
    WHERE lesson.id = NEW.lesson_id
      AND lesson.state = 'review_ready'
      AND head.revision_id = NEW.revision_id
      AND head.revision_number = NEW.revision_number
      AND head.content_hash = NEW.content_hash
  ) THEN RAISE(ABORT, 'challenge must target current review-ready revision') END;
END;

CREATE TRIGGER approvals_validate_insert
BEFORE INSERT ON approvals
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM approval_challenges AS challenge
    JOIN lessons AS lesson ON lesson.id = challenge.lesson_id
    JOIN lesson_heads AS head ON head.lesson_id = lesson.id
    WHERE challenge.id = NEW.challenge_id
      AND challenge.status = 'consumed'
      AND challenge.lesson_id = NEW.lesson_id
      AND challenge.revision_id = NEW.revision_id
      AND challenge.revision_number = NEW.revision_number
      AND challenge.content_hash = NEW.content_hash
      AND challenge.telegram_user_id = NEW.telegram_user_id
      AND challenge.telegram_chat_id = NEW.telegram_chat_id
      AND challenge.expires_at = NEW.expires_at
      AND challenge.expires_at > NEW.approved_at
      AND lesson.state = 'review_ready'
      AND head.revision_id = NEW.revision_id
      AND head.revision_number = NEW.revision_number
      AND head.content_hash = NEW.content_hash
  ) THEN RAISE(ABORT, 'approval must consume a current bound challenge') END;
END;

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

PRAGMA foreign_keys = ON;
