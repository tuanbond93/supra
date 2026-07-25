const http = require('http');

const server = http.createServer((req, res) => {
  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    body = Buffer.concat(body);
    console.log('=== Headers ===');
    console.log(req.headers);
    console.log('=== Body length ===', body.length);
    console.log('=== Body content ===', body.toString('utf8'));
    res.writeHead(200);
    res.end('ok');
  });
});

server.listen(4568, async () => {
  const boundary = '----BoundaryTest';
  const parts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="chat_id"\r\n\r\n`,
    `123456\r\n`,
    `--${boundary}--\r\n`
  ];
  const bodyBuffer = Buffer.concat(parts.map(p => Buffer.from(p)));
  
  try {
    const res = await fetch('http://localhost:4568/', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length.toString()
      },
      body: bodyBuffer
    });
    console.log('Response:', res.status);
  } catch (e) {
    console.error(e);
  }
  
  server.close();
});
