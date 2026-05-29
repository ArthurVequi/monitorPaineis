// PanelMonitor Dashboard Frontend Lógica

// State variables
let panels = [];
let statuses = {}; // id -> 'online' | 'offline' | 'checking'
let isSlideshowActive = false;
let slideshowTimer = null;
let currentSlideshowIndex = 0;
let activeZoomPanelId = null;
let activeStreams = {}; // id -> boolean (true if loop is active)
let zoomStreamActive = false;

// DOM Elements
const gridContainer = document.getElementById('grid-container');
const gridLoading = document.getElementById('grid-loading');
const gridEmpty = document.getElementById('grid-empty');
const systemTimeEl = document.getElementById('system-time');
const totalBadge = document.querySelector('#stat-total .badge-value');
const onlineBadge = document.querySelector('#stat-online .badge-value');
const offlineBadge = document.querySelector('#stat-offline .badge-value');
const serverStatusVal = document.getElementById('server-status-val');
const searchInput = document.getElementById('search-input');
const columnSelect = document.getElementById('column-select');

// Modal Elements
const panelModal = document.getElementById('panel-modal');
const modalTitle = document.getElementById('modal-title');
const panelForm = document.getElementById('panel-form');
const panelIdInput = document.getElementById('panel-id');
const nameInput = document.getElementById('input-name');
const ipInput = document.getElementById('input-ip');
const portInput = document.getElementById('input-port');
const protocolSelect = document.getElementById('input-protocol');
const proxyCheckbox = document.getElementById('input-proxy');
const typeSelect = document.getElementById('input-type');
const proxyRow = document.getElementById('proxy-row');
const agentHelpRow = document.getElementById('agent-help-row');
const descInput = document.getElementById('input-description');
const cancelModalBtn = document.getElementById('cancel-modal-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const addPanelBtn = document.getElementById('add-panel-btn');

// Telegram Elements
const telegramModal = document.getElementById('telegram-modal');
const telegramForm = document.getElementById('telegram-form');
const telegramEnabledInput = document.getElementById('telegram-enabled');
const telegramTokenInput = document.getElementById('telegram-token');
const telegramChatidInput = document.getElementById('telegram-chatid');
const telegramRestoreInput = document.getElementById('telegram-restore');
const telegramConfigBtn = document.getElementById('telegram-config-btn');
const headerTelegramBtn = document.getElementById('header-telegram-btn');
const closeTelegramModalBtn = document.getElementById('close-telegram-modal-btn');
const cancelTelegramBtn = document.getElementById('cancel-telegram-btn');
const testTelegramBtn = document.getElementById('test-telegram-btn');
const discoverChatidBtn = document.getElementById('discover-chatid-btn');
const discoverChatidResults = document.getElementById('discover-chatid-results');
const errorTelegramToken = document.getElementById('error-telegram-token');
const errorTelegramChatid = document.getElementById('error-telegram-chatid');

// Zoom Elements
const zoomOverlay = document.getElementById('zoom-overlay');
const zoomPanelTitle = document.getElementById('zoom-panel-title');
const zoomPanelDesc = document.getElementById('zoom-panel-desc');
const zoomStatusBadge = document.getElementById('zoom-status-badge');
const zoomBody = document.getElementById('zoom-body');
const zoomCloseBtn = document.getElementById('zoom-close-btn');
const zoomRefreshBtn = document.getElementById('zoom-refresh-btn');
const zoomPrevBtn = document.getElementById('zoom-prev-btn');
const zoomNextBtn = document.getElementById('zoom-next-btn');

// Slideshow Elements
const slideshowToggleBtn = document.getElementById('slideshow-toggle-btn');
const slideshowIntervalInput = document.getElementById('slideshow-interval');

// Global Refresh
const globalRefreshBtn = document.getElementById('global-refresh-btn');

// Filters
const filterButtons = document.querySelectorAll('.filter-btn');
let currentFilter = 'all';

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    startClock();
    checkServerStatus();
    loadPanels();

    // Event Listeners
    addPanelBtn.addEventListener('click', () => openPanelModal());
    closeModalBtn.addEventListener('click', closePanelModal);
    cancelModalBtn.addEventListener('click', closePanelModal);
    panelForm.addEventListener('submit', handleFormSubmit);

    // Telegram Event Listeners
    if (telegramConfigBtn) telegramConfigBtn.addEventListener('click', () => openTelegramModal());
    if (headerTelegramBtn) headerTelegramBtn.addEventListener('click', () => openTelegramModal());
    if (closeTelegramModalBtn) closeTelegramModalBtn.addEventListener('click', closeTelegramModal);
    if (cancelTelegramBtn) cancelTelegramBtn.addEventListener('click', closeTelegramModal);
    if (telegramForm) telegramForm.addEventListener('submit', handleTelegramFormSubmit);
    if (testTelegramBtn) testTelegramBtn.addEventListener('click', testTelegramConnection);
    if (discoverChatidBtn) discoverChatidBtn.addEventListener('click', discoverTelegramChatId);

    // Search & Filter
    searchInput.addEventListener('input', filterPanels);
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.getAttribute('data-filter');
            filterPanels();
        });
    });

    // Grid Layout Adjuster
    columnSelect.addEventListener('change', (e) => {
        const cols = e.target.value;
        // Reset classes
        gridContainer.className = 'grid-container';
        if (cols === 'auto') {
            gridContainer.classList.add('grid-cols-auto');
        } else {
            gridContainer.classList.add(`grid-cols-${cols}`);
        }
    });

    // Zoom Controls
    zoomCloseBtn.addEventListener('click', closeZoomMode);
    zoomRefreshBtn.addEventListener('click', refreshZoomIframe);
    zoomPrevBtn.addEventListener('click', () => navigateZoom(-1));
    zoomNextBtn.addEventListener('click', () => navigateZoom(1));

    // Slideshow
    slideshowToggleBtn.addEventListener('click', toggleSlideshow);

    // Global Refresh
    globalRefreshBtn.addEventListener('click', () => {
        loadPanels(true);
    });

    // Panel Type Selector Trigger
    typeSelect.addEventListener('change', (e) => {
        const isStream = e.target.value === 'stream';
        if (isStream) {
            portInput.value = '5000';
            proxyRow.style.display = 'none';
            agentHelpRow.style.display = 'block';
        } else {
            portInput.value = '80';
            proxyRow.style.display = 'flex';
            agentHelpRow.style.display = 'none';
        }
    });

    // Periodic check status (Heartbeat) - every 30 seconds
    setInterval(updateAllStatuses, 30000);
});

// Real-time Clock
function startClock() {
    setInterval(() => {
        const now = new Date();
        systemTimeEl.textContent = now.toLocaleTimeString('pt-BR');
    }, 1000);
}

// Server Online Status
async function checkServerStatus() {
    try {
        const res = await fetch('/api/panels');
        if (res.ok) {
            serverStatusVal.textContent = 'Online';
            serverStatusVal.style.color = 'var(--accent-green)';
        }
    } catch {
        serverStatusVal.textContent = 'Erro Conexão';
        serverStatusVal.style.color = 'var(--accent-red)';
    }
}

// Load Panels from API
async function loadPanels(forceRefresh = false) {
    if (!forceRefresh) {
        gridLoading.style.display = 'flex';
        gridContainer.querySelectorAll('.painel-card').forEach(c => c.remove());
    }

    try {
        const res = await fetch('/api/panels');
        if (!res.ok) throw new Error('Falha ao obter dados');
        
        panels = await res.json();
        
        // Seed status as checking
        panels.forEach(p => {
            if (!statuses[p.id]) statuses[p.id] = 'checking';
        });

        renderGrid();
        updateAllStatuses(); // Get actual online/offline status
        
    } catch (err) {
        console.error('Erro ao carregar painéis:', err);
        gridLoading.style.display = 'none';
        gridEmpty.style.display = 'flex';
        gridEmpty.querySelector('h3').textContent = 'Erro ao conectar ao servidor';
    }
}

// Render the grid cards
function renderGrid() {
    gridLoading.style.display = 'none';
    
    // Remove old cards
    gridContainer.querySelectorAll('.painel-card').forEach(c => c.remove());

    if (panels.length === 0) {
        gridEmpty.style.display = 'flex';
        return;
    }
    
    gridEmpty.style.display = 'none';
    
    panels.forEach(panel => {
        const card = document.createElement('article');
        card.className = `painel-card card-checking`;
        card.id = `card-${panel.id}`;
        card.setAttribute('data-name', panel.name.toLowerCase());
        card.setAttribute('data-ip', panel.ip);
        card.setAttribute('data-id', panel.id);

        const isStream = panel.type === 'stream';
        const targetUrl = panel.useProxy 
            ? `/api/proxy/${panel.id}` 
            : (isStream ? `http://${panel.ip}:${panel.port}` : `${panel.protocol}://${panel.ip}:${panel.port}`);

        const embedHtml = isStream 
            ? `<img 
                id="img-${panel.id}"
                class="card-iframe"
                src="${targetUrl}"
                alt="Transmissão de Tela"
                style="width: 100%; height: 100%; object-fit: contain; background: #000;"
                loading="lazy">`
            : `<iframe 
                id="iframe-${panel.id}"
                class="card-iframe"
                src="${targetUrl}"
                loading="lazy">
               </iframe>`;

        card.innerHTML = `
            <div class="card-header">
                <div class="card-title-group">
                    <span class="card-status-dot status-checking" id="dot-${panel.id}"></span>
                    <div class="card-title-text">
                        <span class="card-name" title="${panel.name}">${panel.name}</span>
                        <span class="card-ip">${panel.ip}:${panel.port}${panel.useProxy ? ' (Proxy)' : ''}${isStream ? ' (Stream)' : ''}</span>
                    </div>
                </div>
                <div class="card-actions">
                    <button class="card-btn" onclick="refreshIframe('${panel.id}')" title="Recarregar painel">🔄</button>
                    <button class="card-btn" onclick="openZoomMode('${panel.id}')" title="Tela Cheia">🔍</button>
                    <button class="card-btn" onclick="openPanelModal('${panel.id}')" title="Editar">✏️</button>
                    <button class="card-btn btn-delete-card" onclick="deletePanel('${panel.id}', '${panel.name}')" title="Remover">❌</button>
                </div>
            </div>
            <div class="card-body" id="body-${panel.id}">
                <!-- Initial loading state -->
                <div class="card-overlay" id="overlay-${panel.id}">
                    <div class="spinner" style="width:24px; height:24px;"></div>
                    <span style="font-size:11px; color:var(--text-secondary);">Estabelecendo conexão...</span>
                </div>
                ${embedHtml}
            </div>
        `;

        gridContainer.appendChild(card);
    });

    filterPanels(); // Apply search/filter immediately
}

// Fetch all online statuses from backend
async function updateAllStatuses() {
    if (panels.length === 0) return;

    try {
        const res = await fetch('/api/panels/status');
        if (!res.ok) throw new Error();
        
        const results = await res.json();
        
        results.forEach(resObj => {
            updateCardStatus(resObj.id, resObj.status);
        });

        updateStatsCounters();
    } catch (err) {
        console.error('Falha ao atualizar status dos painéis:', err);
    }
}

// Update a single card status UI
function updateCardStatus(id, newStatus) {
    const oldStatus = statuses[id];
    statuses[id] = newStatus;

    const card = document.getElementById(`card-${id}`);
    const dot = document.getElementById(`dot-${id}`);
    const iframe = document.getElementById(`iframe-${id}`);
    const overlay = document.getElementById(`overlay-${id}`);
    const panel = panels.find(p => p.id === id);

    if (!card || !dot || !panel) return;

    // Update classes
    card.classList.remove('card-online', 'card-offline', 'card-checking');
    card.classList.add(`card-${newStatus}`);

    dot.className = 'card-status-dot';
    dot.classList.add(`status-${newStatus}`);

    // Hide the initial loading overlay once status is checked (whether online or offline)
    if (overlay) {
        overlay.style.display = 'none';
    }

    // Handle dynamic stream vs standard iframe updates
    if (panel.type === 'stream') {
        const img = document.getElementById(`img-${id}`);
        if (img) {
            if (newStatus === 'online') {
                img.style.display = 'block';
                startStreamLoop(id, img, panel);
            } else {
                stopStreamLoop(id);
                img.style.display = 'none'; // hide instead of clearing src to prevent broken image icon
            }
        }
    } else {
        // Ensure iframe is loaded with the correct URL
        if (iframe && (iframe.src === 'about:blank' || iframe.src === '')) {
            const iframeUrl = panel.useProxy 
                ? `/api/proxy/${panel.id}` 
                : `${panel.protocol}://${panel.ip}:${panel.port}`;
            iframe.src = iframeUrl;
        }
    }
}

// Update top statistics dashboard counters
function updateStatsCounters() {
    const total = panels.length;
    const online = Object.values(statuses).filter(s => s === 'online').length;
    const offline = Object.values(statuses).filter(s => s === 'offline').length;

    totalBadge.textContent = total;
    onlineBadge.textContent = online;
    offlineBadge.textContent = offline;
}

// Manual Retry Connection for offline card
async function retryConnection(id) {
    const dot = document.getElementById(`dot-${id}`);
    if (dot) {
        dot.className = 'card-status-dot status-checking';
    }

    const overlay = document.getElementById(`overlay-${id}`);
    if (overlay) {
        overlay.innerHTML = `
            <div class="spinner" style="width:24px; height:24px;"></div>
            <span style="font-size:11px; color:var(--text-secondary);">Verificando...</span>
        `;
    }

    try {
        const res = await fetch(`/api/panels/ping/${id}`);
        const data = await res.json();
        updateCardStatus(id, data.status);
        updateStatsCounters();
    } catch {
        updateCardStatus(id, 'offline');
    }
}

// Refresh individual Iframe / Stream
function refreshIframe(id) {
    const panel = panels.find(p => p.id === id);
    if (!panel) return;
    
    if (panel.type === 'stream') {
        const img = document.getElementById(`img-${id}`);
        if (img) {
            img.src = `http://${panel.ip}:${panel.port}/?t=${Date.now()}`;
        }
    } else {
        const iframe = document.getElementById(`iframe-${id}`);
        if (iframe) {
            const iframeUrl = panel.useProxy 
                ? `/api/proxy/${panel.id}?t=${Date.now()}` 
                : `${panel.protocol}://${panel.ip}:${panel.port}?t=${Date.now()}`;
            iframe.src = iframeUrl;
        }
    }
    retryConnection(id); // Run backend connection test in parallel
}

// Filter panels based on search & active filter category
function filterPanels() {
    const text = searchInput.value.toLowerCase();
    const cards = gridContainer.querySelectorAll('.painel-card');
    
    let visibleCount = 0;

    cards.forEach(card => {
        const id = card.getAttribute('data-id');
        const name = card.getAttribute('data-name');
        const ip = card.getAttribute('data-ip');
        const status = statuses[id] || 'checking';

        // Check text search matching
        const matchesSearch = name.includes(text) || ip.includes(text);
        
        // Check state filter matching
        let matchesFilter = true;
        if (currentFilter === 'online' && status !== 'online') matchesFilter = false;
        if (currentFilter === 'offline' && status !== 'offline') matchesFilter = false;

        if (matchesSearch && matchesFilter) {
            card.style.display = 'flex';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });

    if (visibleCount === 0 && panels.length > 0) {
        gridEmpty.style.display = 'flex';
        gridEmpty.querySelector('h3').textContent = 'Nenhum painel corresponde ao filtro';
        gridEmpty.querySelector('p').textContent = 'Tente alterar a pesquisa ou selecionar "Todos" no filtro.';
        gridEmpty.querySelector('button').style.display = 'none';
    } else if (panels.length > 0) {
        gridEmpty.style.display = 'none';
    }
}

// MODAL CRUD ACTIONS
function openPanelModal(id = null) {
    panelForm.reset();
    panelIdInput.value = '';
    
    // Clear validation error highlights
    nameInput.style.borderColor = '';
    ipInput.style.borderColor = '';
    document.getElementById('error-name').style.display = 'none';
    document.getElementById('error-ip').style.display = 'none';

    if (id) {
        // Edit mode
        const panel = panels.find(p => p.id === id);
        if (panel) {
            modalTitle.textContent = 'Editar Informações do Painel';
            panelIdInput.value = panel.id;
            nameInput.value = panel.name;
            ipInput.value = panel.ip;
            portInput.value = panel.port;
            protocolSelect.value = panel.protocol;
            proxyCheckbox.checked = panel.useProxy;
            typeSelect.value = panel.type || 'web';
            descInput.value = panel.description || '';
            
            // Dispatch typeSelect change to update visibility
            typeSelect.dispatchEvent(new Event('change'));
        }
    } else {
        // New mode
        modalTitle.textContent = 'Cadastrar Novo Painel';
        portInput.value = '80';
        protocolSelect.value = 'http';
        proxyCheckbox.checked = false;
        typeSelect.value = 'web';
        
        typeSelect.dispatchEvent(new Event('change'));
    }

    panelModal.classList.add('open');
    panelModal.setAttribute('aria-hidden', 'false');
    nameInput.focus();
}

function closePanelModal() {
    panelModal.classList.remove('open');
    panelModal.setAttribute('aria-hidden', 'true');
}

// Handle Add/Edit Panel Submit Form
async function handleFormSubmit(e) {
    e.preventDefault();

    const id = panelIdInput.value;
    const name = nameInput.value.trim();
    const ip = ipInput.value.trim();
    const port = parseInt(portInput.value);
    const protocol = protocolSelect.value;
    const useProxy = proxyCheckbox.checked;
    const type = typeSelect.value;
    const description = descInput.value.trim();

    // Basic Validation
    let isValid = true;
    if (!name) {
        nameInput.style.borderColor = 'var(--accent-red)';
        document.getElementById('error-name').style.display = 'block';
        isValid = false;
    } else {
        nameInput.style.borderColor = '';
        document.getElementById('error-name').style.display = 'none';
    }

    if (!ip) {
        ipInput.style.borderColor = 'var(--accent-red)';
        document.getElementById('error-ip').style.display = 'block';
        isValid = false;
    } else {
        ipInput.style.borderColor = '';
        document.getElementById('error-ip').style.display = 'none';
    }

    if (!isValid) return;

    const payload = { name, ip, port, protocol, useProxy, type, description };
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/panels/${id}` : '/api/panels';

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closePanelModal();
            loadPanels();
        } else {
            alert('Ocorreu um erro ao salvar o painel no servidor.');
        }
    } catch (err) {
        console.error('Erro na requisição:', err);
        alert('Erro ao se conectar ao servidor backend.');
    }
}

// Delete Panel Config
async function deletePanel(id, name) {
    if (confirm(`Tem certeza de que deseja remover o "${name}"?`)) {
        try {
            const res = await fetch(`/api/panels/${id}`, { method: 'DELETE' });
            if (res.ok) {
                loadPanels();
            } else {
                alert('Erro ao excluir painel.');
            }
        } catch (err) {
            console.error('Erro ao excluir:', err);
        }
    }
}

// ZOOM / FULL SCREEN PREVIEW MODE
function openZoomMode(id) {
    const panel = panels.find(p => p.id === id);
    if (!panel) return;

    activeZoomPanelId = id;
    
    // Set Header titles
    zoomPanelTitle.textContent = `${panel.name} - IP: ${panel.ip}`;
    zoomPanelDesc.textContent = panel.description || 'Sem descrição cadastrada';
    
    const status = statuses[id] || 'checking';
    zoomStatusBadge.className = 'zoom-status-badge';
    zoomStatusBadge.classList.add(status);
    zoomStatusBadge.textContent = `● ${status.toUpperCase()}`;

    // Inject iframe inside zoom container
    zoomBody.innerHTML = '';
    
    stopZoomStreamLoop();

    if (panel.type === 'stream') {
        const img = document.createElement('img');
        img.id = 'zoom-img';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.style.backgroundColor = '#000';
        img.src = `http://${panel.ip}:${panel.port}/?w=1280&t=${Date.now()}`;
        zoomBody.appendChild(img);
        
        startZoomStreamLoop(id, img, panel);
    } else {
        const iframe = document.createElement('iframe');
        iframe.id = 'zoom-iframe';
        iframe.src = panel.useProxy 
            ? `/api/proxy/${panel.id}` 
            : `${panel.protocol}://${panel.ip}:${panel.port}`;
        zoomBody.appendChild(iframe);
    }

    zoomOverlay.classList.add('open');
    zoomOverlay.setAttribute('aria-hidden', 'false');
    
    // Hide main scroll
    document.body.style.overflow = 'hidden';
}

function closeZoomMode() {
    zoomOverlay.classList.remove('open');
    zoomOverlay.setAttribute('aria-hidden', 'true');
    zoomBody.innerHTML = ''; // free up memory
    
    stopZoomStreamLoop();
    
    // Restore scroll
    document.body.style.overflow = '';
    
    // If slideshow is running and we close the overlay manually, stop slideshow
    if (isSlideshowActive) {
        stopSlideshow();
    }
}

async function retryZoomConnection(id) {
    zoomBody.innerHTML = `
        <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; color:var(--text-secondary);">
            <div class="spinner"></div>
            <span>Verificando conectividade com o dispositivo...</span>
        </div>
    `;

    try {
        const res = await fetch(`/api/panels/ping/${id}`);
        const data = await res.json();
        updateCardStatus(id, data.status);
        openZoomMode(id); // Reload zoom state
    } catch {
        openZoomMode(id);
    }
}

function refreshZoomIframe() {
    if (!activeZoomPanelId) return;
    const panel = panels.find(p => p.id === activeZoomPanelId);
    if (!panel) return;

    if (panel.type === 'stream') {
        const img = document.getElementById('zoom-img');
        if (img) {
            stopZoomStreamLoop();
            img.src = `http://${panel.ip}:${panel.port}/?w=1280&t=${Date.now()}`;
            startZoomStreamLoop(activeZoomPanelId, img, panel);
        }
    } else {
        const iframe = document.getElementById('zoom-iframe');
        if (iframe) {
            iframe.src = panel.useProxy 
                ? `/api/proxy/${panel.id}?t=${Date.now()}` 
                : `${panel.protocol}://${panel.ip}:${panel.port}?t=${Date.now()}`;
        }
    }
}

// Navigate zoom view (Next/Previous)
function navigateZoom(direction) {
    if (panels.length <= 1 || !activeZoomPanelId) return;

    // Find active index
    const index = panels.findIndex(p => p.id === activeZoomPanelId);
    let nextIndex = index + direction;

    if (nextIndex >= panels.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = panels.length - 1;

    openZoomMode(panels[nextIndex].id);
    
    if (isSlideshowActive) {
        currentSlideshowIndex = nextIndex;
        resetSlideshowTimer(); // Reset countdown timer when manually navigating
    }
}

// SLIDESHOW ROTATION ENGINE
function toggleSlideshow() {
    if (isSlideshowActive) {
        stopSlideshow();
    } else {
        startSlideshow();
    }
}

function startSlideshow() {
    if (panels.length === 0) return;
    
    isSlideshowActive = true;
    slideshowToggleBtn.classList.add('slideshow-active-mode');
    slideshowToggleBtn.innerHTML = `<span class="btn-icon">⏹️</span> Parar Slideshow`;
    
    currentSlideshowIndex = 0;
    openZoomMode(panels[currentSlideshowIndex].id);
    resetSlideshowTimer();
}

function stopSlideshow() {
    isSlideshowActive = false;
    slideshowToggleBtn.classList.remove('slideshow-active-mode');
    slideshowToggleBtn.innerHTML = `<span class="btn-icon">📺</span> Iniciar Slideshow`;
    
    if (slideshowTimer) {
        clearTimeout(slideshowTimer);
        slideshowTimer = null;
    }
    
    closeZoomMode();
}

function resetSlideshowTimer() {
    if (slideshowTimer) {
        clearTimeout(slideshowTimer);
    }

    const intervalSec = parseInt(slideshowIntervalInput.value) || 10;
    
    slideshowTimer = setTimeout(() => {
        if (!isSlideshowActive) return;
        currentSlideshowIndex++;
        if (currentSlideshowIndex >= panels.length) {
            currentSlideshowIndex = 0;
        }
        openZoomMode(panels[currentSlideshowIndex].id);
        resetSlideshowTimer();
    }, intervalSec * 1000);
}

// ==========================================
// STREAM LOOP ENGINE (OPTIMIZED FOR LATENCY)
// ==========================================

// Start the dynamic image streaming loop for a card in the grid
function startStreamLoop(id, img, panel) {
    if (activeStreams[id]) return;
    activeStreams[id] = true;

    function loadNext() {
        if (!activeStreams[id] || statuses[id] !== 'online') {
            activeStreams[id] = false;
            return;
        }

        // Dynamically calculate width based on card client width and device pixel ratio
        const width = img.clientWidth > 0 ? Math.ceil(img.clientWidth * (window.devicePixelRatio || 1)) : 800;
        const cooldown = 800; // 800ms cooldown for grid view to optimize bandwidth and CPU

        const nextSrc = `http://${panel.ip}:${panel.port}/?w=${width}&t=${Date.now()}`;
        const tempImg = new Image();

        tempImg.onload = () => {
            if (activeStreams[id]) {
                img.src = tempImg.src;
                setTimeout(loadNext, cooldown);
            }
        };

        tempImg.onerror = () => {
            if (activeStreams[id]) {
                setTimeout(loadNext, 2000); // retry after 2 seconds if error
            }
        };

        tempImg.src = nextSrc;
    }

    loadNext();
}

// Stop the streaming loop for a card in the grid
function stopStreamLoop(id) {
    activeStreams[id] = false;
}

// Start the high-priority dynamic image streaming loop for the zoom mode
function startZoomStreamLoop(id, img, panel) {
    zoomStreamActive = true;

    function loadNext() {
        if (!zoomStreamActive || activeZoomPanelId !== id || statuses[id] !== 'online') {
            zoomStreamActive = false;
            return;
        }

        // Dynamically calculate width based on viewport and device pixel ratio (capped at 2560px for performance)
        const width = Math.min(window.innerWidth > 0 ? Math.ceil(window.innerWidth * (window.devicePixelRatio || 1)) : 1920, 2560);
        const cooldown = 50; // 50ms cooldown for fluid streaming (near real-time)

        const nextSrc = `http://${panel.ip}:${panel.port}/?w=${width}&t=${Date.now()}`;
        const tempImg = new Image();

        tempImg.onload = () => {
            if (zoomStreamActive && activeZoomPanelId === id) {
                img.src = tempImg.src;
                setTimeout(loadNext, cooldown);
            }
        };

        tempImg.onerror = () => {
            if (zoomStreamActive && activeZoomPanelId === id) {
                setTimeout(loadNext, 1000); // retry after 1 second if error
            }
        };

        tempImg.src = nextSrc;
    }

    loadNext();
}

// Stop the zoom streaming loop
function stopZoomStreamLoop() {
    zoomStreamActive = false;
}

// ==========================================
// TELEGRAM NOTIFICATIONS CONFIGURATION
// ==========================================

async function openTelegramModal() {
    // Reset validation errors
    telegramTokenInput.style.borderColor = '';
    telegramChatidInput.style.borderColor = '';
    errorTelegramToken.style.display = 'none';
    errorTelegramChatid.style.display = 'none';
    
    // Reset discovery results
    if (discoverChatidResults) {
        discoverChatidResults.style.display = 'none';
        discoverChatidResults.innerHTML = '';
    }
    
    // Fetch current config
    try {
        const res = await fetch('/api/telegram/config');
        if (res.ok) {
            const config = await res.json();
            telegramEnabledInput.checked = config.enabled || false;
            telegramTokenInput.value = config.botToken || '';
            telegramChatidInput.value = config.chatId || '';
            telegramRestoreInput.checked = config.notifyOnRestore !== false; // default true
        }
    } catch (err) {
        console.error('Erro ao buscar configuração do Telegram:', err);
    }

    telegramModal.classList.add('open');
    telegramModal.setAttribute('aria-hidden', 'false');
}

function closeTelegramModal() {
    telegramModal.classList.remove('open');
    telegramModal.setAttribute('aria-hidden', 'true');
}

async function handleTelegramFormSubmit(e) {
    e.preventDefault();

    const enabled = telegramEnabledInput.checked;
    const botToken = telegramTokenInput.value.trim();
    const chatId = telegramChatidInput.value.trim();
    const notifyOnRestore = telegramRestoreInput.checked;

    // Validation
    let isValid = true;
    if (enabled) {
        if (!botToken) {
            telegramTokenInput.style.borderColor = 'var(--accent-red)';
            errorTelegramToken.style.display = 'block';
            isValid = false;
        } else {
            telegramTokenInput.style.borderColor = '';
            errorTelegramToken.style.display = 'none';
        }

        if (!chatId) {
            telegramChatidInput.style.borderColor = 'var(--accent-red)';
            errorTelegramChatid.style.display = 'block';
            isValid = false;
        } else {
            telegramChatidInput.style.borderColor = '';
            errorTelegramChatid.style.display = 'none';
        }
    }

    if (!isValid) return;

    try {
        const res = await fetch('/api/telegram/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, botToken, chatId, notifyOnRestore })
        });

        if (res.ok) {
            closeTelegramModal();
        } else {
            alert('Erro ao salvar configurações do Telegram.');
        }
    } catch (err) {
        console.error('Erro ao salvar:', err);
        alert('Erro ao conectar com o servidor.');
    }
}

async function testTelegramConnection() {
    const botToken = telegramTokenInput.value.trim();
    const chatId = telegramChatidInput.value.trim();

    if (!botToken || !chatId) {
        alert('Por favor, preencha o Token do Bot e o Chat ID para realizar o teste.');
        return;
    }

    // Temporary button state
    const originalText = testTelegramBtn.textContent;
    testTelegramBtn.textContent = 'Enviando...';
    testTelegramBtn.disabled = true;

    try {
        const res = await fetch('/api/telegram/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botToken, chatId })
        });

        const data = await res.json();
        if (res.ok) {
            alert('Mensagem de teste enviada com sucesso! Verifique seu Telegram.');
        } else {
            alert(`Falha no teste: ${data.error || 'Erro desconhecido'}`);
        }
    } catch (err) {
        console.error('Erro no teste:', err);
        alert('Erro ao conectar com o servidor para realizar o teste.');
    } finally {
        testTelegramBtn.textContent = originalText;
        testTelegramBtn.disabled = false;
    }
}

async function discoverTelegramChatId() {
    const botToken = telegramTokenInput.value.trim();
    if (!botToken) {
        alert('Por favor, preencha o Token do Bot primeiro.');
        return;
    }

    if (discoverChatidResults) {
        discoverChatidResults.style.display = 'block';
        discoverChatidResults.innerHTML = '<div style="display:flex; align-items:center; gap:8px; justify-content:center;"><div class="spinner" style="width:14px; height:14px;"></div><span>Consultando API do Telegram...</span></div>';
    }
    
    const originalText = discoverChatidBtn.textContent;
    discoverChatidBtn.textContent = 'Buscando...';
    discoverChatidBtn.disabled = true;

    try {
        const res = await fetch('/api/telegram/get-chat-id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botToken })
        });

        const data = await res.json();
        
        if (res.ok) {
            if (data.chats && data.chats.length > 0) {
                if (discoverChatidResults) {
                    discoverChatidResults.innerHTML = '<div style="margin-bottom: 6px; font-weight: bold; color: var(--accent-cyan); text-align: left;">Selecione o chat detectado:</div>';
                    data.chats.forEach(chat => {
                        const item = document.createElement('div');
                        item.className = 'discover-chat-item';
                        
                        const chatTypeLabel = chat.type === 'private' ? '👤 Usuário' : '👥 Grupo';
                        item.innerHTML = `
                            <div class="discover-chat-name" style="text-align: left;">${chat.name} <span style="font-size:10px; color:var(--text-secondary);">(${chatTypeLabel})</span></div>
                            <div class="discover-chat-id">${chat.chatId}</div>
                        `;
                        
                        item.addEventListener('click', () => {
                            telegramChatidInput.value = chat.chatId;
                            discoverChatidResults.style.display = 'none';
                        });
                        
                        discoverChatidResults.appendChild(item);
                    });
                }
            } else {
                if (discoverChatidResults) {
                    discoverChatidResults.innerHTML = '<span style="color:var(--accent-amber);">Nenhum chat detectado. Envie uma mensagem para o bot no Telegram primeiro.</span>';
                }
            }
        } else {
            if (discoverChatidResults) {
                discoverChatidResults.innerHTML = `<span style="color:var(--accent-red);">${data.error || 'Erro ao consultar Telegram.'}</span>`;
            }
        }
    } catch (err) {
        console.error('Erro ao descobrir Chat ID:', err);
        if (discoverChatidResults) {
            discoverChatidResults.innerHTML = '<span style="color:var(--accent-red);">Erro de conexão com o servidor.</span>';
        }
    } finally {
        discoverChatidBtn.textContent = originalText;
        discoverChatidBtn.disabled = false;
    }
}
