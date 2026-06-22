import os
import csv
import sqlite3
from datetime import datetime

# Database file path
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hospital.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Create doctors table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS doctors (
        id INTEGER PRIMARY KEY,
        name TEXT,
        department TEXT,
        days TEXT,
        timing_start TEXT,
        timing_end TEXT,
        fee INTEGER,
        room TEXT
    )
    """)

    # Create patients table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT,
        cnic TEXT
    )
    """)

    # Create appointments table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_name TEXT,
        patient_phone TEXT,
        doctor_id INTEGER,
        doctor_name TEXT,
        department TEXT,
        appointment_date TEXT,
        appointment_time TEXT,
        status TEXT DEFAULT 'confirmed',
        created_at TEXT
    )
    """)

    conn.commit()
    conn.close()
    
    # Load doctors from CSV (checking local file first, then docs folder)
    csv_filename = "doctors.csv"
    if not os.path.exists(csv_filename):
        csv_filename = os.path.join(os.path.dirname(os.path.abspath(__file__)), "doctors.csv")
    if not os.path.exists(csv_filename):
        csv_filename = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "doctors.csv")
        
    load_doctors_from_csv(csv_filename)

def load_doctors_from_csv(csv_path):
    if not os.path.exists(csv_path):
        print(f"Error: CSV file not found at {csv_path}")
        return

    conn = get_db_connection()
    cursor = conn.cursor()

    with open(csv_path, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Clean and map CSV fields to doctors table columns
            doc_id = int(row['id'])
            name = row['name'].strip()
            department = row['department'].strip()
            days = row['days'].strip()
            timing_start = row['timing_start'].strip()
            timing_end = row['timing_end'].strip()
            fee = int(row['fee_pkr'])
            room = row['room'].strip()

            cursor.execute("""
            INSERT OR IGNORE INTO doctors (id, name, department, days, timing_start, timing_end, fee, room)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (doc_id, name, department, days, timing_start, timing_end, fee, room))

    conn.commit()
    conn.close()
    print("Database initialized and doctors loaded successfully.")

if __name__ == "__main__":
    init_db()
