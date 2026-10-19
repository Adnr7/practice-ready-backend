ALTER TABLE `bookings` ADD COLUMN `end_date` text;
--> statement-breakpoint
UPDATE `bookings` SET `end_date` = `date` WHERE `end_date` IS NULL;
--> statement-breakpoint
ALTER TABLE `booking_policies` ADD COLUMN `student_window` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `booking_window_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `booking_window_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `closure_window_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `closure_window_update`;
--> statement-breakpoint
CREATE TRIGGER `booking_window_insert` BEFORE INSERT ON bookings
WHEN NEW.status = 'confirmed'
BEGIN
  SELECT RAISE(ABORT, 'BOOKING_ROOM_UNAVAILABLE') WHERE NOT EXISTS
    (SELECT 1 FROM rooms WHERE id = NEW.room_id AND is_active = 1 AND readiness_state <> 'closed');
  SELECT RAISE(ABORT, 'BOOKING_OVERLAP') WHERE EXISTS (
    SELECT 1 FROM bookings b WHERE b.status = 'confirmed'
      AND (b.room_id = NEW.room_id OR (NEW.user_id IS NOT NULL AND b.user_id = NEW.user_id))
      AND julianday(b.date || 'T' || b.start_time, '-330 minutes') < julianday(
        COALESCE(NEW.end_date, NEW.date) || 'T' || NEW.end_time,
        CASE WHEN COALESCE(NEW.end_date, NEW.date) = NEW.date AND NEW.end_time = '00:00' THEN '+1 day' ELSE '+0 day' END,
        '-330 minutes')
      AND julianday(NEW.date || 'T' || NEW.start_time, '-330 minutes') < julianday(
        COALESCE(b.end_date, b.date) || 'T' || b.end_time,
        CASE WHEN COALESCE(b.end_date, b.date) = b.date AND b.end_time = '00:00' THEN '+1 day' ELSE '+0 day' END,
        '-330 minutes')
  );
  SELECT RAISE(ABORT, 'BOOKING_ROOM_CLOSED') WHERE EXISTS (
    SELECT 1 FROM room_closures c WHERE c.room_id = NEW.room_id AND c.is_active = 1
      AND julianday(c.starts_at) < julianday(
        COALESCE(NEW.end_date, NEW.date) || 'T' || NEW.end_time,
        CASE WHEN COALESCE(NEW.end_date, NEW.date) = NEW.date AND NEW.end_time = '00:00' THEN '+1 day' ELSE '+0 day' END,
        '-330 minutes')
      AND julianday(c.ends_at) > julianday(NEW.date || 'T' || NEW.start_time, '-330 minutes')
  );
END;
--> statement-breakpoint
CREATE TRIGGER `closure_window_insert` BEFORE INSERT ON room_closures
WHEN NEW.is_active = 1
BEGIN
  SELECT RAISE(ABORT, 'ROOM_CLOSURE_BOOKING_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM bookings b WHERE b.room_id = NEW.room_id AND b.status = 'confirmed'
      AND julianday(b.date || 'T' || b.start_time, '-330 minutes') < julianday(NEW.ends_at)
      AND julianday(COALESCE(b.end_date, b.date) || 'T' || b.end_time,
        CASE WHEN COALESCE(b.end_date, b.date) = b.date AND b.end_time = '00:00' THEN '+1 day' ELSE '+0 day' END,
        '-330 minutes') > julianday(NEW.starts_at)
  );
  SELECT RAISE(ABORT, 'ROOM_CLOSURE_OVERLAP') WHERE EXISTS (
    SELECT 1 FROM room_closures c WHERE c.room_id = NEW.room_id AND c.is_active = 1
      AND julianday(c.starts_at) < julianday(NEW.ends_at) AND julianday(c.ends_at) > julianday(NEW.starts_at)
  );
END;
--> statement-breakpoint
CREATE TRIGGER `closure_window_update` BEFORE UPDATE OF room_id, starts_at, ends_at, is_active ON room_closures
WHEN NEW.is_active = 1
BEGIN
  SELECT RAISE(ABORT, 'ROOM_CLOSURE_BOOKING_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM bookings b WHERE b.room_id = NEW.room_id AND b.status = 'confirmed'
      AND julianday(b.date || 'T' || b.start_time, '-330 minutes') < julianday(NEW.ends_at)
      AND julianday(COALESCE(b.end_date, b.date) || 'T' || b.end_time,
        CASE WHEN COALESCE(b.end_date, b.date) = b.date AND b.end_time = '00:00' THEN '+1 day' ELSE '+0 day' END,
        '-330 minutes') > julianday(NEW.starts_at)
  );
  SELECT RAISE(ABORT, 'ROOM_CLOSURE_OVERLAP') WHERE EXISTS (
    SELECT 1 FROM room_closures c WHERE c.id <> NEW.id AND c.room_id = NEW.room_id AND c.is_active = 1
      AND julianday(c.starts_at) < julianday(NEW.ends_at) AND julianday(c.ends_at) > julianday(NEW.starts_at)
  );
END;
--> statement-breakpoint
CREATE TRIGGER `booking_window_update` BEFORE UPDATE OF room_id, user_id, date, end_date, start_time, end_time, status ON bookings
WHEN NEW.status = 'confirmed'
BEGIN
  SELECT RAISE(ABORT, 'BOOKING_ROOM_UNAVAILABLE') WHERE NOT EXISTS
    (SELECT 1 FROM rooms WHERE id = NEW.room_id AND is_active = 1 AND readiness_state <> 'closed');
  SELECT RAISE(ABORT, 'BOOKING_OVERLAP') WHERE EXISTS (
    SELECT 1 FROM bookings b WHERE b.id <> NEW.id AND b.status = 'confirmed'
      AND (b.room_id = NEW.room_id OR (NEW.user_id IS NOT NULL AND b.user_id = NEW.user_id))
      AND julianday(b.date || 'T' || b.start_time, '-330 minutes') < julianday(
        COALESCE(NEW.end_date, NEW.date) || 'T' || NEW.end_time,
        CASE WHEN COALESCE(NEW.end_date, NEW.date) = NEW.date AND NEW.end_time = '00:00' THEN '+1 day' ELSE '+0 day' END,
        '-330 minutes')
      AND julianday(NEW.date || 'T' || NEW.start_time, '-330 minutes') < julianday(
        COALESCE(b.end_date, b.date) || 'T' || b.end_time,
        CASE WHEN COALESCE(b.end_date, b.date) = b.date AND b.end_time = '00:00' THEN '+1 day' ELSE '+0 day' END,
        '-330 minutes')
  );
  SELECT RAISE(ABORT, 'BOOKING_ROOM_CLOSED') WHERE EXISTS (
    SELECT 1 FROM room_closures c WHERE c.room_id = NEW.room_id AND c.is_active = 1
      AND julianday(c.starts_at) < julianday(
        COALESCE(NEW.end_date, NEW.date) || 'T' || NEW.end_time,
        CASE WHEN COALESCE(NEW.end_date, NEW.date) = NEW.date AND NEW.end_time = '00:00' THEN '+1 day' ELSE '+0 day' END,
        '-330 minutes')
      AND julianday(c.ends_at) > julianday(NEW.date || 'T' || NEW.start_time, '-330 minutes')
  );
END;
