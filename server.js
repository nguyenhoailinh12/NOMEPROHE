const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs').promises; // Sử dụng fs.promises cho async/await
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const port = 3000;

// Kích hoạt CORS và JSON parser
app.use(cors());
app.use(express.json());

// --- Security Metrics Middleware ---
const metricsWindowMs = 60_000; // 60s window
const state = {
  requests: [], // timestamps (ms)
  ipCounts: new Map(),
  statusCounts: new Map(),
  lastBackupTrigger: 0,
  disasterMode: false,
};

function pruneOld() {
  const cutoff = Date.now() - metricsWindowMs;
  // prune requests
  while (state.requests.length && state.requests[0] < cutoff) state.requests.shift();
  // prune ipCounts approximation: not precise timestamps per ip, keep as is for simplicity of 60s window
}
setInterval(pruneOld, 5_000);

app.use((req, res, next) => {
  const now = Date.now();
  state.requests.push(now);
  const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown').trim();
  state.ipCounts.set(ip, (state.ipCounts.get(ip) || 0) + 1);

  res.on('finish', () => {
    const code = res.statusCode;
    state.statusCounts.set(code, (state.statusCounts.get(code) || 0) + 1);
  });

  next();
});

// Helper to compute snapshot
function securitySnapshot() {
  pruneOld();
  const totalInWindow = state.requests.length;
  const rpm = Math.round((totalInWindow / (metricsWindowMs / 1000)) * 60);
  const uniqueIPs = state.ipCounts.size;
  const totalResponses = Array.from(state.statusCounts.values()).reduce((a,b)=>a+b,0) || 1;
  const errorResponses = Array.from(state.statusCounts.entries()).filter(([code]) => code >= 500).reduce((a, [,v])=>a+v, 0);
  const errorRate = errorResponses / totalResponses;

  const rpmWarn = 400, rpmCrit = 600;
  const errWarn = 0.10, errCrit = 0.20;
  let statusLevel = 'OK';
  if (rpm >= rpmCrit || errorRate >= errCrit) statusLevel = 'CRITICAL';
  else if (rpm >= rpmWarn || errorRate >= errWarn) statusLevel = 'WARNING';

  const topIPs = Array.from(state.ipCounts.entries())
    .sort((a,b) => b[1]-a[1])
    .slice(0, 5)
    .map(([ip, count]) => ({ ip, count }));

  const notes = [];
  if (statusLevel !== 'OK') {
    if (rpm >= rpmCrit) notes.push(`Lưu lượng cao (${rpm}/phút)`);
    if (errorRate >= errCrit) notes.push(`Tỉ lệ lỗi cao (${(errorRate*100).toFixed(1)}%)`);
  }

  return {
    since: new Date(Date.now() - metricsWindowMs).toISOString(),
    rpm, uniqueIPs, totalInWindow,
    errorRate,
    topIPs,
    statusLevel,
    disasterMode: state.disasterMode,
    notes,
  };
}

async function maybeTriggerBackup(snapshot, manual = false) {
  const webhook = process.env.CLOUD_BACKUP_WEBHOOK;
  const cooldownMs = 10 * 60 * 1000; // 10 minutes
  if (!webhook) return { triggered: false, reason: 'No webhook configured' };
  const now = Date.now();
  if (!manual && now - state.lastBackupTrigger < cooldownMs) {
    return { triggered: false, reason: 'Cooldown' };
  }
  try {
    const resp = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'backup',
        at: new Date().toISOString(),
        snapshot,
      })
    });
    state.lastBackupTrigger = now;
    state.disasterMode = true;
    return { triggered: true, status: resp.status };
  } catch (e) {
    return { triggered: false, error: String(e) };
  }
}

// Thư mục lưu tố cáo và nội dung meta (updates/events/items)
const dataDir = path.join(__dirname, 'data');
const reportsDir = path.join(__dirname, 'reports');

const chatUploadsDir = path.join(__dirname, 'uploads', 'chat');

const ensureDirs = async () => {
    for (const dir of [dataDir, reportsDir, chatUploadsDir]) {
        try { await fs.access(dir); } catch { await fs.mkdir(dir, { recursive: true }); }
    }
    for (const file of ['updates.json', 'events.json', 'items.json']) {
        const f = path.join(dataDir, file);
        try { await fs.access(f); } catch { await fs.writeFile(f, '[]'); }
    }
    const chatFile = path.join(dataDir, 'chat.json');
    try { await fs.access(chatFile); } catch { await fs.writeFile(chatFile, '[]'); }
};
ensureDirs();

// Phục vụ file tĩnh bằng chứng
app.use('/reports', express.static(reportsDir));
// Phục vụ media chat
app.use('/uploads/chat', express.static(chatUploadsDir));

// Multer cấu hình lưu file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const reportId = Date.now();
        const destinationDir = path.join(reportsDir, reportId.toString());
        req.reportId = reportId;
        req.destinationDir = destinationDir;
        cb(null, destinationDir);
    },
    filename: function (req, file, cb) {
        cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8'));
    }
});

const upload = multer({ storage: storage });

// Multer cho upload chat (ảnh/video)
const chatStorage = multer.diskStorage({
    destination: function(req, file, cb) { cb(null, chatUploadsDir); },
    filename: function(req, file, cb) {
        const ts = Date.now();
        const safe = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[^\w\.-]+/g, '_');
        cb(null, ts + '_' + safe);
    }
});
const allowedMimes = new Set(['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm']);
const chatUpload = multer({
    storage: chatStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (allowedMimes.has(file.mimetype)) cb(null, true); else cb(new Error('Loại file không được phép'));
    }
});

// Nhận đơn tố cáo
app.post('/report', upload.single('evidence'), async (req, res) => {
    const { reporter, reported, reason } = req.body;

    try {
        await fs.mkdir(req.destinationDir, { recursive: true });
        const reportContent = `Người tố cáo: ${reporter}\nNgười bị tố cáo: ${reported}\nLý do: ${reason}\n`;
        await fs.writeFile(path.join(req.destinationDir, 'report.txt'), reportContent);

        console.log(`Đã nhận và lưu tố cáo ${req.reportId}.`);
        res.status(200).json({ success: true, message: 'Gửi tố cáo thành công!', reportId: req.reportId });
    } catch (err) {
        console.error('Lỗi khi lưu tố cáo:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi lưu thông tin tố cáo.' });
    }
});

// Lấy danh sách tố cáo
app.get('/api/reports', async (req, res) => {
    try {
        const reportFolders = await fs.readdir(reportsDir);
        const reportsData = await Promise.all(
            reportFolders.map(async (folder) => {
                const reportPath = path.join(reportsDir, folder);
                const files = await fs.readdir(reportPath);
                
                const reportTxtFile = files.find(f => f === 'report.txt');
                const evidenceFile = files.find(f => f !== 'report.txt');

                let reportContent = {};
                if (reportTxtFile) {
                    const txtContent = await fs.readFile(path.join(reportPath, reportTxtFile), 'utf-8');
                    txtContent.split('\n').forEach(line => {
                        const [key, ...value] = line.split(': ');
                        if (key === 'Người tố cáo') reportContent.reporter = value.join(': ');
                        if (key === 'Người bị tố cáo') reportContent.reported = value.join(': ');
                        if (key === 'Lý do') reportContent.reason = value.join(': ');
                    });
                }
                
                return {
                    id: folder,
                    ...reportContent,
                    evidenceFile: evidenceFile || null,
                };
            })
        );
        res.status(200).json(reportsData);
    } catch (error) {
        console.error("Lỗi khi đọc danh sách tố cáo:", error);
        res.status(500).json({ success: false, message: 'Không thể đọc danh sách tố cáo.' });
    }
});

// API meta: updates/events/items (GET list + POST add)
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(dataDir, file), 'utf8'));
const writeJson = async (file, data) => fs.writeFile(path.join(dataDir, file), JSON.stringify(data, null, 2));

app.get('/api/updates', async (req, res) => {
    try { res.json(await readJson('updates.json')); } catch { res.json([]); }
});
app.post('/api/updates', async (req, res) => {
    try {
        const list = await readJson('updates.json');
        const item = { id: Date.now(), title: req.body.title, description: req.body.description, date: new Date().toISOString() };
        list.unshift(item);
        await writeJson('updates.json', list);
        res.json(item);
    } catch (e) { res.status(500).json({ error: 'Không lưu được cập nhật' }); }
});

app.get('/api/events', async (req, res) => {
    try { res.json(await readJson('events.json')); } catch { res.json([]); }
});
app.post('/api/events', async (req, res) => {
    try {
        const list = await readJson('events.json');
        const item = { id: Date.now(), title: req.body.title, description: req.body.description, date: new Date().toISOString() };
        list.unshift(item);
        await writeJson('events.json', list);
        res.json(item);
    } catch (e) { res.status(500).json({ error: 'Không lưu được sự kiện' }); }
});

app.get('/api/items', async (req, res) => {
    try { res.json(await readJson('items.json')); } catch { res.json([]); }
});
app.post('/api/items', async (req, res) => {
    try {
        const list = await readJson('items.json');
        const item = { id: Date.now(), title: req.body.title, description: req.body.description, date: new Date().toISOString() };
        list.unshift(item);
        await writeJson('items.json', list);
        res.json(item);
    } catch (e) { res.status(500).json({ error: 'Không lưu được vật phẩm' }); }
});

// Upload media cho chat
app.post('/api/chat/upload', chatUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Không có file' });
    const url = `/uploads/chat/${req.file.filename}`;
    const type = req.file.mimetype.startsWith('image/') ? 'image' : (req.file.mimetype.startsWith('video/') ? 'video' : 'file');
    res.json({ url, type });
});

// Proxy trạng thái (tuỳ chọn): /api/status?host=...&port=...
app.get('/api/status', async (req, res) => {
    try {
        const host = req.query.host || 'flash.ateex.cloud';
        const port = req.query.port || '18786';
        const resp = await fetch(`https://api.mcsrvstat.us/2/${host}:${port}`);
        const data = await resp.json();
        // Thêm trường tps giả (N/A)
        data.tps = null;
        res.json(data);
    } catch (e) {
        res.status(500).json({ online: false, error: 'Không lấy được trạng thái' });
    }
});

// --- Security APIs ---
app.get('/api/security/status', async (req, res) => {
  const snap = securitySnapshot();
  // Auto trigger when CRITICAL
  if (snap.statusLevel === 'CRITICAL') {
    await maybeTriggerBackup(snap, false);
  }
  res.json(snap);
});

app.post('/api/security/trigger-backup', async (req, res) => {
  const snap = securitySnapshot();
  const result = await maybeTriggerBackup(snap, true);
  res.json(result);
});

// --- Socket.IO Chat ---
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const CHAT_FILE = path.join(dataDir, 'chat.json');
const CHAT_LIMIT = 200;

async function loadChat() {
    try { return JSON.parse(await fs.readFile(CHAT_FILE, 'utf8')); } catch { return []; }
}
async function saveChat(list) {
    const trimmed = list.slice(-CHAT_LIMIT);
    await fs.writeFile(CHAT_FILE, JSON.stringify(trimmed, null, 2));
}

io.on('connection', async (socket) => {
    // Gửi lịch sử khi vừa vào
    const history = await loadChat();
    socket.emit('chat:history', history);

    // Throttle gửi tin
    socket.data.lastSentAt = 0;

    socket.on('chat:send', async (payload, ack) => {
        try {
            const now = Date.now();
            if (now - (socket.data.lastSentAt || 0) < 1200) {
                return ack && ack({ ok: false, error: 'Gửi quá nhanh, thử lại sau.' });
            }
            socket.data.lastSentAt = now;

            const author = String(payload?.author || '').trim().slice(0, 30) || 'Ẩn danh';
            const type = String(payload?.type || 'text');
            let content = '';
            if (type === 'text') {
                content = String(payload?.text || '').trim().slice(0, 300);
                if (!content) return ack && ack({ ok: false, error: 'Nội dung rỗng' });
            } else if (type === 'image' || type === 'video') {
                content = String(payload?.url || '');
                if (!content.startsWith('/uploads/chat/')) return ack && ack({ ok: false, error: 'URL không hợp lệ' });
            } else if (type === 'sticker') {
                content = String(payload?.url || '').trim();
                if (!content) return ack && ack({ ok: false, error: 'Sticker không hợp lệ' });
            } else {
                return ack && ack({ ok: false, error: 'Loại tin nhắn không hỗ trợ' });
            }

            const msg = { id: `${now}-${Math.random().toString(36).slice(2,7)}`, ts: now, author, type, content };
            const list = await loadChat();
            list.push(msg);
            await saveChat(list);
            io.emit('chat:new', msg);
            ack && ack({ ok: true });
        } catch (e) {
            ack && ack({ ok: false, error: 'Lỗi máy chủ' });
        }
    });
});

httpServer.listen(port, () => {
    console.log(`Máy chủ backend đang chạy tại http://localhost:${port}`);
    console.log(`Reports dir: ${reportsDir}`);
});
