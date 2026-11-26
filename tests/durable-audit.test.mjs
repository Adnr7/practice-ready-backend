import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyMigrationBatch, loadMigrations, openMigrationDatabase } from "../scripts/migration-tools.mjs";

const migrations = await loadMigrations();
const connection = await openMigrationDatabase();
const db = connection.db;
for (const migration of migrations) await applyMigrationBatch(db, migration);

after(async () => connection.dispose());

describe("durable booking and equipment audit", () => {
  before(async () => {
    await db.batch([
      db.prepare("INSERT INTO users (id,email,password_hash,salt,full_name,role) VALUES (1,'student@example.invalid','hash','salt','Student One','student')"),
      db.prepare("INSERT INTO users (id,email,password_hash,salt,full_name,role) VALUES (2,'staff@example.invalid','hash','salt','Staff Two','technician')"),
      db.prepare("INSERT INTO locations (id,code,name,type) VALUES (1,'store','Store','storage'), (2,'room','Practice Room','room')"),
      db.prepare("INSERT INTO rooms (id,name,code,capacity,description) VALUES (1,'Practice Room','room',4,'Test room')"),
      db.prepare("INSERT INTO equipment (id,equipment_id,name,type,condition,status,default_location_id,current_location_id,default_room_id) VALUES (1,'MIC-01','Test microphone','mic','Fully functional','ready',1,1,1)"),
      db.prepare("INSERT INTO booking_policies (version,equipment_handling,movement_rules,is_current) VALUES ('test','Test','Test',1)"),
    ]);
  });

  it("captures who booked which room, when, and event actor/reason on reschedule, cancellation and session end", async () => {
    await db.prepare(`INSERT INTO bookings (id,booking_ref,user_id,room_id,date,end_date,start_time,end_time,duration_minutes)
      VALUES (1,'PR-2099-1001',1,1,'2099-01-01','2099-01-01','09:00','10:00',60)`).run();
    await db.prepare(`INSERT INTO booking_history (booking_id,actor_user_id,action,previous_room_id,previous_date,previous_start_time,previous_end_time,new_room_id,new_date,new_start_time,new_end_time,reason,created_at)
      VALUES (1,2,'rescheduled',1,'2099-01-01','09:00','10:00',1,'2099-01-01','10:00','11:00','Room schedule approved','2099-01-01T08:00:00.000Z')`).run();
    await db.prepare("UPDATE bookings SET start_time='10:00',end_time='11:00' WHERE id=1").run();
    await db.prepare(`INSERT INTO booking_history (booking_id,actor_user_id,action,previous_room_id,previous_date,previous_start_time,previous_end_time,reason,created_at)
      VALUES (1,2,'cancelled',1,'2099-01-01','10:00','11:00','Student requested cancellation','2099-01-01T08:30:00.000Z')`).run();
    await db.prepare("UPDATE bookings SET status='cancelled', cancellation_reason='Student requested cancellation' WHERE id=1").run();
    await db.prepare(`INSERT INTO bookings (id,booking_ref,user_id,room_id,date,end_date,start_time,end_time,duration_minutes)
      VALUES (2,'PR-2099-1002',1,1,'2099-01-02','2099-01-02','09:00','10:00',60)`).run();
    await db.prepare(`INSERT INTO booking_history (booking_id,actor_user_id,action,previous_room_id,previous_date,previous_start_time,previous_end_time,new_end_time,reason,created_at)
      VALUES (2,1,'session_ended',1,'2099-01-02','09:00','10:00','10:00','Practice finished','2099-01-02T10:00:00.000Z')`).run();
    await db.prepare("UPDATE bookings SET status='completed',session_ended_at='2099-01-02T10:00:00.000Z' WHERE id=2").run();

    const events = (await db.prepare("SELECT action,actor_user_id,reason,details,created_at FROM audit_events WHERE entity_type='reservation' AND entity_id IN ('PR-2099-1001','PR-2099-1002') ORDER BY id").all()).results;
    assert.deepEqual(events.map((row) => row.action), ["booked", "rescheduled", "cancelled", "booked", "session_ended"]);
    assert.equal(events[0].actor_user_id, 1);
    assert.equal(JSON.parse(events[0].details).studentName, "Student One");
    assert.equal(JSON.parse(events[0].details).roomName, "Practice Room");
    assert.equal(JSON.parse(events[0].details).startTime, "09:00");
    assert.equal(events[1].actor_user_id, 2);
    assert.equal(events[1].reason, "Room schedule approved");
    assert.equal(JSON.parse(events[1].details).previousStartTime, "09:00");
    assert.equal(events[2].actor_user_id, 2);
    assert.equal(events[2].reason, "Student requested cancellation");
    assert.equal(events[4].actor_user_id, 1);
    assert.equal(events[4].reason, "Practice finished");
  });

  it("captures equipment moves, verified returns, corrections, and explicitly logged session equipment", async () => {
    await db.prepare(`INSERT INTO bookings (id,booking_ref,user_id,room_id,date,end_date,start_time,end_time,duration_minutes)
      VALUES (3,'PR-2099-1003',1,1,'2099-01-03','2099-01-03','09:00','10:00',60)`).run();
    await db.prepare(`INSERT INTO equipment_movements (id,equipment_id,moved_by_user_id,from_location_id,to_location_id,status,expected_return_at,moved_at,reservation_id,updated_at)
      VALUES (1,1,1,1,2,'open','2099-01-03T10:00:00.000Z','2099-01-03T08:00:00.000Z',3,'2099-01-03T08:00:00.000Z')`).run();
    await db.prepare(`UPDATE equipment_movements SET status='returned',returned_at='2099-01-03T10:00:00.000Z',returned_by_user_id=2,return_location_id=1,updated_at='2099-01-03T10:00:00.000Z' WHERE id=1`).run();
    await db.prepare(`INSERT INTO movement_return_events (movement_id,actor_user_id,from_location_id,to_location_id,event_type,notes,created_at)
      VALUES (1,2,2,1,'return','Physical return verified','2099-01-03T10:00:00.000Z')`).run();
    await db.prepare(`INSERT INTO equipment_movements (id,equipment_id,moved_by_user_id,from_location_id,to_location_id,status,expected_return_at,moved_at,reservation_id,updated_at,correction_reason)
      VALUES (2,1,1,1,2,'corrected','2099-01-03T10:00:00.000Z','2099-01-03T08:30:00.000Z',3,'2099-01-03T08:30:00.000Z','Destination corrected after inventory check')`).run();
    await db.prepare(`INSERT INTO movement_return_events (movement_id,actor_user_id,from_location_id,to_location_id,event_type,notes,created_at)
      VALUES (2,2,2,1,'correction','Destination corrected after inventory check','2099-01-03T10:30:00.000Z')`).run();
    await db.prepare(`INSERT INTO session_equipment_usage (booking_id,equipment_id,actor_user_id,equipment_label,equipment_code,observed_location_id,observed_condition,observed_status,observed_at,created_at)
      VALUES (3,1,1,'Test microphone','MIC-01',2,'Fully functional','ready','2099-01-03T09:00:00.000Z','2099-01-03T09:00:01.000Z')`).run();

    const events = (await db.prepare("SELECT action,actor_user_id,details FROM audit_events WHERE entity_type IN ('equipment_movement','session_equipment_usage') ORDER BY id").all()).results;
    assert.deepEqual(events.map((row) => row.action), ["equipment_moved", "equipment_returned", "equipment_moved", "equipment_movement_corrected", "session_equipment_logged"]);
    assert.equal(events[0].actor_user_id, 1);
    assert.equal(JSON.parse(events[0].details).roomName, "Practice Room");
    assert.equal(events[1].actor_user_id, 2);
    assert.equal(events[2].actor_user_id, 1);
    assert.equal(events[3].actor_user_id, 2);
    assert.equal(JSON.parse(events[3].details).actorName, "Staff Two");
    assert.equal(JSON.parse(events[3].details).toLocation, "Store");
    assert.equal(JSON.parse(events[3].details).reason, "Destination corrected after inventory check");
    assert.equal(events[4].actor_user_id, 1);
    assert.equal(JSON.parse(events[4].details).equipmentId, "MIC-01");
    assert.equal(JSON.parse(events[4].details).studentName, "Student One");
  });
});
