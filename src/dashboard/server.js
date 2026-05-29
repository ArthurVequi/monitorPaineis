const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const net = require('net');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'panels.json');
const TELEGRAM_FILE = path.join(__dirname, 'data', 'telegram.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to read panels from JSON
function readPanels() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return [];
    }
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading panels file:', err);
    return [];
  }
}

// Helper to write panels to JSON
function writePanels(panels) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(panels, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing panels file:', err);
    return false;
  }
}

// Helper to read Telegram config
function readTelegramConfig() {
  try {
    if (!fs.existsSync(TELEGRAM_FILE)) {
      return { enabled: false, botToken: '', chatId: '', notifyOnRestore: true };
    }
    const data = fs.readFileSync(TELEGRAM_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading telegram config:', err);
    return { enabled: false, botToken: '', chatId: '', notifyOnRestore: true };
  }
}

// Helper to write Telegram config
function writeTelegramConfig(config) {
  try {
    const dir = path.dirname(TELEGRAM_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TELEGRAM_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing telegram config:', err);
    return false;
  }
}

// Helper to send Telegram message using native https
function sendTelegramMessage(botToken, chatId, message) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseBody));
        } else {
          reject(new Error(`Telegram API responded with status ${res.statusCode}: ${responseBody}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

// HTTP Connection Checker (heartbeat)
const http = require('http');

function checkConnection(host, port, timeout = 2500) {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/`, { timeout }, (res) => {
      resolve('online');
      res.resume(); // consume response data to free up memory
    });

    req.on('error', () => {
      resolve('offline');
    });

    req.on('timeout', () => {
      req.destroy();
      resolve('offline');
    });
  });
}

// Background connection monitoring state
let lastPanelStatuses = {};
let isFirstCheck = true;

async function checkPanelsStatusBackground() {
  const telegramConfig = readTelegramConfig();
  if (!telegramConfig || !telegramConfig.enabled || !telegramConfig.botToken || !telegramConfig.chatId) {
    return; // telegram alerts disabled or unconfigured
  }

  const panels = readPanels();
  if (panels.length === 0) return;

  const statusPromises = panels.map(async (panel) => {
    const status = await checkConnection(panel.ip, panel.port);
    return { panel, status };
  });

  const results = await Promise.all(statusPromises);

  for (const { panel, status } of results) {
    const previousStatus = lastPanelStatuses[panel.id];

    if (!isFirstCheck && previousStatus && previousStatus !== status) {
      if (status === 'offline') {
        console.log(`[Alert] Panel ${panel.name} (${panel.ip}:${panel.port}) went offline! Sending Telegram notification.`);
        const message = `🔴 *CONEXÃO PERDIDA*\n\nO painel *${panel.name}* (${panel.ip}:${panel.port}) caiu e está *OFFLINE*.\n\n📅 _${new Date().toLocaleString('pt-BR')}_`;
        sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, message)
          .catch(err => console.error(`Failed to send Telegram alert:`, err.message));
      } else if (status === 'online' && telegramConfig.notifyOnRestore) {
        console.log(`[Alert] Panel ${panel.name} (${panel.ip}:${panel.port}) went online! Sending Telegram notification.`);
        const message = `🟢 *CONEXÃO RESTABELECIDA*\n\nO painel *${panel.name}* (${panel.ip}:${panel.port}) voltou a ficar *ONLINE*.\n\n📅 _${new Date().toLocaleString('pt-BR')}_`;
        sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, message)
          .catch(err => console.error(`Failed to send Telegram alert:`, err.message));
      }
    }

    lastPanelStatuses[panel.id] = status;
  }

  isFirstCheck = false;
}

// Start background loop (every 30 seconds)
setInterval(checkPanelsStatusBackground, 30000);

// REST API Endpoints

// Get all panels
app.get('/api/panels', (req, res) => {
  const panels = readPanels();
  res.json(panels);
});

// Add a new panel
app.post('/api/panels', (req, res) => {
  const panels = readPanels();
  const newPanel = {
    id: 'panel-' + Date.now(),
    name: req.body.name || 'Novo Painel',
    ip: req.body.ip || '127.0.0.1',
    port: parseInt(req.body.port) || 80,
    protocol: req.body.protocol || 'http',
    useProxy: req.body.useProxy === true,
    type: req.body.type || 'web',
    description: req.body.description || ''
  };

  panels.push(newPanel);
  writePanels(panels);
  res.status(201).json(newPanel);
});

// Update a panel
app.put('/api/panels/:id', (req, res) => {
  const panels = readPanels();
  const panelIndex = panels.findIndex(p => p.id === req.params.id);

  if (panelIndex === -1) {
    return res.status(404).json({ error: 'Panel not found' });
  }

  const updatedPanel = {
    ...panels[panelIndex],
    name: req.body.name || panels[panelIndex].name,
    ip: req.body.ip || panels[panelIndex].ip,
    port: parseInt(req.body.port) || panels[panelIndex].port,
    protocol: req.body.protocol || panels[panelIndex].protocol,
    useProxy: req.body.useProxy === true,
    type: req.body.type || panels[panelIndex].type || 'web',
    description: req.body.description || panels[panelIndex].description
  };

  panels[panelIndex] = updatedPanel;
  writePanels(panels);
  res.json(updatedPanel);
});

// Delete a panel
app.delete('/api/panels/:id', (req, res) => {
  const panels = readPanels();
  const filteredPanels = panels.filter(p => p.id !== req.params.id);

  if (panels.length === filteredPanels.length) {
    return res.status(404).json({ error: 'Panel not found' });
  }

  writePanels(filteredPanels);
  res.json({ success: true, message: 'Panel deleted successfully' });
});

// Check status of a single panel
app.get('/api/panels/ping/:id', async (req, res) => {
  const panels = readPanels();
  const panel = panels.find(p => p.id === req.params.id);

  if (!panel) {
    return res.status(404).json({ error: 'Panel not found' });
  }

  const status = await checkConnection(panel.ip, panel.port);
  res.json({ id: panel.id, status });
});

// Check status of all panels
app.get('/api/panels/status', async (req, res) => {
  const panels = readPanels();
  const statusPromises = panels.map(async (panel) => {
    const status = await checkConnection(panel.ip, panel.port);
    return { id: panel.id, status };
  });

  const results = await Promise.all(statusPromises);
  res.json(results);
});

// Smart Proxy Middleware
const handleProxy = async (req, res) => {
  const panelId = req.params.id;
  const panels = readPanels();
  const panel = panels.find(p => p.id === panelId);

  if (!panel) {
    return res.status(404).send('Panel config not found');
  }

  // Get the subpath (everything after /api/proxy/:id)
  // E.g., /api/proxy/panel-1/assets/style.css -> assets/style.css
  let subPath = req.params[0] || '';
  if (subPath.startsWith('/')) {
    subPath = subPath.substring(1);
  }

  const targetBase = `${panel.protocol}://${panel.ip}:${panel.port}`;
  const targetUrl = subPath ? `${targetBase}/${subPath}` : targetBase;

  // Forward query params
  const urlWithQuery = new URL(targetUrl);
  Object.keys(req.query).forEach(key => {
    urlWithQuery.searchParams.append(key, req.query[key]);
  });

  console.log(`[Proxy] Routing ${req.method} ${req.url} -> ${urlWithQuery.toString()}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout for requests

    // Set request headers
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.referer;
    delete headers.origin;

    const fetchOptions = {
      method: req.method,
      headers: headers,
      signal: controller.signal
    };

    // Include body for POST/PUT requests
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      if (typeof req.body === 'object') {
        fetchOptions.body = JSON.stringify(req.body);
        fetchOptions.headers['content-type'] = 'application/json';
      } else {
        fetchOptions.body = req.body;
      }
    }

    const response = await fetch(urlWithQuery.toString(), fetchOptions);
    clearTimeout(timeoutId);

    // Set response headers, skipping CSP and Iframe restriction headers
    const skipHeaders = [
      'x-frame-options',
      'content-security-policy',
      'content-security-policy-report-only',
      'cross-origin-opener-policy',
      'cross-origin-embedder-policy',
      'x-content-type-options'
    ];

    response.headers.forEach((value, name) => {
      if (!skipHeaders.includes(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    });

    // Enforce iframe-friendly headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    const contentType = response.headers.get('content-type') || '';

    // Handle HTML files by injecting the <base> tag
    if (contentType.includes('text/html')) {
      let html = await response.text();

      // Inject base tag so relative links resolve via the proxy path
      const baseTag = `<base href="/api/proxy/${panelId}/">`;
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${baseTag}`);
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', `<HEAD>${baseTag}`);
      } else {
        html = baseTag + html;
      }

      res.send(html);
    } else {
      // Pipe binary assets (images, scripts, fonts) directly
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.send(buffer);
    }
  } catch (err) {
    console.error(`[Proxy Error] Failed to fetch ${urlWithQuery.toString()}:`, err.message);
    res.status(502).send(`
      <html>
        <body style="background:#111; color:#ff4d4d; font-family:sans-serif; padding:20px; text-align:center;">
          <h3>Painel Inacessível</h3>
          <p>Não foi possível conectar ao IP <strong>${panel.ip}:${panel.port}</strong>.</p>
          <small>${err.message}</small>
        </body>
      </html>
    `);
  }
};

// Mount proxy handlers
app.all('/api/proxy/:id', handleProxy);
app.all('/api/proxy/:id/*', handleProxy);

// GET Telegram Config
app.get('/api/telegram/config', (req, res) => {
  const config = readTelegramConfig();
  // Mask the token for basic visual security on the client side
  const responseConfig = { ...config };
  if (responseConfig.botToken) {
    const parts = responseConfig.botToken.split(':');
    if (parts.length === 2) {
      const prefix = parts[0];
      const suffix = parts[1];
      const visibleSuffix = suffix.substring(suffix.length - 4);
      responseConfig.botToken = `${prefix}:••••••••••••••••••••••••${visibleSuffix}`;
    } else {
      responseConfig.botToken = '••••••••••••••••••••••••';
    }
  }
  res.json(responseConfig);
});

// POST Telegram Config
app.post('/api/telegram/config', (req, res) => {
  const currentConfig = readTelegramConfig();
  const newConfig = {
    enabled: req.body.enabled === true,
    botToken: req.body.botToken || '',
    chatId: req.body.chatId || '',
    notifyOnRestore: req.body.notifyOnRestore === true
  };

  // If the received token is masked (e.g. contains bullets or sequence of periods/asterisks), keep the current saved token
  if (newConfig.botToken.includes('•') || newConfig.botToken.includes('..') || newConfig.botToken.includes('**') || newConfig.botToken === '••••••••••••••••••••••••') {
    newConfig.botToken = currentConfig.botToken;
  }

  writeTelegramConfig(newConfig);
  res.json({ success: true, config: newConfig });
});

// POST Telegram Test Message
app.post('/api/telegram/test', async (req, res) => {
  const currentConfig = readTelegramConfig();
  let botToken = req.body.botToken || '';
  const chatId = req.body.chatId || '';

  // If token is masked, use the saved token
  if (botToken.includes('•') || botToken.includes('..') || botToken.includes('**') || botToken === '••••••••••••••••••••••••') {
    botToken = currentConfig.botToken;
  }

  if (!botToken || !chatId) {
    return res.status(400).json({ error: 'Token e Chat ID são obrigatórios para o teste.' });
  }

  try {
    const message = `🔔 *TESTE DE INTEGRAÇÃO*\n\nSeu robô de monitoramento do *PanelMonitor* foi configurado com sucesso e está pronto para enviar notificações!\n\n📅 _${new Date().toLocaleString('pt-BR')}_`;
    await sendTelegramMessage(botToken, chatId, message);
    res.json({ success: true, message: 'Mensagem de teste enviada com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: `Falha ao enviar mensagem de teste: ${err.message}` });
  }
});

// GET Chat ID - Discovers Chat ID from recent bot updates
app.post('/api/telegram/get-chat-id', async (req, res) => {
  const currentConfig = readTelegramConfig();
  let botToken = req.body.botToken || '';

  // If token is masked, use the saved token
  if (botToken.includes('•') || botToken.includes('..') || botToken.includes('**') || botToken === '••••••••••••••••••••••••') {
    botToken = currentConfig.botToken;
  }

  if (!botToken) {
    return res.status(400).json({ error: 'Token do bot é obrigatório.' });
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${botToken}/getUpdates?limit=10&timeout=0`,
        method: 'GET',
      };
      const req = https.request(options, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`Telegram API error ${response.statusCode}: ${body}`));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });

    if (!result.ok) {
      return res.status(400).json({ error: 'Telegram retornou erro. Verifique o token do bot.' });
    }

    if (!result.result || result.result.length === 0) {
      return res.status(404).json({
        error: 'Nenhuma mensagem encontrada. Envie uma mensagem para o bot no Telegram primeiro e tente novamente.'
      });
    }

    // Extract unique chats from updates
    const chats = [];
    const seenIds = new Set();
    for (const update of result.result) {
      const msg = update.message || update.edited_message || update.channel_post;
      if (msg && msg.chat && !seenIds.has(msg.chat.id)) {
        seenIds.add(msg.chat.id);
        chats.push({
          chatId: String(msg.chat.id),
          type: msg.chat.type,
          name: msg.chat.title || `${msg.chat.first_name || ''} ${msg.chat.last_name || ''}`.trim() || msg.chat.username || 'Desconhecido',
          username: msg.chat.username || null,
        });
      }
    }

    res.json({ success: true, chats });
  } catch (err) {
    res.status(500).json({ error: `Falha ao consultar o Telegram: ${err.message}` });
  }
});

// Serve Dashboard Frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`  PANEL MONITOR SERVER RUNNING ON PORT ${PORT}`);
  console.log(`  Access dashboard: http://localhost:${PORT}`);
  console.log(`===============================================`);
});
