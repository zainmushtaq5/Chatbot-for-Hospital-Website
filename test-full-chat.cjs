const http = require('http');

const messages = [
  // Greeting
  "Hello",
  // Doctor queries
  "What doctors are available?",
  "Tell me about Dr. Ahmed Khan",
  "I need to see a cardiologist",
  // Appointment booking flow
  "I want to book an appointment",
  "Book appointment with Dr. Ahmed Khan",
  "Book appointment with Dr. Ahmed Khan at 10:00 AM",
  // FAQ
  "What are the visiting hours?",
  "Do you accept insurance?",
  "What is the emergency number?",
  "What are your lab timings?",
  // Services
  "What services do you offer?",
  // Out of scope
  "What is the weather today?",
];

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ message });
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = http.request(options, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Parse error: ' + body)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  let passed = 0;
  let failed = 0;
  for (const msg of messages) {
    console.log('\n' + '='.repeat(70));
    console.log('USER: ' + msg);
    console.log('-'.repeat(70));
    try {
      const result = await sendMessage(msg);
      const isGoodResponse = result.response && 
        !result.response.includes("I'm sorry, I'm currently offline") &&
        result.response.length > 10;
      const status = isGoodResponse ? 'PASS' : 'FAIL';
      if (isGoodResponse) passed++; else failed++;
      console.log('[' + status + '] [intent: ' + result.intent + ', source: ' + result.source + ']:');
      console.log(result.response);
    } catch (err) {
      failed++;
      console.error('[FAIL] ERROR:', err.message);
    }
  }
  console.log('\n' + '='.repeat(70));
  console.log('RESULTS: ' + passed + '/' + messages.length + ' passed, ' + failed + ' failed');
}

main();
