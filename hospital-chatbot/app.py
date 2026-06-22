import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from database import init_db, get_db_connection
from rag import build_knowledge_base, search_knowledge_base
from intent import detect_intent, get_greeting_response, get_out_of_scope_response
from appointments import get_available_slots, book_appointment, get_doctor_by_name, format_available_slots
from llm import get_llm_response

app = FastAPI(title="Al-Shifa General Hospital Chatbot API")

# Add CORS middleware to allow all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"

class ChatResponse(BaseModel):
    response: str
    intent: str
    source: str

@app.on_event("startup")
def startup_event():
    # Initialize the database and load doctor records
    init_db()
    # Build vector database (skips if already built)
    build_knowledge_base()

def extract_date(message):
    # Match YYYY-MM-DD
    match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", message)
    if match:
        return match.group(1)
    # Match DD-MM-YYYY
    match = re.search(r"\b(\d{2}-\d{2}-\d{4})\b", message)
    if match:
        d, m, y = match.group(1).split('-')
        return f"{y}-{m}-{d}"
    return None

def extract_time(message):
    # Match HH:MM (with optional AM/PM suffix)
    match = re.search(r"\b(\d{1,2}:\d{2})\s*(am|pm|AM|PM)?\b", message)
    if match:
        return match.group(0)
    return None

def extract_phone(message):
    # Match Pakistani mobile number pattern (e.g. 03xxxxxxxxx or +92xxxxxxxxxx)
    match = re.search(r"\b(03\d{9}|\+92\d{10})\b", message)
    if match:
        return match.group(1)
    return None

def extract_patient_name(message):
    # Find name if user explicitly specified "name: [Name]" or "patient: [Name]" or "for [Name]"
    match = re.search(r"(?:patient name is|patient name:|name is|name:|for patient|for)\s+([A-Za-z\s]+)", message, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return None

def find_doctor_in_message(message):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, department FROM doctors")
    all_docs = cursor.fetchall()
    conn.close()

    msg = message.lower()
    # Check for full name or last name/first name fragments (excluding 'dr.')
    for doc in all_docs:
        doc_name = doc["name"].lower()
        if doc_name in msg:
            return doc
            
        # Try checking significant parts (e.g. "Ahmed", "Naqvi", "Imran", "Farooq")
        name_parts = [p for p in doc_name.replace("dr.", "").replace(".", "").strip().split() if len(p) > 2]
        for part in name_parts:
            if part in msg:
                return doc
    return None

@app.post("/chat", response_model=ChatResponse)
def chat_endpoint(request: ChatRequest):
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    intent = detect_intent(message)

    if intent == "greeting":
        return ChatResponse(
            response=get_greeting_response(),
            intent=intent,
            source="static"
        )

    if intent == "out_of_scope":
        return ChatResponse(
            response=get_out_of_scope_response(),
            intent=intent,
            source="static"
        )

    if intent == "appointment":
        # a. Extract doctor name from message
        doctor = find_doctor_in_message(message)
        
        # If doctor found, check for date
        if doctor:
            date = extract_date(message)
            if date:
                # check if time is also provided to trigger booking
                time_str = extract_time(message)
                if time_str:
                    phone = extract_phone(message) or "0300-1234567"
                    patient_name = extract_patient_name(message) or "Web Patient"
                    
                    booking_res = book_appointment(patient_name, phone, doctor["id"], date, time_str)
                    return ChatResponse(
                        response=booking_res["message"],
                        intent=intent,
                        source="database"
                    )
                else:
                    # Date is provided, show available slots
                    slots = get_available_slots(doctor["id"], date)
                    response_text = format_available_slots(slots, doctor["name"], date)
                    return ChatResponse(
                        response=response_text,
                        intent=intent,
                        source="database"
                    )
            else:
                # Doctor found, no date provided
                return ChatResponse(
                    response=f"I found {doctor['name']} ({doctor['department']}). For which date would you like to schedule the appointment? Please reply with the date in YYYY-MM-DD format.",
                    intent=intent,
                    source="static"
                )
        else:
            # Doctor not found
            # Check if this is a general query about appointments (complex query)
            general_query_keywords = ["how", "process", "where", "can i", "procedure", "fee", "timings", "policy"]
            is_complex_query = any(kw in message.lower() for kw in general_query_keywords)
            
            if is_complex_query:
                # Use LLM with context for general / complex appointment queries
                context = search_knowledge_base(message)
                response_text, source = get_llm_response(message, context)
                return ChatResponse(
                    response=response_text,
                    intent=intent,
                    source=source
                )
            else:
                return ChatResponse(
                    response="Which doctor or specialty would you like to book an appointment for?",
                    intent=intent,
                    source="static"
                )

    # For all other intents (doctor_query, faq, unknown)
    context = search_knowledge_base(message)
    response_text, source = get_llm_response(message, context)
    
    return ChatResponse(
        response=response_text,
        intent=intent,
        source=source
    )

@app.get("/health")
def health_endpoint():
    return {
        "status": "ok",
        "hospital": "Al-Shifa General Hospital"
    }

@app.get("/doctors")
def get_doctors_endpoint():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM doctors")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]
