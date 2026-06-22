import { db } from "./database.js";

export function getAvailableSlots(doctorId: number, dateStr: string): string[] {
  const query = db.prepare(
    "SELECT timing_start, timing_end FROM doctors WHERE id = ?",
  );
  const doctor = query.get(doctorId) as
    | { timing_start: string; timing_end: string }
    | undefined;

  if (!doctor) return [];

  const slots: string[] = [];
  let current = parseTime(doctor.timing_start);
  const end = parseTime(doctor.timing_end);

  while (current < end) {
    slots.push(formatTime(current));
    current += 30;
  }

  const appointmentsQuery = db.prepare(
    "SELECT appointment_time FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND status = ?",
  );
  const existingAppointments = appointmentsQuery.all(
    doctorId,
    dateStr,
    "confirmed",
  ) as { appointment_time: string }[];

  const bookedSlots = new Set(
    existingAppointments.map((a) => a.appointment_time),
  );
  return slots.filter((slot) => !bookedSlots.has(slot));
}

export function bookAppointment(
  patientName: string,
  patientPhone: string,
  doctorId: number,
  dateStr: string,
  timeStr: string,
) {
  const docQuery = db.prepare(
    "SELECT name, department FROM doctors WHERE id = ?",
  );
  const doctor = docQuery.get(doctorId) as
    | { name: string; department: string }
    | undefined;
  if (!doctor) return { success: false, message: "Doctor not found." };

  const availableSlots = getAvailableSlots(doctorId, dateStr);
  if (!availableSlots.includes(timeStr)) {
    if (availableSlots.length > 0) {
      const slotList = availableSlots
        .slice(0, 6)
        .map((s) => `• ${s}`)
        .join("\n");
      return {
        success: false,
        message: `Sorry, ${timeStr} is not available for ${doctor.name} on ${dateStr}.\n\nHere are some available slots:\n${slotList}\n\nTo book, type: "Book appointment with ${doctor.name} at [time]"`,
      };
    }
    return {
      success: false,
      message: `Sorry, there are no available slots for ${doctor.name} on ${dateStr}. Please try another date.`,
    };
  }

  const insert = db.prepare(`
    INSERT INTO appointments (patient_name, patient_phone, doctor_id, doctor_name, department, appointment_date, appointment_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    patientName,
    patientPhone,
    doctorId,
    doctor.name,
    doctor.department,
    dateStr,
    timeStr,
  );

  return {
    success: true,
    appointment_id: result.lastInsertRowid,
    message: `✅ Appointment Confirmed!\n\n📋 Details:\n• Patient: ${patientName}\n• Doctor: ${doctor.name} (${doctor.department})\n• Date: ${dateStr}\n• Time: ${timeStr}\n• Appointment ID: #${result.lastInsertRowid}\n\nPlease arrive 15 minutes early. Bring your CNIC and any previous medical records.\n\nTo cancel: type "Cancel appointment #${result.lastInsertRowid}"\nTo reschedule: type "Reschedule #${result.lastInsertRowid} to [date] at [time]"`,
  };
}

export function getDoctorByName(nameFragment: string) {
  const query = db.prepare(
    "SELECT * FROM doctors WHERE name LIKE ? COLLATE NOCASE LIMIT 1",
  );
  return query.get(`%${nameFragment}%`) as any | undefined;
}

export function formatAvailableSlots(
  slots: string[],
  doctorName: string,
  dateStr: string,
): string {
  if (slots.length === 0) {
    return `No available slots for ${doctorName} on ${dateStr}. Please try another date.`;
  }
  return (
    `📅 Available slots for ${doctorName} on ${dateStr}:\n\n` +
    slots.map((s) => `• ${s}`).join("\n") +
    `\n\nTo book, just type:\n"Book appointment with ${doctorName} at [your preferred time]"\n\nFor example: "Book appointment with ${doctorName} at ${slots[0]}"`
  );
}

export function cancelAppointment(appointmentId: number): {
  success: boolean;
  message: string;
} {
  const appt = db
    .prepare("SELECT * FROM appointments WHERE id = ? AND status = 'confirmed'")
    .get(appointmentId) as any;

  if (!appt) {
    return {
      success: false,
      message: `No confirmed appointment found with ID #${appointmentId}. Please check the appointment ID and try again.`,
    };
  }

  db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(
    appointmentId,
  );

  return {
    success: true,
    message: `✅ Appointment #${appointmentId} has been cancelled.\n\n📋 Cancelled Details:\n• Patient: ${appt.patient_name}\n• Doctor: ${appt.doctor_name}\n• Date: ${appt.appointment_date}\n• Time: ${appt.appointment_time}\n\nTo book a new appointment, type "Book appointment with Dr. [Name]".`,
  };
}

export function rescheduleAppointment(
  appointmentId: number,
  newDate: string,
  newTime: string,
): { success: boolean; message: string } {
  const appt = db
    .prepare("SELECT * FROM appointments WHERE id = ? AND status = 'confirmed'")
    .get(appointmentId) as any;

  if (!appt) {
    return {
      success: false,
      message: `No confirmed appointment found with ID #${appointmentId}. Please check the appointment ID and try again.`,
    };
  }

  const available = getAvailableSlots(appt.doctor_id, newDate);
  if (!available.includes(newTime)) {
    const slotList = available
      .slice(0, 6)
      .map((s) => `• ${s}`)
      .join("\n");
    return {
      success: false,
      message: slotList
        ? `${newTime} is not available on ${newDate}.\n\nAvailable slots:\n${slotList}\n\nTo reschedule, type: "Reschedule #${appointmentId} to ${newDate} at [time]"`
        : `No slots available on ${newDate}. Please try another date.\n\nTo reschedule, type: "Reschedule #${appointmentId} to [date] at [time]"`,
    };
  }

  db.prepare(
    "UPDATE appointments SET appointment_date = ?, appointment_time = ? WHERE id = ?",
  ).run(newDate, newTime, appointmentId);

  return {
    success: true,
    message: `✅ Appointment #${appointmentId} rescheduled successfully!\n\n📋 Updated Details:\n• Doctor: ${appt.doctor_name} (${appt.department})\n• New Date: ${newDate}\n• New Time: ${newTime}\n• Patient: ${appt.patient_name}\n\nPlease arrive 15 minutes early.`,
  };
}

export function getAppointmentById(appointmentId: number) {
  return db
    .prepare("SELECT * FROM appointments WHERE id = ? AND status = 'confirmed'")
    .get(appointmentId) as any;
}

// Find confirmed appointments matching a doctor name fragment (case
// insensitive). Used when the user asks to cancel/reschedule "my
// appointment with Dr. X" instead of giving an appointment ID.
export function findConfirmedAppointmentsByDoctorName(
  nameFragment: string,
): any[] {
  return db
    .prepare(
      "SELECT * FROM appointments WHERE doctor_name LIKE ? COLLATE NOCASE AND status = 'confirmed' ORDER BY id DESC",
    )
    .all(`%${nameFragment}%`) as any[];
}

// Most recently created confirmed appointment overall — used as a last
// resort when the user just says "cancel my appointment" with no ID and no
// doctor name, so we can offer the most likely candidate instead of
// silently failing.
export function getMostRecentConfirmedAppointment(): any {
  return db
    .prepare(
      "SELECT * FROM appointments WHERE status = 'confirmed' ORDER BY id DESC LIMIT 1",
    )
    .get() as any;
}

// Helpers
function parseTime(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export function normalizeTime(timeStr: string): string {
  let cleaned = timeStr.trim().toUpperCase();

  // Normalize Roman-Urdu "o'clock" markers (baja / bajay / bje) to PM by
  // default, since they're spoken without AM/PM and hospital slots here
  // are all afternoon/evening. e.g. "2 baja" -> "2 PM", "5 bajay" -> "5 PM".
  if (/BAJA[Y]?|BJE/.test(cleaned)) {
    cleaned = cleaned.replace(/BAJA[Y]?|BJE/, "PM").trim();
  }

  // Already has AM/PM, with minutes: "2:30 PM", "2:30PM"
  if (/AM|PM/.test(cleaned)) {
    const withMinutes = cleaned.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/);
    if (withMinutes) {
      const h = withMinutes[1].padStart(2, "0");
      const m = withMinutes[2];
      return `${h}:${m} ${withMinutes[3]}`;
    }
    // Has AM/PM but no minutes: "2 PM", "2PM"
    const hourOnly = cleaned.match(/(\d{1,2})\s*(AM|PM)/);
    if (hourOnly) {
      const h = hourOnly[1].padStart(2, "0");
      return `${h}:00 ${hourOnly[2]}`;
    }
  }

  // 24-hour format like "14:30"
  const match24 = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = parseInt(match24[1]);
    const m = parseInt(match24[2]);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")} ${ampm}`;
  }

  // Bare hour, no AM/PM, no minutes: "2", "14"
  const bareHour = cleaned.match(/^(\d{1,2})$/);
  if (bareHour) {
    const h = parseInt(bareHour[1]);
    if (h >= 13 && h <= 23) {
      // Clearly 24-hour input
      const h12 = h % 12 || 12;
      return `${h12.toString().padStart(2, "0")}:00 PM`;
    }
    // Ambiguous 1-12: default to PM, since hospital hours here run
    // afternoon/evening (e.g. "2" -> "2 PM").
    const h12 = h % 12 || 12;
    return `${h12.toString().padStart(2, "0")}:00 PM`;
  }

  return cleaned;
}
