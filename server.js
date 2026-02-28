const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, process.env.DB_FILE || 'app.db');

const DATABASE_CONFIG = {
  name: process.env.DB_NAME || 'DB_NAME',
  username: process.env.DB_USERNAME || 'DB_USERNAME',
  password: process.env.DB_PASSWORD || 'DB_PASSWORD'
};

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

  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    age INTEGER,
    favorite_color TEXT,
    bio TEXT,
    newsletter INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    topic TEXT NOT NULL,
    message TEXT NOT NULL,
    sentiment TEXT,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    contact_time TEXT,
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
    if (url === '/api/system' && method === 'GET') {
      const counts = db
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM profiles) AS profiles,
            (SELECT COUNT(*) FROM feedback) AS feedback,
            (SELECT COUNT(*) FROM profiles) + (SELECT COUNT(*) FROM feedback) AS totalRecords`
        )
        .get();

      sendJson(res, 200, {
        db: DATABASE_CONFIG,
        metrics: counts
      });
      return;
    }

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

      if (!user || hashPassword(password, user.salt) !== user.password_hash) {
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

    if (url === '/api/profiles' && method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const { fullName, email, age, favoriteColor, bio, newsletter } = await readBody(req);
      if (!fullName || !email || !bio) {
        sendJson(res, 400, { message: 'Full name, email, and bio are required.' });
        return;
      }

      const result = db
        .prepare(
          `INSERT INTO profiles (user_id, full_name, email, age, favorite_color, bio, newsletter)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          authUser.id,
          String(fullName).trim(),
          String(email).trim(),
          Number(age) || null,
          String(favoriteColor || '#1d4ed8'),
          String(bio).trim(),
          newsletter ? 1 : 0
        );

      const profile = db
        .prepare(
          `SELECT profiles.id, users.username, profiles.full_name AS fullName, profiles.email,
           profiles.age, profiles.favorite_color AS favoriteColor, profiles.bio,
           profiles.newsletter, profiles.created_at AS createdAt
           FROM profiles JOIN users ON users.id = profiles.user_id WHERE profiles.id = ?`
        )
        .get(result.lastInsertRowid);

      sendJson(res, 201, profile);
      return;
    }

    if (url === '/api/feedback' && method === 'POST') {
      const authUser = requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const { topic, message, sentiment, rating, contactTime } = await readBody(req);
      if (!topic || !message || !rating) {
        sendJson(res, 400, { message: 'Topic, message and rating are required.' });
        return;
      }

      const numericRating = Number(rating);
      if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
        sendJson(res, 400, { message: 'Rating must be an integer between 1 and 5.' });
        return;
      }

      const result = db
        .prepare(
          `INSERT INTO feedback (user_id, topic, message, sentiment, rating, contact_time)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          authUser.id,
          String(topic).trim(),
          String(message).trim(),
          String(sentiment || 'Neutral'),
          numericRating,
          String(contactTime || 'Morning')
        );

      const row = db
        .prepare(
          `SELECT feedback.id, users.username, feedback.topic, feedback.message,
           feedback.sentiment, feedback.rating, feedback.contact_time AS contactTime,
           feedback.created_at AS createdAt
           FROM feedback JOIN users ON users.id = feedback.user_id WHERE feedback.id = ?`
        )
        .get(result.lastInsertRowid);

      sendJson(res, 201, row);
      return;
    }

    if (url === '/api/submissions' && method === 'GET') {
      const authUser = requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const profiles = db
        .prepare(
          `SELECT 'profile' AS type, profiles.id, users.username,
           profiles.full_name AS title, profiles.bio AS details,
           profiles.created_at AS createdAt
           FROM profiles JOIN users ON users.id = profiles.user_id`
        )
        .all();

      const feedback = db
        .prepare(
          `SELECT 'feedback' AS type, feedback.id, users.username,
           feedback.topic AS title, feedback.message AS details,
           feedback.created_at AS createdAt
           FROM feedback JOIN users ON users.id = feedback.user_id`
        )
        .all();

      const items = [...profiles, ...feedback].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      sendJson(res, 200, items);
      return;
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
  console.log(
    `Database placeholders -> DB_NAME=${DATABASE_CONFIG.name}, DB_USERNAME=${DATABASE_CONFIG.username}, DB_PASSWORD=${DATABASE_CONFIG.password}`
  );
});
