export function detectIntent(
  message: string,
): "doctor_query" | "appointment" | "faq" | "out_of_scope" | "unknown" {
  const msg = message.toLowerCase();

  const outOfScopeKeywords = [
    "cricket",
    "football",
    "weather",
    "politics",
    "code",
    "python",
    "javascript",
    "recipe",
    "movie",
    "song",
    "sports",
    "news",
    "stock",
    "price of gold",
    "dollar rate",
    "exam result",
  ];
  if (outOfScopeKeywords.some((kw) => msg.includes(kw))) {
    return "out_of_scope";
  }

  const appointmentKeywords = [
    "book",
    "schedule",
    "appointment",
    "appoitment",
    "appoitmnet",
    "appoinment",
    "apointment",
    "slot",
    "reserve",
    "when can i see",
    "i want to see doctor",
    "fix appointment",
    "book appointment",
    "available slot",
    "cancel",
    "reschedule",
    "re-schedule",
  ];
  if (appointmentKeywords.some((kw) => msg.includes(kw))) {
    return "appointment";
  }

  // Doctor query is checked BEFORE faq so "what doctors are available" matches here via "doctor"
  // fee/cost/charge also go here so doctor directory context is included in the LLM call
  const doctorKeywords = [
    "doctor",
    "dr.",
    "dr ",
    "physician",
    "specialist",
    "cardiologist",
    "dermatologist",
    "gynecologist",
    "orthopedic",
    "pediatric",
    "neurologist",
    "ent",
    "gastro",
    "surgeon",
    "consult",
    "department",
    "service",
    "fee",
    "fees",
    "cost",
    "charge",
    "charges",
    "price",
    "qualification",
    "timing",
    "available",
  ];
  if (doctorKeywords.some((kw) => msg.includes(kw))) {
    return "doctor_query";
  }

  const faqKeywords = [
    "insurance",
    "lab",
    "laboratory",
    "emergency",
    "payment",
    "parking",
    "visiting hours",
    "how to",
    "working hours",
    "open",
    "closed",
    "phone",
    "contact",
    "address",
    "email",
    "ambulance",
    "pharmacy",
    "reports",
    "certificate",
    "records",
    "admission",
  ];
  if (faqKeywords.some((kw) => msg.includes(kw))) {
    return "faq";
  }

  return "unknown";
}

export function getGreetingResponse(): string {
  return `Assalam-o-Alaikum! 👋 Welcome to Al-Shifa General Hospital.

I'm your AI assistant and I can help you with:
• 🏥 Doctor information and timings
• 📅 Book appointments right here in this chat
• 🏢 Hospital services and departments
• ❓ General FAQs (insurance, lab, parking, etc.)

How can I assist you today?`;
}

export function getOutOfScopeResponse(): string {
  return `I'm sorry, I can only assist with matters related to Al-Shifa General Hospital — such as doctors, appointments, services, and general hospital information.

For other queries, please use a general search engine. 😊`;
}
