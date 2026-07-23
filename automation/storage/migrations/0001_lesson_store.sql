PRAGMA foreign_keys = ON;

CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  lesson_date TEXT NOT NULL,
  curriculum_ref TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK (state IN (
    'scheduled', 'researching', 'draft_ready', 'discussing', 'review_ready',
    'approved', 'publishing', 'published', 'research_failed', 'publish_failed'
  )),
  state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(lesson_date) = 10),
  UNIQUE (lesson_date, curriculum_ref)
);

CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_by TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (lesson_id, revision_number),
  UNIQUE (lesson_id, id, revision_number, content_hash)
);

CREATE TABLE lesson_heads (
  lesson_id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (lesson_id, revision_id, revision_number, content_hash)
    REFERENCES revisions(lesson_id, id, revision_number, content_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE approval_challenges (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  telegram_user_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  nonce_hash TEXT NOT NULL UNIQUE CHECK (length(nonce_hash) = 64),
  operation_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'consumed', 'invalidated', 'expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  invalidated_at TEXT,
  invalidation_reason TEXT,
  FOREIGN KEY (lesson_id, revision_id, revision_number, content_hash)
    REFERENCES revisions(lesson_id, id, revision_number, content_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX approval_challenges_one_pending_per_lesson
  ON approval_challenges(lesson_id)
  WHERE status = 'pending';

CREATE TRIGGER lesson_heads_validate_update
BEFORE UPDATE ON lesson_heads
BEGIN
  SELECT CASE WHEN NEW.lesson_id IS NOT OLD.lesson_id
    THEN RAISE(ABORT, 'lesson head ownership is immutable') END;
  SELECT CASE WHEN NEW.revision_number <> OLD.revision_number + 1
    THEN RAISE(ABORT, 'lesson head must advance by one revision') END;
END;

CREATE TRIGGER lesson_heads_cannot_be_deleted
BEFORE DELETE ON lesson_heads
BEGIN
  SELECT RAISE(ABORT, 'lesson heads cannot be deleted');
END;

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE,
  lesson_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  telegram_user_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  operation_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalidated', 'consumed', 'expired')),
  approved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  invalidated_at TEXT,
  invalidation_reason TEXT,
  consumed_at TEXT,
  FOREIGN KEY (challenge_id) REFERENCES approval_challenges(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (lesson_id, revision_id, revision_number, content_hash)
    REFERENCES revisions(lesson_id, id, revision_number, content_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX approvals_one_active_per_lesson
  ON approvals(lesson_id)
  WHERE status = 'active';

CREATE INDEX approvals_revision_status
  ON approvals(revision_id, status);

CREATE TABLE lesson_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  lesson_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  revision_id TEXT,
  challenge_id TEXT,
  approval_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (revision_id) REFERENCES revisions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (challenge_id) REFERENCES approval_challenges(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (approval_id) REFERENCES approvals(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (json_valid(payload_json))
);

CREATE INDEX lesson_events_lesson_sequence
  ON lesson_events(lesson_id, sequence);

CREATE TABLE processed_telegram_updates (
  bot_id TEXT NOT NULL,
  update_id INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  handled_at TEXT,
  result TEXT,
  PRIMARY KEY (bot_id, update_id)
);

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

CREATE TRIGGER revisions_are_immutable
BEFORE UPDATE ON revisions
BEGIN
  SELECT RAISE(ABORT, 'revisions are immutable');
END;

CREATE TRIGGER revisions_cannot_be_deleted
BEFORE DELETE ON revisions
BEGIN
  SELECT RAISE(ABORT, 'revisions are immutable');
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

CREATE TRIGGER approval_challenges_validate_update
BEFORE UPDATE ON approval_challenges
BEGIN
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id OR
    NEW.lesson_id IS NOT OLD.lesson_id OR
    NEW.revision_id IS NOT OLD.revision_id OR
    NEW.revision_number IS NOT OLD.revision_number OR
    NEW.content_hash IS NOT OLD.content_hash OR
    NEW.telegram_user_id IS NOT OLD.telegram_user_id OR
    NEW.telegram_chat_id IS NOT OLD.telegram_chat_id OR
    NEW.nonce_hash IS NOT OLD.nonce_hash OR
    NEW.operation_key IS NOT OLD.operation_key OR
    NEW.created_at IS NOT OLD.created_at OR
    NEW.expires_at IS NOT OLD.expires_at
  THEN RAISE(ABORT, 'approval challenge binding is immutable') END;

  SELECT CASE WHEN NOT (
    (OLD.status = 'pending' AND NEW.status IN ('consumed', 'invalidated', 'expired')) OR
    (OLD.status = NEW.status)
  ) THEN RAISE(ABORT, 'illegal approval challenge transition') END;
END;

CREATE TRIGGER approval_challenges_cannot_be_deleted
BEFORE DELETE ON approval_challenges
BEGIN
  SELECT RAISE(ABORT, 'approval challenges are append-preserved');
END;

CREATE TRIGGER approval_challenges_record_creation
AFTER INSERT ON approval_challenges
BEGIN
  INSERT INTO lesson_events (
    event_key, lesson_id, event_type, revision_id, challenge_id, payload_json, created_at
  ) VALUES (
    'challenge:' || NEW.id,
    NEW.lesson_id,
    'approval_challenge_created',
    NEW.revision_id,
    NEW.id,
    json_object('telegram_user_id', NEW.telegram_user_id, 'telegram_chat_id', NEW.telegram_chat_id),
    NEW.created_at
  );
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

CREATE TRIGGER approvals_validate_update
BEFORE UPDATE ON approvals
BEGIN
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id OR
    NEW.challenge_id IS NOT OLD.challenge_id OR
    NEW.lesson_id IS NOT OLD.lesson_id OR
    NEW.revision_id IS NOT OLD.revision_id OR
    NEW.revision_number IS NOT OLD.revision_number OR
    NEW.content_hash IS NOT OLD.content_hash OR
    NEW.telegram_user_id IS NOT OLD.telegram_user_id OR
    NEW.telegram_chat_id IS NOT OLD.telegram_chat_id OR
    NEW.operation_key IS NOT OLD.operation_key OR
    NEW.approved_at IS NOT OLD.approved_at OR
    NEW.expires_at IS NOT OLD.expires_at
  THEN RAISE(ABORT, 'approval binding is immutable') END;

  SELECT CASE WHEN NOT (
    (OLD.status = 'active' AND NEW.status IN ('invalidated', 'consumed', 'expired')) OR
    (OLD.status = NEW.status)
  ) THEN RAISE(ABORT, 'illegal approval transition') END;
END;

CREATE TRIGGER approvals_cannot_be_deleted
BEFORE DELETE ON approvals
BEGIN
  SELECT RAISE(ABORT, 'approvals are append-preserved');
END;

CREATE TRIGGER approvals_record_creation
AFTER INSERT ON approvals
BEGIN
  INSERT INTO lesson_events (
    event_key, lesson_id, event_type, revision_id, challenge_id, approval_id, payload_json, created_at
  ) VALUES (
    'approval:' || NEW.id,
    NEW.lesson_id,
    'approval_created',
    NEW.revision_id,
    NEW.challenge_id,
    NEW.id,
    json_object('telegram_user_id', NEW.telegram_user_id, 'telegram_chat_id', NEW.telegram_chat_id),
    NEW.approved_at
  );
END;

CREATE TRIGGER lesson_events_are_append_only
BEFORE UPDATE ON lesson_events
BEGIN
  SELECT RAISE(ABORT, 'lesson events are append-only');
END;

CREATE TRIGGER lesson_events_cannot_be_deleted
BEFORE DELETE ON lesson_events
BEGIN
  SELECT RAISE(ABORT, 'lesson events are append-only');
END;
