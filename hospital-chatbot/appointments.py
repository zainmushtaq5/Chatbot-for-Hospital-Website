import os
import sqlite3
from datetime import datetime
from database import get_db_connection

def time_to_minutes(time_str):
    h, m = map(int, time_str.split(':'))
    return h * 60 + m

def minutes_to_time(minutes):
    h = minutes // 60
    m = minutes % 60
    return f"{h:02d}:{m:02d}"

def format_time_12h(time_str):
    try:
        h, m = map(int, time_str.split(':'))
        suffix = "AM"
        if h >= 12:
            suffix = "PM"
            if h > 12:
                h -= 12
        elif h == 0:
            h = 12
        return f"{h:02d}:{m:02d} {suffix}"
    except Exception:
        return time_str

def get_available_slots(doctor_id, date_str):
    conn = get_db_connection()
    cursor = conn.cursor()

    # Get doctor timings
    cursor.execute("SELECT timing_start, timing_end FROM doctors WHERE id = ?", (doctor_id,))
    doc = cursor.fetchone()
    if not doc:
        conn.close()
        return []

    timing_start = doc["timing_start"]
    timing_end = doc["timing_end"]

    # Generate 30-minute slots
    start_mins = time_to_minutes(timing_start)
    end_mins = time_to_minutes(timing_end)
    all_slots = []
    curr = start_mins
    while curr + 30 <= end_mins:
        all_slots.append(minutes_to_time(curr))
        curr += 30

    # Find already booked slots on that date
    cursor.execute("""
        SELECT appointment_time FROM appointments 
        WHERE doctor_id = ? AND appointment_date = ? AND status = 'confirmed'
    """, (doctor_id, date_str))
    
    booked_slots = [row["appointment_time"] for row in cursor.fetchall()]
    conn.close()

    # Filter out booked slots
    available_slots = [s for s in all_slots if s not in booked_slots]
    return available_slots

def book_appointment(patient_name, patient_phone, doctor_id, date_str, time_str):
    # Standardize time_str to HH:MM if it has AM/PM or is otherwise formatted
    # If the user sends "09:00 AM", we want to convert it to "09:00"
    clean_time_str = time_str.strip()
    if " " in clean_time_str:
        # e.g., "09:00 AM" or "9:00 AM"
        try:
            t_part, suffix = clean_time_str.split()
            h_str, m_str = t_part.split(':')
            h = int(h_str)
            m = int(m_str)
            if suffix.upper() == "PM" and h < 12:
                h += 12
            elif suffix.upper() == "AM" and h == 12:
                h = 0
            clean_time_str = f"{h:02d}:{m:02d}"
        except Exception:
            pass

    # Check availability
    available = get_available_slots(doctor_id, date_str)
    if clean_time_str not in available:
        return {
            "success": False,
            "message": "That slot is already booked or invalid. Please choose another time."
        }

    conn = get_db_connection()
    cursor = conn.cursor()

    # Fetch doctor details
    cursor.execute("SELECT name, department FROM doctors WHERE id = ?", (doctor_id,))
    doc = cursor.fetchone()
    if not doc:
        conn.close()
        return {"success": False, "message": "Doctor not found."}

    doctor_name = doc["name"]
    department = doc["department"]
    created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Insert into appointments
    cursor.execute("""
        INSERT INTO appointments 
        (patient_name, patient_phone, doctor_id, doctor_name, department, appointment_date, appointment_time, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
    """, (patient_name, patient_phone, doctor_id, doctor_name, department, date_str, clean_time_str, created_at))
    
    appointment_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {
        "success": True,
        "appointment_id": appointment_id,
        "message": f"Appointment confirmed for {patient_name} with {doctor_name} on {date_str} at {format_time_12h(clean_time_str)}."
    }

def get_doctor_by_name(name_fragment):
    conn = get_db_connection()
    cursor = conn.cursor()
    query = f"%{name_fragment.strip()}%"
    cursor.execute("SELECT * FROM doctors WHERE name LIKE ?", (query,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def format_available_slots(slots, doctor_name, date_str):
    if not slots:
        return f"No available slots for {doctor_name} on {date_str}. Please select another date or doctor."
        
    lines = [f"Available slots for {doctor_name} on {date_str}:"]
    for s in slots:
        lines.append(f"• {format_time_12h(s)}")
    lines.append("\nReply with your preferred time (HH:MM) to confirm.")
    return "\n".join(lines)

if __name__ == "__main__":
    # Test slot generation and booking
    print("Testing appointments.py...")
    doc = get_doctor_by_name("Ahmed Khan")
    if doc:
        print(f"Found Doctor: {doc['name']} (ID: {doc['id']})")
        slots = get_available_slots(doc["id"], "2026-06-15")
        print("Slots available:", slots)
        formatted = format_available_slots(slots, doc["name"], "2026-06-15")
        print("\nFormatted Slots:\n", formatted)
        
        # Test book_appointment
        res = book_appointment("Test Patient", "03001234567", doc["id"], "2026-06-15", "09:00")
        print("\nBooking result:", res)
        
        # Test availability again
        slots_after = get_available_slots(doc["id"], "2026-06-15")
        print("Slots available after booking:", slots_after)
    else:
        print("Doctor Ahmed Khan not found.")
