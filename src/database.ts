import Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(process.cwd(), 'hospital.db');

export const db = new Database(DB_PATH);

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY,
      name TEXT,
      department TEXT,
      qualification TEXT,
      days TEXT,
      timing_start TEXT,
      timing_end TEXT,
      fee INTEGER,
      room TEXT,
      phone_ext TEXT
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      cnic TEXT
    );

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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add qualification column if missing (for existing DBs)
  try { db.exec('ALTER TABLE doctors ADD COLUMN qualification TEXT'); } catch(e) {}
  try { db.exec('ALTER TABLE doctors ADD COLUMN phone_ext TEXT'); } catch(e) {}

  loadDoctorsFromCSV(path.join(process.cwd(), 'docs', 'doctors.csv'));
}

export function loadDoctorsFromCSV(csvPath: string) {
  if (!fs.existsSync(csvPath)) {
    console.warn('doctors.csv not found at', csvPath);
    return;
  }

  const fileContent = fs.readFileSync(csvPath, 'utf8');
  const records = parse(fileContent, { columns: true, skip_empty_lines: true });

  const insert = db.prepare(`
    INSERT OR REPLACE INTO doctors (id, name, department, qualification, days, timing_start, timing_end, fee, room, phone_ext)
    VALUES (@id, @name, @department, @qualification, @days, @timing_start, @timing_end, @fee_pkr, @room, @phone_ext)
  `);

  const insertMany = db.transaction((docs: any[]) => {
    for (const doc of docs) {
      insert.run(doc);
    }
  });

  insertMany(records);
}
