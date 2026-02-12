const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ===== CONFIG =====
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || ''; // Set your bot token here

// ===== IN-MEMORY DATABASE (replace with real DB in production) =====
const users = new Map();

// ===== HELPERS =====
function getUser(userId) {
    if (!users.has(userId)) {
        users.set(userId, {
            userId,
            userName: 'Player',
            coins: 0,
            totalTaps: 0,
            level: 1,
            tapPower: 1,
            lastTap: Date.now()
        });
    }
    return users.get(userId);
}

function calculateLevel(coins) {
    if (coins >= 100000) return 5;
    if (coins >= 50000) return 4;
    if (coins >= 10000) return 3;
    if (coins >= 1000) return 2;
    return 1;
}

// Validate Telegram initData (basic check)
function validateInitData(initData) {
    if (!BOT_TOKEN || !initData) return true; // Skip validation if no token
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        params.delete('hash');

        const sorted = [...params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const computedHash = crypto.createHmac('sha256', secretKey).update(sorted).digest('hex');

        return computedHash === hash;
    } catch {
        return false;
    }
}

// Rate limiting (basic)
const rateLimits = new Map();
function checkRateLimit(userId) {
    const now = Date.now();
    const last = rateLimits.get(userId) || 0;
    if (now - last < 500) return false; // Max 2 syncs per second
    rateLimits.set(userId, now);
    return true;
}

// ===== API HANDLERS =====
function handleGetUser(userId, res) {
    const user = getUser(userId);
    sendJSON(res, 200, user);
}

function handleTap(body, res) {
    const { userId, userName, coins, initData } = body;

    if (!userId || !coins) {
        return sendJSON(res, 400, { error: 'Missing data' });
    }

    // Basic validation
    if (!validateInitData(initData)) {
        return sendJSON(res, 403, { error: 'Invalid initData' });
    }

    if (!checkRateLimit(userId)) {
        return sendJSON(res, 429, { error: 'Too fast' });
    }

    // Max coins per sync batch (anti-cheat)
    const maxCoinsPerBatch = 50;
    const safeCoins = Math.min(Math.max(0, Math.floor(coins)), maxCoinsPerBatch);

    const user = getUser(userId);
    user.userName = userName || user.userName;
    user.coins += safeCoins;
    user.totalTaps += safeCoins;
    user.level = calculateLevel(user.coins);
    user.lastTap = Date.now();

    sendJSON(res, 200, user);
}

function handleLeaderboard(res) {
    const sorted = [...users.values()]
        .sort((a, b) => b.coins - a.coins)
        .slice(0, 100)
        .map(u => ({
            userId: u.userId,
            userName: u.userName,
            coins: u.coins,
            level: u.level
        }));

    sendJSON(res, 200, sorted);
}

// ===== HTTP SERVER =====
function sendJSON(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

function serveStatic(filePath, res) {
    const ext = path.extname(filePath);
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.json': 'application/json'
    };

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return res.end();
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // ===== API ROUTES =====
    if (url.pathname.startsWith('/api/')) {
        // GET /api/user/:id
        if (req.method === 'GET' && url.pathname.startsWith('/api/user/')) {
            const userId = url.pathname.split('/')[3];
            return handleGetUser(userId, res);
        }

        // POST /api/tap
        if (req.method === 'POST' && url.pathname === '/api/tap') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    return handleTap(JSON.parse(body), res);
                } catch {
                    return sendJSON(res, 400, { error: 'Invalid JSON' });
                }
            });
            return;
        }

        // GET /api/leaderboard
        if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
            return handleLeaderboard(res);
        }

        return sendJSON(res, 404, { error: 'Not found' });
    }

    // ===== STATIC FILES =====
    let filePath = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    serveStatic(filePath, res);
});

server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║          🪙 TapCoin Server 🪙            ║
╠══════════════════════════════════════════╣
║                                          ║
║  Server running on port ${PORT}             ║
║  http://localhost:${PORT}                   ║
║                                          ║
║  API endpoints:                          ║
║  GET  /api/user/:id                      ║
║  POST /api/tap                           ║
║  GET  /api/leaderboard                   ║
║                                          ║
╚══════════════════════════════════════════╝
    `);
});
