const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const users = [
  { id: 1, username: 'admin', password: 'admin123' },
  { id: 2, username: 'user', password: 'user123' }
];

let feedbacks = [
  {
    id: 1,
    username: 'admin',
    message: 'Great shopping experience and fast delivery!',
    rating: 5,
    createdAt: new Date().toISOString()
  }
];
let feedbackIdCounter = 2;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const requestPath = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain; charset=utf-8' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  try {
    if (url === '/api/login' && method === 'POST') {
      const { username, password } = await readBody(req);

      if (!username || !password) {
        sendJson(res, 400, { message: 'Username and password are required.' });
        return;
      }

      const user = users.find(
        (item) => item.username === username && item.password === password
      );

      if (!user) {
        sendJson(res, 401, { message: 'Invalid credentials.' });
        return;
      }

      sendJson(res, 200, {
        message: 'Login successful.',
        user: { id: user.id, username: user.username }
      });
      return;
    }

    if (url === '/api/feedback' && method === 'GET') {
      sendJson(res, 200, feedbacks);
      return;
    }

    if (url === '/api/feedback' && method === 'POST') {
      const { username, message, rating } = await readBody(req);

      if (!username || !message || !rating) {
        sendJson(res, 400, { message: 'Username, message, and rating are required.' });
        return;
      }

      const newFeedback = {
        id: feedbackIdCounter,
        username,
        message,
        rating: Number(rating),
        createdAt: new Date().toISOString()
      };

      feedbackIdCounter += 1;
      feedbacks.unshift(newFeedback);

      sendJson(res, 201, newFeedback);
      return;
    }

    const feedbackByIdMatch = url.match(/^\/api\/feedback\/(\d+)$/);
    if (feedbackByIdMatch) {
      const id = Number(feedbackByIdMatch[1]);
      const feedback = feedbacks.find((item) => item.id === id);

      if (!feedback) {
        sendJson(res, 404, { message: 'Feedback not found.' });
        return;
      }

      if (method === 'GET') {
        sendJson(res, 200, feedback);
        return;
      }

      if (method === 'PUT') {
        const { message, rating } = await readBody(req);

        if (!message || !rating) {
          sendJson(res, 400, { message: 'Message and rating are required.' });
          return;
        }

        feedback.message = message;
        feedback.rating = Number(rating);

        sendJson(res, 200, feedback);
        return;
      }

      if (method === 'DELETE') {
        feedbacks = feedbacks.filter((item) => item.id !== id);
        res.writeHead(204);
        res.end();
        return;
      }
    }

    if (url.startsWith('/api/')) {
      sendJson(res, 404, { message: 'API route not found.' });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 400, { message: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
