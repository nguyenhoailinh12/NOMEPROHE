document.addEventListener('DOMContentLoaded', () => {
    const serverIpInput = document.getElementById('server-ip');
    const checkStatusBtn = document.getElementById('check-status-btn');
    const serverStatusDiv = document.getElementById('server-status');
    const quickStats = document.getElementById('quick-stats');
    const playersList = document.getElementById('players-list');
    const noPlayers = document.getElementById('no-players');

    const updatesList = document.getElementById('updates-list');
    const eventsList = document.getElementById('events-list');
    const itemsList = document.getElementById('items-list');

    const secmonRoot = document.getElementById('secmon');
    const triggerBackupBtn = document.getElementById('trigger-backup');
    const copyIpBtn = document.getElementById('copy-ip-btn');

    // Chat elements
    const chatMessages = document.getElementById('chat-messages');
    const chatNick = document.getElementById('chat-nick');
    const chatText = document.getElementById('chat-text');
    const chatSend = document.getElementById('chat-send');
    const chatFile = document.getElementById('chat-file');
    const emojiBtn = document.getElementById('emoji-btn');
    const stickerBtn = document.getElementById('sticker-btn');
    const emojiPanel = document.getElementById('emoji-panel');
    const stickerPanel = document.getElementById('sticker-panel');

    let ioSocket = null;

    checkStatusBtn.addEventListener('click', () => { window.activateTab && window.activateTab('status'); checkServerStatus(); });
    serverIpInput.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            checkServerStatus();
        }
    });

    // Copy IP logic
    if (copyIpBtn) {
        copyIpBtn.addEventListener('click', async () => {
            const ip = serverIpInput.value;
            try {
                await navigator.clipboard.writeText(ip);
                const old = copyIpBtn.textContent;
                copyIpBtn.textContent = 'Đã sao chép';
                setTimeout(() => copyIpBtn.textContent = old, 1200);
            } catch (e) {
                const old = copyIpBtn.textContent;
                copyIpBtn.textContent = 'Lỗi sao chép';
                setTimeout(() => copyIpBtn.textContent = old, 1200);
            }
        });
    }

    // Tabs logic
    setupTabs();

    // Auto load
    checkServerStatus();
    loadMetaContent();
    pollSecurity();
    setupChat();

    // Poll status every 30s
    setInterval(checkServerStatus, 30000);
    // Poll security every 15s
    setInterval(pollSecurity, 15000);

    function setupTabs() {
        const tabs = Array.from(document.querySelectorAll('.tabs .tab'));
        const panels = Array.from(document.querySelectorAll('.tab-panel'));
        function activate(target) {
            tabs.forEach(t => t.classList.toggle('active', t.dataset.tabTarget === target));
            panels.forEach(p => p.classList.toggle('active', p.dataset.tab === target));
        }
        tabs.forEach(tab => tab.addEventListener('click', () => activate(tab.dataset.tabTarget)));
        // Expose for other triggers
        window.activateTab = activate;
    }

    function parseHostPort(input) {
        const [host, portStr] = input.split(':');
        return { host, port: portStr ? Number(portStr) : 25565 };
    }

    async function checkServerStatus() {
        const serverIp = serverIpInput.value.trim();
        if (!serverIp) {
            serverStatusDiv.innerHTML = '<p>Vui lòng nhập một địa chỉ IP máy chủ.</p>';
            return;
        }

        serverStatusDiv.innerHTML = '<p>Đang tải...</p>';

        try {
            // Using public API; can be swapped to your backend /api/status later
            const res = await fetch(`https://api.mcsrvstat.us/2/${serverIp}`);
            const data = await res.json();

            if (!data || data.online === false) {
                displayOfflineStatus();
                return;
            }

            displayOnlineStatus(data);
            renderPlayers(data.players);
        } catch (err) {
            console.error('Lỗi khi lấy dữ liệu:', err);
            serverStatusDiv.innerHTML = `<p>Đã xảy ra lỗi. Không thể kết nối tới máy chủ API.</p>`;
        }
    }

    function displayOnlineStatus(data) {
        const motd = (data.motd && data.motd.html) ? data.motd.html.join('<br>') : '';
        const players = data.players || { online: 0, max: 0 };
        const version = data.version || 'Không rõ';

        // TPS: not available from this API; show N/A
        updateQuickStats({ online: true, tps: null });

        serverStatusDiv.innerHTML = `
            <p><strong>Trạng thái:</strong> <span class="status-online">Online</span></p>
            <p><strong>Phiên bản:</strong> ${version}</p>
            <p><strong>Người chơi:</strong> ${players.online} / ${players.max}</p>
            <p><strong>MOTD:</strong></p>
            <div>${motd || 'Không có'}</div>
        `;
    }

    function displayOfflineStatus() {
        updateQuickStats({ online: false, tps: null });
        serverStatusDiv.innerHTML = `<p><strong>Trạng thái:</strong> <span class="status-offline">Offline</span></p>`;
        playersList.innerHTML = '';
        noPlayers.style.display = 'block';
    }

    function updateQuickStats({ online, tps }) {
        const statusText = online ? 'Online' : 'Offline';
        const tpsText = tps == null ? 'TPS: N/A' : `TPS: ${tps}`;
        quickStats.innerHTML = `
            <span class="badge">Trạng thái: ${statusText}</span>
            <span class="badge">${tpsText}</span>
        `;
    }

    function renderPlayers(players) {
        const online = players?.online || 0;
        const sample = players?.list || players?.sample || [];
        playersList.innerHTML = '';
        if (!online || sample.length === 0) {
            noPlayers.style.display = 'block';
            return;
        }
        noPlayers.style.display = 'none';

        // sample can contain names as strings or {name, id}
        const normalized = sample.map(p => typeof p === 'string' ? { name: p } : p);
        normalized.forEach(p => {
            const name = p.name || p?.name_raw || 'Người chơi';
            const uuid = p.id || p.uuid || '';
            const avatar = uuid ? `https://crafthead.net/avatar/${uuid}/24` : `https://mc-heads.net/avatar/${encodeURIComponent(name)}/24`;
            const li = document.createElement('li');
            li.innerHTML = `<img src="${avatar}" alt="${name}" /> <span>${name}</span>`;
            playersList.appendChild(li);
        });
    }

    async function loadMetaContent() {
        try {
            const [updates, events, items] = await Promise.all([
                fetch('http://localhost:3000/api/updates').then(r => r.ok ? r.json() : []),
                fetch('http://localhost:3000/api/events').then(r => r.ok ? r.json() : []),
                fetch('http://localhost:3000/api/items').then(r => r.ok ? r.json() : [])
            ]);
            renderList(updatesList, updates, 'Chưa có cập nhật.');
            renderList(eventsList, events, 'Chưa có sự kiện.');
            renderList(itemsList, items, 'Chưa có vật phẩm.');
        } catch (e) {
            console.warn('Không tải được meta content, có thể backend chưa chạy.');
        }
    }

    function escapeHtml(s) {
        return s.replace(/[&<>"]|'/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
    }

    function renderChatMessage(msg) {
        const wrap = document.createElement('div');
        wrap.className = 'message';
        const metaDate = new Date(msg.ts).toLocaleTimeString('vi-VN');
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `${msg.author} • ${metaDate}`;
        wrap.appendChild(meta);
        const body = document.createElement('div');
        body.className = 'text';
        if (msg.type === 'text') {
            body.innerHTML = escapeHtml(msg.content);
        } else if (msg.type === 'image') {
            body.innerHTML = `<img src="${msg.content}" alt="image"/>`;
        } else if (msg.type === 'video') {
            body.innerHTML = `<video controls src="${msg.content}"></video>`;
        } else if (msg.type === 'sticker') {
            body.innerHTML = `<img src="${msg.content}" alt="sticker"/>`;
        }
        wrap.appendChild(body);
        chatMessages.appendChild(wrap);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function renderList(root, items, emptyText) {
        root.innerHTML = '';
        if (!items || items.length === 0) {
            root.innerHTML = `<div class="muted">${emptyText}</div>`;
            return;
        }
        items.forEach(it => {
            const div = document.createElement('div');
            div.className = 'item';
            const date = it.date ? new Date(it.date).toLocaleString('vi-VN') : '';
            div.innerHTML = `
                <div><strong>${it.title || 'Không tiêu đề'}</strong></div>
                ${it.description ? `<div class="muted">${it.description}</div>` : ''}
                ${date ? `<div class="small muted">${date}</div>` : ''}
            `;
            root.appendChild(div);
        });
    }

    // --- Chat Client ---
    function setupChat() {
        if (!window.io) return; // socket.io client not loaded yet
        ioSocket = io('http://localhost:3000');
        const savedNick = localStorage.getItem('chat_nick');
        if (savedNick) chatNick.value = savedNick;

        ioSocket.on('connect', () => {
            // ready
        });
        ioSocket.on('chat:history', (list) => {
            chatMessages.innerHTML = '';
            list.forEach(renderChatMessage);
        });
        ioSocket.on('chat:new', (msg) => {
            renderChatMessage(msg);
        });

        chatSend.addEventListener('click', sendTextMessage);
        chatText.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
        });
        chatFile.addEventListener('change', uploadMedia);

        // Emoji panel (simple preset)
        const emojis = ['😀','😁','😂','🤣','😅','😊','😍','😎','🤩','😘','🤔','😴','😢','😡','👍','👎','🙏','💖','🔥','✨','🎉','🎮'];
        emojiPanel.innerHTML = '';
        emojis.forEach(em => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = em;
            b.addEventListener('click', () => insertAtCursor(chatText, em));
            emojiPanel.appendChild(b);
        });
        emojiBtn.addEventListener('click', () => {
            emojiPanel.hidden = !emojiPanel.hidden;
            stickerPanel.hidden = true;
        });

        // Sticker panel (static URLs, you can replace with your own)
        const stickers = [
            'https://media.tenor.com/9Jiw-1y7xVYAAAAi/minecraft-dance.gif',
            'https://media.tenor.com/6i9gSP-LcFIAAAAi/minecraft.gif',
            'https://i.imgur.com/0Z8aQ0P.png'
        ];
        stickerPanel.innerHTML = '';
        stickers.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.addEventListener('click', () => sendSticker(url));
            stickerPanel.appendChild(img);
        });
        stickerBtn.addEventListener('click', () => {
            stickerPanel.hidden = !stickerPanel.hidden;
            emojiPanel.hidden = true;
        });
    }

    function insertAtCursor(el, text) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const val = el.value;
        el.value = val.slice(0, start) + text + val.slice(end);
        el.selectionStart = el.selectionEnd = start + text.length;
        el.focus();
    }

    function getNick() {
        const nick = (chatNick.value || '').trim() || 'Ẩn danh';
        localStorage.setItem('chat_nick', nick);
        return nick;
    }

    function sendTextMessage() {
        const text = (chatText.value || '').trim();
        if (!text) return;
        const author = getNick();
        ioSocket.emit('chat:send', { type: 'text', text, author }, (resp) => {
            if (resp?.ok) chatText.value = '';
        });
    }

    async function uploadMedia() {
        const file = chatFile.files[0];
        if (!file) return;
        try {
            const form = new FormData();
            form.append('file', file);
            const res = await fetch('http://localhost:3000/api/chat/upload', { method: 'POST', body: form });
            const data = await res.json();
            if (data.url && (data.type === 'image' || data.type === 'video')) {
                const author = getNick();
                ioSocket.emit('chat:send', { type: data.type, url: data.url, author });
            }
        } catch (e) {
            // ignore
        } finally {
            chatFile.value = '';
        }
    }

    function sendSticker(url) {
        const author = getNick();
        ioSocket.emit('chat:send', { type: 'sticker', url, author });
    }

    // --- Security Monitor ---
    async function pollSecurity() {
        try {
            const res = await fetch('http://localhost:3000/api/security/status');
            const snap = await res.json();
            renderSecurity(snap);
        } catch (e) {
            secmonRoot.innerHTML = '<div class="muted">Không lấy được dữ liệu an ninh (backend chưa chạy?).</div>';
        }
    }

    function renderSecurity(snap) {
        const levelColor = snap.statusLevel === 'CRITICAL' ? '#ff6b6b' : (snap.statusLevel === 'WARNING' ? '#ffd166' : '#3ddc97');
        const topIPsHtml = (snap.topIPs || []).map(ip => `<li><code>${ip.ip}</code> — <strong>${ip.count}</strong> req</li>`).join('') || '<li class="muted">Không có</li>';
        secmonRoot.innerHTML = `
            <div style="display:grid;gap:8px;">
                <div>Since: <span class="muted">${new Date(snap.since).toLocaleString('vi-VN')}</span></div>
                <div>Requests/min: <strong>${snap.rpm}</strong> • Unique IPs: <strong>${snap.uniqueIPs}</strong></div>
                <div>Error rate: <strong>${(snap.errorRate*100).toFixed(2)}%</strong></div>
                <div>Trạng thái: <strong style="color:${levelColor}">${snap.statusLevel}</strong> ${snap.disasterMode ? '• Disaster Mode' : ''}</div>
                <div>
                    <div class="small muted">Top IPs (60s):</div>
                    <ul style="margin:4px 0 0 16px;">${topIPsHtml}</ul>
                </div>
                ${snap.notes?.length ? `<div class="small muted">${snap.notes.join(' | ')}</div>` : ''}
            </div>
        `;

        if (triggerBackupBtn) {
            triggerBackupBtn.disabled = snap.statusLevel !== 'CRITICAL';
            triggerBackupBtn.title = snap.statusLevel === 'CRITICAL' ? '' : 'Chỉ khả dụng khi trạng thái CRITICAL';
        }
    }

    if (triggerBackupBtn) {
        triggerBackupBtn.addEventListener('click', async () => {
            triggerBackupBtn.disabled = true;
            triggerBackupBtn.textContent = 'Đang kích hoạt...';
            try {
                const res = await fetch('http://localhost:3000/api/security/trigger-backup', { method: 'POST' });
                const data = await res.json();
                alert(data.triggered ? 'Đã gửi tín hiệu backup lên cloud' : `Không kích hoạt được: ${data.reason || data.error || 'Lỗi không xác định'}`);
            } catch (e) {
                alert('Không gọi được API backup');
            } finally {
                triggerBackupBtn.textContent = 'Kích hoạt backup';
                pollSecurity();
            }
        });
    }

    // --- Report Form Logic ---
    const reportForm = document.getElementById('report-form');
    const reportStatusDiv = document.getElementById('report-status');
    const submitReportBtn = document.getElementById('submit-report-btn');

    reportForm.addEventListener('submit', function(event) {
        event.preventDefault();

        submitReportBtn.disabled = true;
        submitReportBtn.textContent = 'Đang gửi...';
        reportStatusDiv.className = '';
        reportStatusDiv.style.display = 'none';

        const formData = new FormData(reportForm);

        fetch('http://localhost:3000/report', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                reportStatusDiv.textContent = `Tố cáo đã được gửi thành công! (Mã tố cáo: ${data.reportId})`;
                reportStatusDiv.className = 'success';
                reportForm.reset();
            } else {
                reportStatusDiv.textContent = `Lỗi: ${data.message || 'Không thể gửi tố cáo.'}`;
                reportStatusDiv.className = 'error';
            }
        })
        .catch(error => {
            console.error('Lỗi khi gửi form:', error);
            reportStatusDiv.textContent = 'Lỗi kết nối. Bạn đã chạy máy chủ xử lý (server.js) chưa?';
            reportStatusDiv.className = 'error';
        })
        .finally(() => {
            reportStatusDiv.style.display = 'block';
            submitReportBtn.disabled = false;
            submitReportBtn.textContent = 'Gửi';
        });
    });
});
