const http = require('http');

const data = JSON.stringify({ message: "Hospital services and departments" });

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, res => {
  let body = '';
  res.on('data', d => { body += d; });
  res.on('end', () => { console.log(body); });
});

req.on('error', error => { console.error(error); });

req.write(data);
req.end();
