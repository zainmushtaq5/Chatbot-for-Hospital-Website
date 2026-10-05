import re

def detect_intent(message):
    if not message:
        return "unknown"
        
    msg = message.lower().strip()

    # 1. Out of scope keywords (checked first)
    out_of_scope_keywords = [
        "cricket", "football", "weather", "politics", "code", "python",
        "javascript", "recipe", "movie", "song", "sports", "news",
        "stock", "price of gold", "dollar rate", "exam result"
    ]
    for kw in out_of_scope_keywords:
        if kw in msg:
            return "out_of_scope"

    # 2. Appointment keywords
    appointment_keywords = [
        "book", "schedule", "appointment", "slot", "reserve", 
        "when can i see", "i want to see doctor", "fix appointment", 
        "book appointment", "available slot"
    ]
    for kw in appointment_keywords:
        if kw in msg:
            return "appointment"

    # Define indicators
    doc_indicators = [
        "doctor", "dr", "physician", "specialist", "cardiologist", 
        "dermatologist", "gynecologist", "orthopedic", "pediatric", 
        "neurologist", "ent", "gastro", "surgeon", "fee", "consult", 
        "appointment with dr"
    ]
    
    faq_indicators = [
        "insurance", "lab", "laboratory", "emergency", "payment", 
        "parking", "visiting hours", "how to", "working hours", "open", 
        "closed", "phone", "contact", "address", "email", 
        "ambulance", "pharmacy", "reports", "certificate", "records", 
        "admission"
    ]

    has_doc_indicator = any(kw in msg for kw in doc_indicators)
    has_faq_indicator = any(kw in msg for kw in faq_indicators)
    has_timing = "timing" in msg or "timings" in msg
    has_available = "available" in msg or "availability" in msg

    # If it has doc indicator, it's highly likely doctor query (unless overridden by appointment check above)
    if has_doc_indicator:
        return "doctor_query"

    # If it has faq indicator, it's highly likely faq
    if has_faq_indicator:
        return "faq"

    # Handle timing and available conflicts or clean matches
    if has_timing or has_available:
        if has_available:
            return "doctor_query"
        if has_timing:
            return "faq"

    # 3. Greeting keywords
    greeting_keywords = [
        "hi", "hello", "salam", "assalam", "good morning", "good evening", 
        "good afternoon", "hey", "aoa", "asslamo alaikum", "how are you", 
        "who are you"
    ]
    for kw in greeting_keywords:
        if len(kw) <= 3:
            pattern = rf"\b{re.escape(kw)}\b"
            if re.search(pattern, msg):
                return "greeting"
        elif kw in msg:
            return "greeting"

    return "unknown"

def get_greeting_response():
    return (
        "Assalam-o-Alaikum! 👋 Welcome to Al-Shifa General Hospital.\n\n"
        "I can help you with:\n"
        "• Doctor information and timings\n"
        "• Appointment booking\n"
        "• Hospital services and departments\n"
        "• General FAQs\n\n"
        "How can I assist you today?"
    )

def get_out_of_scope_response():
    return (
        "I'm sorry, I can only assist with matters related to Al-Shifa General Hospital — "
        "such as doctors, appointments, services, and general hospital information.\n\n"
        "For other queries, please use a general search engine."
    )

if __name__ == "__main__":
    # Quick self-test
    test_msgs = [
        ("Hi", "greeting"),
        ("Book an appointment", "appointment"),
        ("Who is the cardiologist?", "doctor_query"),
        ("Is parking available?", "faq"),
        ("Who won the cricket match?", "out_of_scope"),
        ("Something completely random", "unknown")
    ]
    print("Running intent tests...")
    for msg, expected in test_msgs:
        detected = detect_intent(msg)
        status = "PASS" if detected == expected else f"FAIL (Got: {detected})"
        print(f"'{msg}' -> {detected} ({status})")
