import express from "express";
import cors from "cors";
import path from "path";
import { initDb, db } from "./src/database.js";
import { buildKnowledgeBase, searchKnowledgeBase } from "./src/rag.js";
import {
  detectIntent,
  getGreetingResponse,
  getOutOfScopeResponse,
} from "./src/intent.js";
import { callQwen } from "./src/llm.js";
import { SYSTEM_PROMPT } from "./src/prompts.js";
import {
  getDoctorByName,
  getAvailableSlots,
  formatAvailableSlots,
  bookAppointment,
  normalizeTime,
  cancelAppointment,
  rescheduleAppointment,
  getAppointmentById,
  findConfirmedAppointmentsByDoctorName,
} from "./src/appointments.js";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  initDb();
  await buildKnowledgeBase();

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", hospital: "Al-Shifa General Hospital" });
  });

  app.get("/api/doctors", (_req, res) => {
    const doctors = db.prepare("SELECT * FROM doctors").all();
    res.json(doctors);
  });

  // ── Find a doctor mentioned in message or recent history ───────────────────
  function findDoctorInMessage(message: string, history: any[] = []) {
    const allDoctors = db.prepare("SELECT * FROM doctors").all() as any[];
    const msg = message.toLowerCase();

    const drMatch = message.match(/(?:Dr\.?\s+)([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
    if (drMatch) {
      const doctor = getDoctorByName(drMatch[1].trim());
      if (doctor) return doctor;
    }

    for (const doc of allDoctors) {
      const parts = doc.name
        .toLowerCase()
        .replace("dr.", "")
        .trim()
        .split(/\s+/)
        .filter((p: string) => p.length > 2);
      if (parts.some((p: string) => msg.includes(p))) return doc;
    }

    for (const doc of allDoctors) {
      const dept = doc.department.toLowerCase();
      if (new RegExp(`\\b${dept}\\b`, "i").test(msg)) return doc;
    }

    const botHistory = history.filter((m) => m.role === "bot").slice(-3);
    for (const m of botHistory.reverse()) {
      const lower = m.content.toLowerCase();
      for (const doc of allDoctors) {
        const parts = doc.name
          .toLowerCase()
          .replace("dr.", "")
          .trim()
          .split(/\s+/)
          .filter((p: string) => p.length > 2);
        if (parts.some((p: string) => lower.includes(p))) return doc;
      }
    }

    return null;
  }

  // ── Extract last shown slot list from bot history ──────────────────────────
  function getLastShownSlots(history: any[]): string[] {
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role === "bot" && msg.content.includes("Available slots for")) {
        const matches = msg.content.match(
          /(?:\d+\.\s*|•\s*)(\d{1,2}:\d{2}\s*(?:AM|PM))/gi,
        );
        if (matches) {
          return matches.map((m: string) => m.replace(/^[\d.•\s]+/, "").trim());
        }
      }
    }
    return [];
  }

  // ── Doctor directory as context string ────────────────────────────────────
  function getDoctorDirectoryContext() {
    const doctors = db
      .prepare(
        "SELECT name, department, qualification, days, timing_start, timing_end, fee, room FROM doctors",
      )
      .all() as any[];
    return doctors
      .map(
        (d: any) =>
          `${d.name} — ${d.department} | Qualification: ${d.qualification || "N/A"} | Days: ${d.days} | Time: ${d.timing_start}–${d.timing_end} | Fee: ${d.fee} PKR | Room: ${d.room}`,
      )
      .join("\n");
  }

  // ── Hidden state token ───────────────────────────────────────────────────
  // The booking flow spans several turns (confirm → name → phone). Rather
  // than re-deriving doctor/date/time by guessing at the bot's own prose with
  // regex (which breaks the moment a step's message doesn't happen to repeat
  // that text — e.g. "Please tell me your full name" mentions no time at
  // all), we stamp every booking-flow bot reply with a hidden HTML-comment
  // token carrying the state as JSON. It's invisible in the rendered chat
  // bubble but always present in `history` on the next turn.
  function withStateToken(reply: string, data: Record<string, any>): string {
    return `${reply}\n<!--BOOKING_STATE:${JSON.stringify(data)}-->`;
  }

  function readStateToken(content: string): Record<string, any> | null {
    const m = content.match(/<!--BOOKING_STATE:(.*?)-->/s);
    if (!m) return null;
    try {
      return JSON.parse(m[1]);
    } catch {
      return null;
    }
  }

  // ── Find the last appointment ID this conversation actually booked ────────
  // Scans bot history for "Appointment ID: #N", which the booking
  // confirmation message always includes. Used as a fallback when the user
  // says "cancel my appointment" / "reschedule it" without giving an ID.
  function getLastBookedAppointmentId(history: any[]): number | null {
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m.role === "bot") {
        const idMatch = m.content.match(/Appointment ID:\s*#(\d+)/i);
        if (idMatch) return parseInt(idMatch[1]);
      }
    }
    return null;
  }

  // ── Resolve time from message ──────────────────────────────────────────────
  function resolveTimeFromMessage(
    msg: string,
    shownSlots: string[],
  ): string | null {
    const trimmed = msg.trim();
    if (/^any$/i.test(trimmed)) return shownSlots[0] || null;
    const numOnly = trimmed.match(/^(\d+)$/);
    if (numOnly) {
      const idx = parseInt(numOnly[1]) - 1;
      // Only treat a bare number as a "pick slot #N" if it's a valid index
      // into the shown list, not as a clock hour (e.g. "2" alone is ambiguous).
      if (idx >= 0 && idx < shownSlots.length) return shownSlots[idx];
    }
    // Full "HH:MM AM/PM" or "HH:MM" (24h) or "HH AM/PM" (e.g. "2 PM", "2pm")
    // or Roman-Urdu "2 baja" / "2 bajay" / "2 bje".
    const timeRaw = trimmed.match(
      /(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm|a\.m\.|p\.m\.|baja[y]?|bje)?/i,
    );
    if (timeRaw) {
      const hasMarker = timeRaw[2] !== undefined || timeRaw[3] !== undefined;
      if (hasMarker) {
        return normalizeTime(
          `${timeRaw[1]}:${timeRaw[2] || "00"} ${timeRaw[3] || ""}`.trim(),
        );
      }
    }
    return null;
  }

  // ── Detect booking sub-state from history ─────────────────────────────────
  function getBookingState(history: any[]): {
    state:
      | "idle"
      | "waiting_confirm"
      | "waiting_name"
      | "waiting_phone"
      | "waiting_time";
    pendingDoctorId?: number;
    pendingDate?: string;
    pendingTime?: string;
    pendingName?: string;
  } {
    const lastBot = history.filter((m) => m.role === "bot").slice(-1)[0];
    if (!lastBot) return { state: "idle" };
    const content: string = lastBot.content || "";

    // Prefer the hidden state token — it's always accurate, regardless of
    // what prose happens to be in the message.
    const token = readStateToken(content);

    // Waiting for yes/no confirmation
    if (
      content.includes("Shall I confirm") ||
      content.includes("confirm this booking")
    ) {
      return {
        state: "waiting_confirm",
        pendingDoctorId: token?.doctorId,
        pendingTime: token?.time,
        pendingDate: token?.date,
      };
    }

    if (content.includes("your phone number")) {
      const userMsgs = history.filter((m) => m.role === "user");
      const pendingName = token?.name || userMsgs.slice(-1)[0]?.content?.trim();
      return {
        state: "waiting_phone",
        pendingName,
        pendingDoctorId: token?.doctorId,
        pendingTime: token?.time,
        pendingDate: token?.date,
      };
    }

    if (content.includes("your full name")) {
      return {
        state: "waiting_name",
        pendingDoctorId: token?.doctorId,
        pendingTime: token?.time,
        pendingDate: token?.date,
      };
    }

    if (
      content.includes("Available slots for") ||
      content.includes("To book, just type")
    ) {
      return {
        state: "waiting_time",
        pendingDoctorId: token?.doctorId,
        pendingDate: token?.date,
      };
    }

    return { state: "idle" };
  }

  // ── /api/chat ─────────────────────────────────────────────────────────────
  app.post("/api/chat", async (req, res) => {
    const message = (req.body.message || "").trim();
    const history: any[] = req.body.history || [];

    if (!message)
      return res.json({
        final: true,
        response: "Please send a valid message.",
        intent: "unknown",
      });

    const intent = detectIntent(message);

    if (intent === "out_of_scope") {
      return res.json({
        final: true,
        response: getOutOfScopeResponse(),
        intent,
        source: "rule",
      });
    }

    // ── CANCEL APPOINTMENT ───────────────────────────────────────────────────
    const wantsCancel = /\bcancel\b/i.test(message);
    if (wantsCancel) {
      const idMatch =
        message.match(/cancel.*?#?(\d+)/i) ||
        message.match(/#?(\d+).*?cancel/i);

      if (idMatch) {
        const result = cancelAppointment(parseInt(idMatch[1]));
        return res.json({
          final: true,
          response: result.message,
          intent: "appointment",
          source: "booking",
        });
      }

      // No ID given — try to resolve via doctor name mentioned in the message.
      const doctorInMsg = findDoctorInMessage(message, []);
      if (doctorInMsg) {
        const matches = findConfirmedAppointmentsByDoctorName(doctorInMsg.name);
        if (matches.length === 1) {
          const result = cancelAppointment(matches[0].id);
          return res.json({
            final: true,
            response: result.message,
            intent: "appointment",
            source: "booking",
          });
        }
        if (matches.length > 1) {
          const list = matches
            .map(
              (a: any) =>
                `• #${a.id} — ${a.appointment_date} at ${a.appointment_time}`,
            )
            .join("\n");
          return res.json({
            final: true,
            response: `You have multiple appointments with ${doctorInMsg.name}:\n\n${list}\n\nWhich one would you like to cancel? Type: "Cancel appointment #[ID]"`,
            intent: "appointment",
            source: "booking",
          });
        }
        // Doctor recognized but no confirmed appointment found for them.
        return res.json({
          final: true,
          response: `I couldn't find a confirmed appointment with ${doctorInMsg.name}. Could you double check the doctor's name, or give me the appointment ID (e.g. "Cancel appointment #9")?`,
          intent: "appointment",
          source: "booking",
        });
      }

      // No ID, no doctor name — fall back to the last appointment booked in
      // this conversation, but confirm with the user before cancelling it
      // rather than guessing silently.
      const lastId = getLastBookedAppointmentId(history);
      if (lastId) {
        const appt = getAppointmentById(lastId);
        if (appt) {
          return res.json({
            final: true,
            response: withStateToken(
              `Just to confirm — you'd like to cancel appointment #${lastId} (${appt.doctor_name} on ${appt.appointment_date} at ${appt.appointment_time})? Reply Yes / No.`,
              { cancelId: lastId },
            ),
            intent: "appointment",
            source: "booking",
          });
        }
      }

      return res.json({
        final: true,
        response: `I'd be happy to help cancel that. Could you give me the appointment ID (e.g. "Cancel appointment #9") or the doctor's name?`,
        intent: "appointment",
        source: "booking",
      });
    }

    // Confirming a cancel that was proposed without an explicit ID above
    {
      const lastBot = history.filter((m: any) => m.role === "bot").slice(-1)[0];
      const token = lastBot ? readStateToken(lastBot.content || "") : null;
      if (
        token?.cancelId &&
        /^(yes|yeah|yep|confirm|ok|okay|sure|han|haan|ji|ji han)$/i.test(
          message.trim(),
        )
      ) {
        const result = cancelAppointment(token.cancelId);
        return res.json({
          final: true,
          response: result.message,
          intent: "appointment",
          source: "booking",
        });
      }
      if (token?.cancelId && /^(no|nope|nahi|na)$/i.test(message.trim())) {
        return res.json({
          final: true,
          response:
            "No problem, the appointment was not cancelled. Anything else I can help with?",
          intent: "appointment",
          source: "booking",
        });
      }
    }

    // ── RESCHEDULE APPOINTMENT ───────────────────────────────────────────────
    const wantsReschedule = /\breschedul/i.test(message);
    if (wantsReschedule) {
      const idMatch =
        message.match(/reschedul\w*.*?#?(\d+)/i) ||
        message.match(/#?(\d+).*?reschedul/i);

      let apptId: number | null = idMatch ? parseInt(idMatch[1]) : null;

      if (!apptId) {
        // No ID given — try doctor name, else fall back to last booked.
        const doctorInMsg = findDoctorInMessage(message, []);
        if (doctorInMsg) {
          const matches = findConfirmedAppointmentsByDoctorName(
            doctorInMsg.name,
          );
          if (matches.length === 1) {
            apptId = matches[0].id;
          } else if (matches.length > 1) {
            const list = matches
              .map(
                (a: any) =>
                  `• #${a.id} — ${a.appointment_date} at ${a.appointment_time}`,
              )
              .join("\n");
            return res.json({
              final: true,
              response: `You have multiple appointments with ${doctorInMsg.name}:\n\n${list}\n\nWhich one would you like to reschedule? Type: "Reschedule #[ID] to [date] at [time]"`,
              intent: "appointment",
              source: "booking",
            });
          }
        }
        if (!apptId) {
          apptId = getLastBookedAppointmentId(history);
        }
      }

      if (!apptId) {
        return res.json({
          final: true,
          response: `I'd be happy to help reschedule that. Could you give me the appointment ID (e.g. "Reschedule #9 to 2026-06-25 at 3 PM") or the doctor's name?`,
          intent: "appointment",
          source: "booking",
        });
      }

      const dateMatch = message.match(/(\d{4}-\d{2}-\d{2})/);
      const newTime = resolveTimeFromMessage(message, []);
      const newDate = dateMatch
        ? dateMatch[1]
        : (() => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            return d.toISOString().split("T")[0];
          })();

      if (!newTime) {
        const appt = getAppointmentById(apptId);
        if (!appt)
          return res.json({
            final: true,
            response: `No confirmed appointment found with ID #${apptId}.`,
            intent: "appointment",
            source: "booking",
          });
        const slots = getAvailableSlots(appt.doctor_id, newDate);
        return res.json({
          final: true,
          response: withStateToken(
            formatAvailableSlots(slots, appt.doctor_name, newDate) +
              `\n\nTo reschedule #${apptId}, reply with your preferred time.`,
            { rescheduleId: apptId, date: newDate },
          ),
          intent: "appointment",
          source: "booking",
        });
      }

      const result = rescheduleAppointment(apptId, newDate, newTime);
      return res.json({
        final: true,
        response: result.message,
        intent: "appointment",
        source: "booking",
      });
    }

    // ── BOOKING STATE MACHINE ────────────────────────────────────────────────
    const bookingState = getBookingState(history);
    const shownSlots = getLastShownSlots(history);
    const resolvedTime = resolveTimeFromMessage(message, shownSlots);
    const isYes =
      /^(yes|yeah|yep|confirm|ok|okay|sure|han|haan|ji|ji han)$/i.test(
        message.trim(),
      );
    const isNo = /^(no|nope|cancel|nahi|na)$/i.test(message.trim());

    // Helper: look up a doctor strictly by id (falls back to message/history
    // scan only when we truly have no id stashed in the state token, e.g.
    // very first turn of a booking).
    function resolveDoctor(doctorId?: number, msg = "", hist: any[] = []) {
      if (doctorId) {
        const doc = db
          .prepare("SELECT * FROM doctors WHERE id = ?")
          .get(doctorId);
        if (doc) return doc as any;
      }
      return findDoctorInMessage(msg, hist);
    }

    // State: waiting for yes/no confirmation
    if (bookingState.state === "waiting_confirm") {
      if (isNo) {
        return res.json({
          final: true,
          response:
            "No problem! The appointment has not been booked. Is there anything else I can help you with?",
          intent: "appointment",
          source: "booking",
        });
      }
      if (isYes) {
        const doctor = resolveDoctor(bookingState.pendingDoctorId, "", history);
        const dateStr = bookingState.pendingDate;
        const timeStr = bookingState.pendingTime;
        if (doctor && dateStr && timeStr) {
          return res.json({
            final: true,
            response: withStateToken(`Great! Please tell me your full name:`, {
              doctorId: doctor.id,
              date: dateStr,
              time: timeStr,
            }),
            intent: "appointment",
            source: "booking",
          });
        }
        // Lost track of doctor/date/time somehow — restart gracefully.
        return res.json({
          final: true,
          response:
            "Sorry, I lost track of that booking. Could you tell me the doctor's name again?",
          intent: "appointment",
          source: "booking",
        });
      }
    }

    // State: waiting for patient name
    if (bookingState.state === "waiting_name") {
      const pName = message.trim();
      return res.json({
        final: true,
        response: withStateToken(
          `Thank you, ${pName}! Please share your phone number (e.g. 03001234567):`,
          {
            doctorId: bookingState.pendingDoctorId,
            date: bookingState.pendingDate,
            time: bookingState.pendingTime,
            name: pName,
          },
        ),
        intent: "appointment",
        source: "booking",
      });
    }

    // State: waiting for phone number
    if (bookingState.state === "waiting_phone") {
      const phoneMatch = message.match(/(03\d{9}|\+92\d{10})/);
      const pPhone = phoneMatch ? phoneMatch[1] : message.trim();
      const pName = bookingState.pendingName || "Guest User";
      const doctor = resolveDoctor(bookingState.pendingDoctorId, "", history);
      const dateStr =
        bookingState.pendingDate ||
        (() => {
          const d = new Date();
          d.setDate(d.getDate() + 1);
          return d.toISOString().split("T")[0];
        })();
      const timeStr = bookingState.pendingTime;

      if (doctor && timeStr) {
        const result = bookAppointment(
          pName,
          pPhone,
          doctor.id,
          dateStr,
          timeStr,
        );
        return res.json({
          final: true,
          response: result.message,
          intent: "appointment",
          source: "booking",
        });
      }

      if (doctor) {
        const slots = getAvailableSlots(doctor.id, dateStr);
        return res.json({
          final: true,
          response: withStateToken(
            formatAvailableSlots(slots, doctor.name, dateStr),
            { doctorId: doctor.id, date: dateStr },
          ),
          intent: "appointment",
          source: "booking",
        });
      }

      // Lost the doctor entirely — ask the user to restate it.
      return res.json({
        final: true,
        response:
          "Sorry, I lost track of which doctor this booking was for. Could you tell me the doctor's name again?",
        intent: "appointment",
        source: "booking",
      });
    }

    // State: waiting for time selection, user picked a slot
    if (bookingState.state === "waiting_time" && resolvedTime) {
      const doctor = resolveDoctor(bookingState.pendingDoctorId, "", history);
      const dateStr =
        bookingState.pendingDate ||
        (() => {
          for (let i = history.length - 1; i >= 0; i--) {
            const m = history[i];
            if (m.role === "bot" && m.content.includes("Available slots for")) {
              const d = m.content.match(/(\d{4}-\d{2}-\d{2})/);
              if (d) return d[1];
            }
          }
          const d = new Date();
          d.setDate(d.getDate() + 1);
          return d.toISOString().split("T")[0];
        })();

      if (doctor) {
        // Ask for confirmation instead of going straight to name
        return res.json({
          final: true,
          response: withStateToken(
            `📋 Appointment Summary:\n• Doctor: ${doctor.name} (${doctor.department})\n• Date: ${dateStr}\n• Time: ${resolvedTime}\n• Fee: ${doctor.fee} PKR\n\nShall I confirm this booking? (Reply Yes / No)`,
            { doctorId: doctor.id, date: dateStr, time: resolvedTime },
          ),
          intent: "appointment",
          source: "booking",
        });
      }
    }

    // ── APPOINTMENT INTENT (fresh start) ────────────────────────────────────
    const isImpliedAppointment =
      bookingState.state === "waiting_time" && resolvedTime !== null;

    if (intent === "appointment" || isImpliedAppointment) {
      const dateMatch = message.match(/(\d{4}-\d{2}-\d{2})/);
      const doctor = findDoctorInMessage(message, history);
      const dateStr = dateMatch
        ? dateMatch[1]
        : (() => {
            const d = new Date();
            d.setDate(d.getDate() + 1);
            return d.toISOString().split("T")[0];
          })();

      if (doctor) {
        if (resolvedTime) {
          // Have doctor + time — ask confirmation
          return res.json({
            final: true,
            response: withStateToken(
              `📋 Appointment Summary:\n• Doctor: ${doctor.name} (${doctor.department})\n• Date: ${dateStr}\n• Time: ${resolvedTime}\n• Fee: ${doctor.fee} PKR\n\nShall I confirm this booking? (Reply Yes / No)`,
              { doctorId: doctor.id, date: dateStr, time: resolvedTime },
            ),
            intent: "appointment",
            source: "booking",
          });
        }

        // Show available slots
        const slots = getAvailableSlots(doctor.id, dateStr);
        return res.json({
          final: true,
          response: withStateToken(
            formatAvailableSlots(slots, doctor.name, dateStr),
            { doctorId: doctor.id, date: dateStr },
          ),
          intent: "appointment",
          source: "booking",
        });
      }

      // No doctor — list all
      const allDoctors = db
        .prepare("SELECT name, department, fee FROM doctors")
        .all() as any[];
      const doctorList = allDoctors
        .map(
          (d: any, i: number) =>
            `${i + 1}. ${d.name} — ${d.department} (Fee: ${d.fee} PKR)`,
        )
        .join("\n");

      return res.json({
        final: true,
        response: `Here are our available doctors:\n\n${doctorList}\n\nWhich doctor would you like to book with? Just tell me the doctor's name.`,
        intent: "appointment",
        source: "database",
      });
    }

    // ── DOCTOR QUERY ─────────────────────────────────────────────────────────
    if (intent === "doctor_query") {
      const doctorDir = getDoctorDirectoryContext();
      const ragContext = await searchKnowledgeBase(message);
      const enrichedContext = `--- Doctor Directory ---\n${doctorDir}\n\n--- Knowledge Base ---\n${ragContext}`;
      return res.json({
        final: false,
        context: enrichedContext,
        message,
        intent,
        source: "rag",
      });
    }

    // ── GREETING ─────────────────────────────────────────────────────────────

    // ── FAQ / UNKNOWN → RAG + LLM ─────────────────────────────────────────────
    // Always include doctor directory so LLM can answer fee/timing questions even for faq/unknown
    const doctorDir = getDoctorDirectoryContext();
    const ragContext = await searchKnowledgeBase(message);
    const enrichedContext = `--- Doctor Directory ---\n${doctorDir}\n\n--- Knowledge Base ---\n${ragContext}`;
    return res.json({
      final: false,
      context: enrichedContext,
      message,
      intent,
      source: "rag",
    });
  });

  // ── /api/chat-offline (Ollama streaming SSE) ──────────────────────────────
  app.post("/api/chat-offline", async (req, res) => {
    const message = (req.body.message || "").trim();
    const history: any[] = req.body.history || [];
    const context: string = req.body.context || "";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (token: string, done: boolean) => {
      res.write(`data: ${JSON.stringify({ token, done })}\n\n`);
    };

    if (!message) {
      send("Please send a valid message.", true);
      return res.end();
    }

    try {
      await callQwen(SYSTEM_PROMPT, message, context, history, (token) => {
        send(token, false);
      });
      send("", true);
    } catch (e) {
      console.error("Ollama offline error:", e);
      send(
        "I'm sorry, the offline assistant is unavailable. Please make sure Ollama is running.",
        true,
      );
    }
    res.end();
  });

  // ── Static / Vite ─────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(path.resolve(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) =>
      res.sendFile(path.join(distPath, "index.html")),
    );
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
