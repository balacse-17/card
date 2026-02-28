const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'app.db');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function seedDefaultUser() {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (existing) {
    return;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword('admin123', salt);
  db.prepare('INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)').run(
    'admin',
    passwordHash,
    salt
  );
}

seedDefaultUser();

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
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return null;
  }

  const session = db
    .prepare(
      `SELECT users.id, users.username
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?`
    )
    .get(token);

  if (!session) {
    return null;
  }

  return { token, ...session };
}

function requireAuth(req, res) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    sendJson(res, 401, { message: 'Unauthorized. Please login with a valid token.' });
    return null;
  }

  return user;
}

function serveStatic(req, res) {
  const requestPath = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
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
    if (url === '/api/register' && method === 'POST') {
      const { username, password } = await readBody(req);

      if (!username || !password) {
        sendJson(res, 400, { message: 'Username and password are required.' });
        return;
      }

      const cleanUsername = String(username).trim();
      if (cleanUsername.length < 3 || password.length < 6) {
        sendJson(res, 400, {
          message: 'Username must be at least 3 chars and password at least 6 chars.'
        });
        return;
      }

      const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
      if (exists) {
        sendJson(res, 409, { message: 'Username already exists.' });
        return;
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      const result = db
        .prepare('INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)')
        .run(cleanUsername, passwordHash, salt);

      sendJson(res, 201, { id: result.lastInsertRowid, username: cleanUsername });
      return;
    }

    if (url === '/api/login' && method === 'POST') {
      const { username, password } = await readBody(req);

      if (!username || !password) {
        sendJson(res, 400, { message: 'Username and password are required.' });
        return;
      }

      const user = db
        .prepare('SELECT id, username, password_hash, salt FROM users WHERE username = ?')
        .get(String(username).trim());

      if (!user) {
        sendJson(res, 401, { message: 'Invalid credentials.' });
        return;
      }

      const attemptedHash = hashPassword(password, user.salt);
      if (attemptedHash !== user.password_hash) {
        sendJson(res, 401, { message: 'Invalid credentials.' });
        return;
      }

      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);

      sendJson(res, 200, {
        message: 'Login successful.',
        token,
        user: { id: user.id, username: user.username }
      });
      return;
    }

    if (url === '/api/logout' && method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) {
        return;
      }

      db.prepare('DELETE FROM sessions WHERE token = ?').run(authUser.token);
      sendJson(res, 200, { message: 'Logged out successfully.' });
      return;
    }

    if (url === '/api/feedback' && method === 'GET') {
      const authUser = requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const rows = db
        .prepare(
          `SELECT feedback.id, users.username, feedback.message, feedback.rating, feedback.created_at AS createdAt
           FROM feedback
           JOIN users ON users.id = feedback.user_id
           ORDER BY feedback.id DESC`
        )
        .all();

      sendJson(res, 200, rows);
      return;
    }

    if (url === '/api/feedback' && method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const { message, rating } = await readBody(req);

      if (!message || !rating) {
        sendJson(res, 400, { message: 'Message and rating are required.' });
        return;
      }

      const numericRating = Number(rating);
      if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
        sendJson(res, 400, { message: 'Rating must be an integer between 1 and 5.' });
        return;
      }

      const result = db
        .prepare('INSERT INTO feedback (user_id, message, rating) VALUES (?, ?, ?)')
        .run(authUser.id, String(message).trim(), numericRating);

      const newFeedback = db
        .prepare(
          `SELECT feedback.id, users.username, feedback.message, feedback.rating, feedback.created_at AS createdAt
           FROM feedback
           JOIN users ON users.id = feedback.user_id
           WHERE feedback.id = ?`
        )
        .get(result.lastInsertRowid);

      sendJson(res, 201, newFeedback);
      return;
    }

    const feedbackByIdMatch = url.match(/^\/api\/feedback\/(\d+)$/);
    if (feedbackByIdMatch) {
      const authUser = requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const feedbackId = Number(feedbackByIdMatch[1]);
      const feedback = db
        .prepare(
          `SELECT feedback.id, feedback.user_id, users.username, feedback.message, feedback.rating, feedback.created_at AS createdAt
           FROM feedback JOIN users ON users.id = feedback.user_id WHERE feedback.id = ?`
        )
        .get(feedbackId);

      if (!feedback) {
        sendJson(res, 404, { message: 'Feedback not found.' });
        return;
      }

      if (method === 'GET') {
        sendJson(res, 200, feedback);
        return;
      }

      if (feedback.user_id !== authUser.id) {
        sendJson(res, 403, { message: 'Forbidden: You can only update/delete your own feedback.' });
        return;
      }

      if (method === 'PUT') {
        const { message, rating } = await readBody(req);

        if (!message || !rating) {
          sendJson(res, 400, { message: 'Message and rating are required.' });
          return;
        }

        const numericRating = Number(rating);
        if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
          sendJson(res, 400, { message: 'Rating must be an integer between 1 and 5.' });
          return;
        }

        db.prepare('UPDATE feedback SET message = ?, rating = ? WHERE id = ?').run(
          String(message).trim(),
          numericRating,
          feedbackId
        );

        const updated = db
          .prepare(
            `SELECT feedback.id, users.username, feedback.message, feedback.rating, feedback.created_at AS createdAt
             FROM feedback JOIN users ON users.id = feedback.user_id WHERE feedback.id = ?`
          )
          .get(feedbackId);

        sendJson(res, 200, updated);
        return;
      }

      if (method === 'DELETE') {
        db.prepare('DELETE FROM feedback WHERE id = ?').run(feedbackId);
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
