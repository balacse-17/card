const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const PORT = process.env.PORT || 3000;

const DATABASE_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USERNAME || 'DB_USERNAME',
  password: process.env.DB_PASSWORD || 'DB_PASSWORD',
  database: process.env.DB_NAME || 'DB_NAME'
};

let pool;

async function initializeDatabase() {
  pool = mysql.createPool({
    host: DATABASE_CONFIG.host,
    port: DATABASE_CONFIG.port,
    user: DATABASE_CONFIG.user,
    password: DATABASE_CONFIG.password,
    database: DATABASE_CONFIG.database,
    waitForConnections: true,
    connectionLimit: 10
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      salt VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(255) PRIMARY KEY,
      user_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      age INT NULL,
      favorite_color VARCHAR(20) NULL,
      bio TEXT NOT NULL,
      newsletter TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      topic VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      sentiment VARCHAR(20) NULL,
      rating INT NOT NULL,
      contact_time VARCHAR(30) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT chk_feedback_rating CHECK (rating >= 1 AND rating <= 5)
    ) ENGINE=InnoDB;
  `);

  await seedDefaultUser();
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

async function seedDefaultUser() {
  const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', ['admin']);
  if (existing.length > 0) {
    return;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword('admin123', salt);
  await pool.query('INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)', [
    'admin',
    passwordHash,
    salt
  ]);
}

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

async function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT users.id, users.username
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ?`,
    [token]
  );

  if (rows.length === 0) {
    return null;
  }

  return { token, ...rows[0] };
}

async function requireAuth(req, res) {
  const user = await getAuthenticatedUser(req);
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
      const [rows] = await pool.query(
        `SELECT
          (SELECT COUNT(*) FROM profiles) AS profiles,
          (SELECT COUNT(*) FROM feedback) AS feedback,
          (SELECT COUNT(*) FROM profiles) + (SELECT COUNT(*) FROM feedback) AS totalRecords`
      );
      sendJson(res, 200, { metrics: rows[0] });
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

      const [exists] = await pool.query('SELECT id FROM users WHERE username = ?', [cleanUsername]);
      if (exists.length > 0) {
        sendJson(res, 409, { message: 'Username already exists.' });
        return;
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      const [result] = await pool.query(
        'INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)',
        [cleanUsername, passwordHash, salt]
      );

      sendJson(res, 201, { id: result.insertId, username: cleanUsername });
      return;
    }

    if (url === '/api/login' && method === 'POST') {
      const { username, password } = await readBody(req);

      if (!username || !password) {
        sendJson(res, 400, { message: 'Username and password are required.' });
        return;
      }

      const [rows] = await pool.query(
        'SELECT id, username, password_hash, salt FROM users WHERE username = ?',
        [String(username).trim()]
      );
      const user = rows[0];

      if (!user || hashPassword(password, user.salt) !== user.password_hash) {
        sendJson(res, 401, { message: 'Invalid credentials.' });
        return;
      }

      const token = crypto.randomBytes(32).toString('hex');
      await pool.query('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, user.id]);

      sendJson(res, 200, {
        message: 'Login successful.',
        token,
        user: { id: user.id, username: user.username }
      });
      return;
    }

    if (url === '/api/logout' && method === 'POST') {
      const authUser = await requireAuth(req, res);
      if (!authUser) {
        return;
      }

      await pool.query('DELETE FROM sessions WHERE token = ?', [authUser.token]);
      sendJson(res, 200, { message: 'Logged out successfully.' });
      return;
    }

    if (url === '/api/profiles' && method === 'POST') {
      const authUser = await requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const { fullName, email, age, favoriteColor, bio, newsletter } = await readBody(req);
      if (!fullName || !email || !bio) {
        sendJson(res, 400, { message: 'Full name, email, and bio are required.' });
        return;
      }

      const [result] = await pool.query(
        `INSERT INTO profiles (user_id, full_name, email, age, favorite_color, bio, newsletter)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          authUser.id,
          String(fullName).trim(),
          String(email).trim(),
          Number(age) || null,
          String(favoriteColor || '#1d4ed8'),
          String(bio).trim(),
          newsletter ? 1 : 0
        ]
      );

      const [rows] = await pool.query(
        `SELECT profiles.id, users.username, profiles.full_name AS fullName, profiles.email,
         profiles.age, profiles.favorite_color AS favoriteColor, profiles.bio,
         profiles.newsletter, profiles.created_at AS createdAt
         FROM profiles JOIN users ON users.id = profiles.user_id WHERE profiles.id = ?`,
        [result.insertId]
      );

      sendJson(res, 201, rows[0]);
      return;
    }

    if (url === '/api/feedback' && method === 'POST') {
      const authUser = await requireAuth(req, res);
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

      const [result] = await pool.query(
        `INSERT INTO feedback (user_id, topic, message, sentiment, rating, contact_time)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          authUser.id,
          String(topic).trim(),
          String(message).trim(),
          String(sentiment || 'Neutral'),
          numericRating,
          String(contactTime || 'Morning')
        ]
      );

      const [rows] = await pool.query(
        `SELECT feedback.id, users.username, feedback.topic, feedback.message,
         feedback.sentiment, feedback.rating, feedback.contact_time AS contactTime,
         feedback.created_at AS createdAt
         FROM feedback JOIN users ON users.id = feedback.user_id WHERE feedback.id = ?`,
        [result.insertId]
      );

      sendJson(res, 201, rows[0]);
      return;
    }

    if (url === '/api/submissions' && method === 'GET') {
      const authUser = await requireAuth(req, res);
      if (!authUser) {
        return;
      }

      const [profiles] = await pool.query(
        `SELECT 'profile' AS type, profiles.id, users.username,
         profiles.full_name AS title, profiles.bio AS details,
         profiles.created_at AS createdAt
         FROM profiles JOIN users ON users.id = profiles.user_id`
      );

      const [feedback] = await pool.query(
        `SELECT 'feedback' AS type, feedback.id, users.username,
         feedback.topic AS title, feedback.message AS details,
         feedback.created_at AS createdAt
         FROM feedback JOIN users ON users.id = feedback.user_id`
      );

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

initializeDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      console.log('MySQL connection initialized from environment variables.');
    });
  })
  .catch((error) => {
    console.error('Failed to initialize MySQL:', error.message);
    process.exit(1);
  });
