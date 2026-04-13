const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// ── GRID ─────────────────────────────────
const COLS = 30;
const ROWS = 20;

// ── TILE IDs ──────────────────────────────
const TILE_ID_START  = 1;
const TILE_ID_END    = 4;
const TILE_ID_ERASER = 0;
const EMPTY          = null;

// ── STATE ─────────────────────────────────
let tileSize    = 24;
let map         = makeEmptyMap();
let startPos    = null;
let endPos      = null;
let selectedTile = 1;
let isPainting  = false;

// ── SPRITE PATHS ──────────────────────────
// Altere os caminhos abaixo para apontar para seus arquivos PNG.
const SPRITE_PATHS = {
  1: "textures/blocks/start_level.png",
  2: "textures/blocks/bricks.png",
  3: "textures/blocks/lucky_block.png",
  4: "textures/blocks/end_level.png",
  5: "textures/blocks/ice_excla_block.png",
};

const TILE_COLORS = {
  1: { fill: "#00471f", stroke: "#00e07a", label: "S" },
  2: { fill: "#6b2510", stroke: "#b84a30" },
  3: { fill: "#7a5800", stroke: "#e8b840" },
  4: { fill: "#5c0018", stroke: "#f03558", label: "E" },
  5: { fill: "#2a6080", stroke: "#7ecfef", label: "!" },
};

// ── SPRITES ───────────────────────────────
const sprites = {};
let spritesReady = 0;
const totalSprites = Object.keys(SPRITE_PATHS).length;

function loadSprites() {
  for (const [id, path] of Object.entries(SPRITE_PATHS)) {
    const img = new Image();
    img.src = path;
    img.addEventListener("load", () => {
      sprites[id] = img;
      spritesReady++;
      draw();
    });
    img.addEventListener("error", () => {
      console.warn(`[MapStudio] Sprite não encontrado: ${path} (tile id=${id}). Usando fallback.`);
      spritesReady++;
    });
  }
}

// ── MAP ───────────────────────────────────
function makeEmptyMap() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
}

// ── CANVAS SIZING ─────────────────────────
function sizeCanvas() {
  const area = document.getElementById("canvas-area");
  const aw = area.clientWidth  - 40;
  const ah = area.clientHeight - 60;
  tileSize = Math.max(12, Math.floor(Math.min(aw / COLS, ah / ROWS)));
  canvas.width  = tileSize * COLS;
  canvas.height = tileSize * ROWS;
  draw();
}

window.addEventListener("resize", sizeCanvas);

// ── DRAW ──────────────────────────────────
function drawTile(x, y, id) {
  const px  = x * tileSize;
  const py  = y * tileSize;
  const img = sprites[id];

  if (img) {
    ctx.drawImage(img, px, py, tileSize, tileSize);
  } else {
    const c = TILE_COLORS[id];
    if (!c) return;
    ctx.fillStyle = c.fill;
    ctx.fillRect(px, py, tileSize, tileSize);
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
    if (c.label && tileSize >= 16) {
      ctx.fillStyle    = c.stroke + "cc";
      ctx.font         = `bold ${Math.max(8, Math.floor(tileSize * 0.38))}px 'Share Tech Mono', monospace`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(c.label, px + tileSize / 2, py + tileSize / 2);
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#070911";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      if (map[y][x] !== EMPTY) drawTile(x, y, map[y][x]);

  ctx.strokeStyle = "#1a2030";
  ctx.lineWidth   = 1;
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * tileSize); ctx.lineTo(canvas.width, y * tileSize); ctx.stroke();
  }
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath(); ctx.moveTo(x * tileSize, 0); ctx.lineTo(x * tileSize, canvas.height); ctx.stroke();
  }
}

// ── PAINT ─────────────────────────────────
function paint(e) {
  const rect = canvas.getBoundingClientRect();
  const x    = Math.floor((e.clientX - rect.left) / tileSize);
  const y    = Math.floor((e.clientY - rect.top)  / tileSize);

  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;

  const current = map[y][x];

  if (selectedTile === TILE_ID_ERASER) {
    if (current === TILE_ID_START) startPos = null;
    if (current === TILE_ID_END)   endPos   = null;
    map[y][x] = EMPTY;
  } else if (selectedTile === TILE_ID_START) {
    if (startPos) map[startPos.y][startPos.x] = EMPTY;
    startPos  = { x, y };
    map[y][x] = TILE_ID_START;
  } else if (selectedTile === TILE_ID_END) {
    if (endPos) map[endPos.y][endPos.x] = EMPTY;
    endPos    = { x, y };
    map[y][x] = TILE_ID_END;
  } else {
    if (current === TILE_ID_START) startPos = null;
    if (current === TILE_ID_END)   endPos   = null;
    map[y][x] = selectedTile;
  }

  draw();
  updateStatus();
  // registra bloco como recente (ignora borracha)
  if (selectedTile !== TILE_ID_ERASER && map[y][x] !== EMPTY) addRecent(selectedTile);
}

// ── MOUSE EVENTS ──────────────────────────
canvas.addEventListener("mousedown", e => { isPainting = true; paint(e); });

canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / tileSize);
  const y = Math.floor((e.clientY - rect.top)  / tileSize);
  const txt = (x >= 0 && x < COLS && y >= 0 && y < ROWS) ? `X: ${x} | Y: ${y}` : "X: — | Y: —";
  document.getElementById("coords-display").textContent  = txt;
  document.getElementById("bottom-coords").textContent   = "CURSOR: " + txt;
  if (isPainting) paint(e);
});

canvas.addEventListener("mouseup",    () => { isPainting = false; });
canvas.addEventListener("mouseleave", () => { isPainting = false; });

// ── BLOCK REGISTRY ────────────────────────
// Adicione novos blocos aqui no futuro.
// Campos: id, name, desc, category, tags, previewStyle, previewLabel
const BLOCK_REGISTRY = [
  {
    id: 1,
    name: "START",
    desc: "Ponto inicial",
    category: "logica",
    tags: ["start", "inicio", "começo", "spawn"],
    previewStyle: "background:#00471f; border-color:#00e07a40;",
    previewLabel: { text: "S", color: "#00e07a" },
  },
  {
    id: 2,
    name: "Tijolo",
    desc: "Bloco sólido",
    category: "estrutura",
    tags: ["tijolo", "brick", "solido", "chao", "parede"],
    previewStyle: "background:#6b2510; border-color:#b84a3040;",
    previewLabel: null,
  },
  {
    id: 3,
    name: "Lucky Block",
    desc: "Bloco surpresa",
    category: "interacao",
    tags: ["lucky", "sorte", "surpresa", "item", "bonus"],
    previewStyle: "background:#7a5800; border-color:#e8b84040;",
    previewLabel: { text: "?", color: "#e8b840" },
  },
  {
    id: 4,
    name: "END",
    desc: "Ponto final",
    category: "logica",
    tags: ["end", "fim", "saida", "meta", "goal"],
    previewStyle: "background:#5c0018; border-color:#f0355540;",
    previewLabel: { text: "E", color: "#f03558" },
  },
  {
    id: 5,
    name: "Bloco de Gelo",
    desc: "Bloco de gelo com !",
    category: "interacao",
    tags: ["gelo", "ice", "frio", "exclamacao", "especial", "deslizante"],
    previewStyle: "background:#2a6080; border-color:#7ecfef40;",
    previewLabel: { text: "!", color: "#7ecfef" },
  },
];

// ── FAVORITES & RECENTS ───────────────────
let favorites = new Set();
let recents   = []; // array de ids, máx 8

function addRecent(id) {
  recents = [id, ...recents.filter(r => r !== id)].slice(0, 8);
}

// ── BLOCK FILTER STATE ────────────────────
let activeCategory = "todos";
let searchQuery    = "";

function getFilteredBlocks() {
  let pool = BLOCK_REGISTRY;

  if (activeCategory === "favoritos") {
    pool = pool.filter(b => favorites.has(b.id));
  } else if (activeCategory === "recentes") {
    const recentBlocks = recents
      .map(id => BLOCK_REGISTRY.find(b => b.id === id))
      .filter(Boolean);
    pool = recentBlocks;
  } else if (activeCategory !== "todos") {
    pool = pool.filter(b => b.category === activeCategory);
  }

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    pool = pool.filter(b =>
      b.name.toLowerCase().includes(q) ||
      b.tags.some(t => t.includes(q))
    );
  }

  return pool;
}

// ── RENDER BLOCK GRID ─────────────────────
function renderBlockGrid() {
  const grid   = document.getElementById("block-grid");
  const blocks = getFilteredBlocks();
  grid.innerHTML = "";

  if (blocks.length === 0) {
    grid.innerHTML = `<div class="block-empty">Nenhum bloco encontrado</div>`;
    return;
  }

  blocks.forEach(block => {
    const cell = document.createElement("div");
    cell.className = "block-cell" + (selectedTile === block.id ? " active" : "");
    cell.dataset.id = block.id;

    const preview = document.createElement("div");
    preview.className = "cell-preview";
    preview.style.cssText = block.previewStyle;

    // Se o sprite já estiver carregado, usa a imagem como preview
    if (sprites[block.id]) {
      const img = document.createElement("img");
      img.src = sprites[block.id].src;
      img.style.cssText = "width:100%; height:100%; object-fit:cover; border-radius:3px; display:block;";
      preview.innerHTML = "";
      preview.appendChild(img);
    } else if (block.previewLabel) {
      preview.innerHTML = `<span style="color:${block.previewLabel.color};">${block.previewLabel.text}</span>`;
    }

    const name = document.createElement("span");
    name.className = "cell-name";
    name.textContent = block.name;

    const favBtn = document.createElement("button");
    favBtn.className = "fav-btn" + (favorites.has(block.id) ? " fav-on" : "");
    favBtn.textContent = "★";
    favBtn.title = "Favoritar";

    favBtn.addEventListener("click", e => {
      e.stopPropagation();
      if (favorites.has(block.id)) favorites.delete(block.id);
      else favorites.add(block.id);
      renderBlockGrid();
    });

    cell.addEventListener("click", () => {
      selectedTile = block.id;
      // Desmarca eraser
      document.getElementById("eraser-item").classList.remove("active");
      renderBlockGrid();
    });

    cell.append(preview, name, favBtn);
    grid.appendChild(cell);
  });
}

// ── CATEGORY FILTER BUTTONS ───────────────
document.getElementById("cat-filters").addEventListener("click", e => {
  const btn = e.target.closest(".cat-btn");
  if (!btn) return;
  activeCategory = btn.dataset.cat;
  document.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderBlockGrid();
});

// ── SEARCH ────────────────────────────────
document.getElementById("block-search").addEventListener("input", e => {
  searchQuery = e.target.value;
  renderBlockGrid();
});

// ── ERASER (fora do grid, sempre visível) ──
document.getElementById("eraser-item").addEventListener("click", () => {
  selectedTile = TILE_ID_ERASER;
  document.getElementById("eraser-item").classList.add("active");
  renderBlockGrid(); // tira active dos outros
});

// ── STATUS ────────────────────────────────
function updateStatus() {
  const stStart = document.getElementById("st-start");
  const stEnd   = document.getElementById("st-end");
  const stTiles = document.getElementById("st-tiles");

  stStart.textContent = startPos ? "✓" : "✗";
  stStart.className   = `status-badge ${startPos ? "badge-on" : "badge-off"}`;
  stEnd.textContent   = endPos   ? "✓" : "✗";
  stEnd.className     = `status-badge ${endPos   ? "badge-on" : "badge-off"}`;

  let count = 0;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      if (map[y][x] !== EMPTY) count++;
  stTiles.textContent = count;
}

// ── MODAL LIMPAR ──────────────────────────
const modalOverlay = document.getElementById("modal-overlay");
const modalCancel  = document.getElementById("modal-cancel");
const modalConfirm = document.getElementById("modal-confirm");

document.getElementById("clearMap").addEventListener("click", () => {
  modalOverlay.classList.add("open");
});

modalCancel.addEventListener("click", () => {
  modalOverlay.classList.remove("open");
});

// Clique fora do modal fecha ele
modalOverlay.addEventListener("click", e => {
  if (e.target === modalOverlay) modalOverlay.classList.remove("open");
});

// Tecla Escape fecha o modal
document.addEventListener("keydown", e => {
  if (e.key === "Escape") modalOverlay.classList.remove("open");
});

modalConfirm.addEventListener("click", () => {
  map      = makeEmptyMap();
  startPos = null;
  endPos   = null;
  draw();
  updateStatus();
  modalOverlay.classList.remove("open");
});

// ── SALVAR JSON ───────────────────────────
function buildDataBlock(entries) {
  const GROUP  = 9;
  const indent = "        "; // 8 espaços
  const lines  = [];
  for (let i = 0; i < entries.length; i += GROUP)
    lines.push(indent + entries.slice(i, i + GROUP).map(e => `"${e}"`).join(", "));
  return "[\n" + lines.join(",\n") + "\n        ]";
}

document.getElementById("saveMap").addEventListener("click", () => {
  const entries = [];
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      entries.push(String(map[y][x] === EMPTY ? 0 : map[y][x]).padStart(3, "0"));

  const levelName        = document.getElementById("level-name").value        || "";
  const levelDescription = document.getElementById("level-description").value || "";
  const levelAuthor      = document.getElementById("level-author").value      || "";

  const json =
`{
    "level": {
        "information": {
            "name": ${JSON.stringify(levelName)},
            "description": ${JSON.stringify(levelDescription)},
            "author": ${JSON.stringify(levelAuthor)}
        },
        "data": ${buildDataBlock(entries)}
    }
}`;

  try { JSON.parse(json); } catch (err) {
    alert("Erro interno: JSON inválido. Veja o console.");
    console.error(err);
    return;
  }

  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${levelName || "map"}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── ABRIR JSON ────────────────────────────
document.getElementById("openMap").addEventListener("click", () => {
  const input  = document.createElement("input");
  input.type   = "file";
  input.accept = ".json,application/json";

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      let parsed;
      try { parsed = JSON.parse(reader.result); } catch {
        alert("Erro: arquivo JSON inválido.");
        return;
      }

      const info = parsed?.level?.information;
      const data = parsed?.level?.data;

      if (!Array.isArray(data)) {
        alert("Erro: formato de nível inválido (campo 'data' ausente ou incorreto).");
        return;
      }

      document.getElementById("level-name").value        = info?.name        ?? "";
      document.getElementById("level-description").value = info?.description ?? "";
      document.getElementById("level-author").value      = info?.author      ?? "";

      map      = makeEmptyMap();
      startPos = null;
      endPos   = null;

      data.forEach((entry, i) => {
        const x      = i % COLS;
        const y      = Math.floor(i / COLS);
        if (y >= ROWS) return;
        const cellId = parseInt(entry, 10);
        if (isNaN(cellId) || cellId === 0) return;
        map[y][x] = cellId;
        if (cellId === TILE_ID_START) startPos = { x, y };
        if (cellId === TILE_ID_END)   endPos   = { x, y };
      });

      draw();
      updateStatus();
    });
    reader.readAsText(file);
  });

  input.click();
});

// ── INIT ──────────────────────────────────
sizeCanvas();
updateStatus();
renderBlockGrid();
loadSprites();
