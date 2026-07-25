const http = require('http');

const server = http.createServer((req, res) => {
  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    body = Buffer.concat(body);
    console.log('=== Request Headers ===');
    console.log(req.headers);
    console.log('=== Body Length ===', body.length);
    console.log('=== Body Sample (First 500 chars) ===');
    console.log(body.toString('utf8', 0, Math.min(body.length, 500)));
    res.writeHead(200);
    res.end('ok');
  });
});

server.listen(4567, async () => {
  console.log('Test server listening on 4567');
  
  const excelBuffer = Buffer.from('dummy excel content');
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const formData = new FormData();
  formData.append('chat_id', '123456');
  formData.append('document', blob, `test_file.xlsx`);
  
  try {
    const res = await fetch('http://localhost:4567/', {
      method: 'POST',
      body: formData
    });
    console.log('Fetch response status:', res.status);
  } catch (err) {
    console.error('Fetch error:', err);
  }
  
  server.close();
});
