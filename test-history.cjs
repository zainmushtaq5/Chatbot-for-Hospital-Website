const http = require('http');

async function chat(message, history) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ message, history });
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
  const history = [];
  
  const turns = [
    "Hi, how are you?",
    "I need to book an appointment with Dr. Ayesha Tariq",
    "11:30 AM"
  ];
  
  for (const msg of turns) {
    console.log('\nUSER: ' + msg);
    try {
      const result = await chat(msg, history);
      console.log('BOT (' + result.intent + '): ' + result.response);
      history.push({ role: 'user', content: msg });
      history.push({ role: 'bot', content: result.response });
    } catch (err) {
      console.error('ERROR:', err.message);
    }
  }
}

main();
