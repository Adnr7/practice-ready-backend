CREATE TRIGGER audit_booking_created
AFTER INSERT ON bookings
BEGIN
  INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details, created_at)
  SELECT NEW.user_id, 'booked', 'reservation', NEW.booking_ref, NULL,
    json_object(
      'bookingId', NEW.id,
      'bookingRef', NEW.booking_ref,
      'studentName', COALESCE(u.full_name, NEW.guest_student_name, 'Unknown student'),
      'studentEmail', COALESCE(u.email, ''),
      'roomId', NEW.room_id,
      'roomName', r.name,
      'actorName', u.full_name,
      'actorEmail', u.email,
      'date', NEW.date,
      'endDate', COALESCE(NEW.end_date, NEW.date),
      'startTime', NEW.start_time,
      'endTime', NEW.end_time,
      'durationMinutes', NEW.duration_minutes,
      'status', NEW.status,
      'participants', COALESCE((SELECT json_group_array(json_object('name', pu.full_name, 'email', pu.email))
        FROM booking_participants bp JOIN users pu ON pu.id = bp.user_id WHERE bp.booking_id = NEW.id AND bp.status = 'accepted'), '[]')
    ),
    COALESCE(NEW.created_at, CURRENT_TIMESTAMP)
  FROM rooms r LEFT JOIN users u ON u.id = NEW.user_id
  WHERE r.id = NEW.room_id;
END;
--> statement-breakpoint
CREATE TRIGGER audit_booking_changed
AFTER UPDATE ON bookings
WHEN OLD.status <> NEW.status
  OR OLD.room_id <> NEW.room_id
  OR OLD.date <> NEW.date
  OR COALESCE(OLD.end_date, OLD.date) <> COALESCE(NEW.end_date, NEW.date)
  OR OLD.start_time <> NEW.start_time
  OR OLD.end_time <> NEW.end_time
  OR OLD.session_ended_at IS NOT NEW.session_ended_at
BEGIN
  INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details, created_at)
  SELECT
    COALESCE((SELECT h.actor_user_id FROM booking_history h WHERE h.booking_id = NEW.id ORDER BY h.id DESC LIMIT 1),
             (SELECT bp.invited_by_user_id FROM booking_participants bp WHERE bp.booking_id = NEW.id AND bp.status = 'accepted' ORDER BY bp.responded_at DESC LIMIT 1), NEW.user_id),
    CASE
      WHEN OLD.room_id <> NEW.room_id OR OLD.date <> NEW.date
        OR COALESCE(OLD.end_date, OLD.date) <> COALESCE(NEW.end_date, NEW.date)
        OR OLD.start_time <> NEW.start_time OR OLD.end_time <> NEW.end_time THEN 'rescheduled'
      WHEN NEW.status = 'cancelled' THEN 'cancelled'
      WHEN NEW.status = 'completed' OR NEW.session_ended_at IS NOT NULL THEN 'session_ended'
      ELSE 'updated'
    END,
    'reservation', NEW.booking_ref,
    COALESCE((SELECT h.reason FROM booking_history h WHERE h.booking_id = NEW.id ORDER BY h.id DESC LIMIT 1), NEW.cancellation_reason),
    json_object(
      'bookingId', NEW.id,
      'bookingRef', NEW.booking_ref,
      'studentName', COALESCE(u.full_name, NEW.guest_student_name, 'Unknown student'),
      'studentEmail', COALESCE(u.email, ''),
      'roomId', NEW.room_id,
      'roomName', newRoom.name,
      'date', NEW.date,
      'endDate', COALESCE(NEW.end_date, NEW.date),
      'startTime', NEW.start_time,
      'endTime', NEW.end_time,
      'actorName', (SELECT actor.full_name FROM users actor WHERE actor.id = COALESCE((SELECT h.actor_user_id FROM booking_history h WHERE h.booking_id = NEW.id ORDER BY h.id DESC LIMIT 1), (SELECT bp.invited_by_user_id FROM booking_participants bp WHERE bp.booking_id = NEW.id AND bp.status = 'accepted' ORDER BY bp.responded_at DESC LIMIT 1), NEW.user_id)),
      'actorEmail', (SELECT actor.email FROM users actor WHERE actor.id = COALESCE((SELECT h.actor_user_id FROM booking_history h WHERE h.booking_id = NEW.id ORDER BY h.id DESC LIMIT 1), (SELECT bp.invited_by_user_id FROM booking_participants bp WHERE bp.booking_id = NEW.id AND bp.status = 'accepted' ORDER BY bp.responded_at DESC LIMIT 1), NEW.user_id)),
      'previousRoomName', oldRoom.name,
      'previousDate', OLD.date,
      'previousEndDate', COALESCE(OLD.end_date, OLD.date),
      'previousStartTime', OLD.start_time,
      'previousEndTime', OLD.end_time,
      'status', NEW.status,
      'durationMinutes', NEW.duration_minutes,
      'participants', COALESCE((SELECT json_group_array(json_object('name', pu.full_name, 'email', pu.email))
        FROM booking_participants bp JOIN users pu ON pu.id = bp.user_id WHERE bp.booking_id = NEW.id AND bp.status = 'accepted'), '[]')
    ), COALESCE((SELECT h.created_at FROM booking_history h WHERE h.booking_id = NEW.id ORDER BY h.id DESC LIMIT 1), CURRENT_TIMESTAMP)
  FROM rooms newRoom JOIN rooms oldRoom ON oldRoom.id = OLD.room_id
  LEFT JOIN users u ON u.id = NEW.user_id
  WHERE newRoom.id = NEW.room_id;
END;
--> statement-breakpoint
CREATE TRIGGER audit_equipment_movement_created
AFTER INSERT ON equipment_movements
BEGIN
  INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details, created_at)
  SELECT NEW.moved_by_user_id, 'equipment_moved', 'equipment_movement', CAST(NEW.id AS TEXT), NEW.notes,
    json_object(
      'movementId', NEW.id,
      'equipmentId', e.equipment_id,
      'equipmentName', e.name,
      'actorName', u.full_name,
      'actorEmail', u.email,
      'fromLocation', source.name,
      'toLocation', destination.name,
      'expectedReturnAt', NEW.expected_return_at,
      'movedAt', NEW.moved_at,
      'reservationId', b.booking_ref,
      'reservationDate', b.date,
      'reservationStartTime', b.start_time,
      'reservationEndTime', b.end_time,
      'roomName', r.name,
      'status', NEW.status
    ), NEW.moved_at
  FROM equipment e JOIN users u ON u.id = NEW.moved_by_user_id
  JOIN locations source ON source.id = NEW.from_location_id
  JOIN locations destination ON destination.id = NEW.to_location_id
  LEFT JOIN bookings b ON b.id = NEW.reservation_id
  LEFT JOIN rooms r ON r.id = b.room_id
  WHERE e.id = NEW.equipment_id;
END;
--> statement-breakpoint
CREATE TRIGGER audit_equipment_movement_return_event
AFTER INSERT ON movement_return_events
BEGIN
  INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details, created_at)
  SELECT NEW.actor_user_id,
    CASE WHEN NEW.event_type = 'return' THEN 'equipment_returned' ELSE 'equipment_movement_corrected' END,
    'equipment_movement', CAST(NEW.movement_id AS TEXT), NEW.notes,
    json_object(
      'movementId', m.id,
      'equipmentId', e.equipment_id,
      'equipmentName', e.name,
      'actorName', actor.full_name,
      'actorEmail', actor.email,
      'fromLocation', source.name,
      'toLocation', destination.name,
      'movementDestination', movementDestination.name,
      'expectedReturnAt', m.expected_return_at,
      'movedAt', m.moved_at,
      'returnedAt', NEW.created_at,
      'reservationId', b.booking_ref,
      'reservationDate', b.date,
      'reservationStartTime', b.start_time,
      'reservationEndTime', b.end_time,
      'roomName', r.name,
      'status', m.status,
      'reason', m.correction_reason
    ), NEW.created_at
  FROM equipment_movements m JOIN equipment e ON e.id = m.equipment_id
  JOIN users actor ON actor.id = NEW.actor_user_id
  JOIN locations source ON source.id = NEW.from_location_id
  JOIN locations destination ON destination.id = NEW.to_location_id
  JOIN locations movementDestination ON movementDestination.id = m.to_location_id
  LEFT JOIN bookings b ON b.id = m.reservation_id
  LEFT JOIN rooms r ON r.id = b.room_id
  WHERE m.id = NEW.movement_id;
END;
--> statement-breakpoint
CREATE TRIGGER audit_session_equipment_logged
AFTER INSERT ON session_equipment_usage
BEGIN
  INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details, created_at)
  SELECT NEW.actor_user_id, 'session_equipment_logged', 'session_equipment_usage', CAST(NEW.id AS TEXT), NULL,
    json_object(
      'bookingId', b.id,
      'bookingRef', b.booking_ref,
      'studentName', COALESCE(u.full_name, b.guest_student_name, 'Unknown student'),
      'studentEmail', COALESCE(u.email, ''),
      'roomName', r.name,
      'date', b.date,
      'startTime', b.start_time,
      'endTime', b.end_time,
      'equipmentId', NEW.equipment_code,
      'equipmentName', NEW.equipment_label,
      'equipmentLocation', l.name,
      'condition', NEW.observed_condition,
      'status', NEW.observed_status,
      'observedAt', NEW.observed_at
    ), NEW.created_at
  FROM bookings b JOIN rooms r ON r.id = b.room_id
  LEFT JOIN users u ON u.id = b.user_id
  LEFT JOIN locations l ON l.id = NEW.observed_location_id
  WHERE b.id = NEW.booking_id;
END;
--> statement-breakpoint
CREATE INDEX idx_audit_events_created ON audit_events (created_at, id);
