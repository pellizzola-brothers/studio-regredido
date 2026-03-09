const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// ── GRID CONSTRAINTS ─────────────────────
const MAX_COLS = 30;
const MAX_ROWS = 20;

const cols = MAX_COLS;
const rows = MAX_ROWS;

// ── TILE IDs ──────────────────────────────
//   0  = START marker (placeholder, will change later)
//   1  = TIJOLO (brick)
//   2  = LUCKY BLOCK
//   3  = END marker
//  99  = ERASER (internal tool, never written to the map)
const TILE_ID_START  =  0;
const TILE_ID_END    =  3;
const TILE_ID_ERASER = 99;

// Empty cells are null — distinct from tile ID 0 (START).
// When saving, null → "000".
const EMPTY = null;

// ── DYNAMIC CANVAS SIZING ─────────────────
let tileSize = 32;

function resizeCanvas(aw, ah) {
  tileSize = Math.floor(Math.min(aw / cols, ah / rows));
  if (tileSize < 1) tileSize = 1;
  canvas.width  = tileSize * cols;
  canvas.height = tileSize * rows;
  draw();
}

const ro = new ResizeObserver(entries => {
  for (const entry of entries) {
    const { width, height } = entry.contentRect;
    resizeCanvas(width, height);
  }
});
ro.observe(document.getElementById("canvas-area"));

let selectedTile = 1;
let isPainting   = false;

// ── MAPA ─────────────────────────────────
let map = Array.from({ length: rows }, () => Array(cols).fill(EMPTY));

let startPos = null;
let endPos   = null;

// ── CORES ────────────────────────────────
const TILE_COLORS = {
  0: { fill: "#00cc66", stroke: "#00ff88", label: "S" },  // start
  1: { fill: "#8b2b13", stroke: "#b84030"              },  // tijolo
  2: { fill: "#eecb04", stroke: "#ffd93d"              },  // lucky block
  3: { fill: "#cc1133", stroke: "#ff3355", label: "E" },  // end
};

// ── DESENHO ───────────────────────────────
function drawTile(x, y, id) {
  const px = x * tileSize;
  const py = y * tileSize;
  const c  = TILE_COLORS[id];
  if (!c) return;

  ctx.fillStyle = c.fill;
  ctx.fillRect(px, py, tileSize, tileSize);

  ctx.strokeStyle = c.stroke;
  ctx.lineWidth   = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);

  if (c.label) {
    ctx.fillStyle    = "rgba(0,0,0,0.45)";
    ctx.font         = `bold ${Math.max(8, Math.floor(tileSize * 0.35))}px 'Share Tech Mono', monospace`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(c.label, px + tileSize / 2, py + tileSize / 2);
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0d1015";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (map[y][x] !== EMPTY) drawTile(x, y, map[y][x]);

  ctx.strokeStyle = "#1e2530";
  ctx.lineWidth   = 1;
  for (let y = 0; y <= rows; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * tileSize); ctx.lineTo(canvas.width, y * tileSize); ctx.stroke();
  }
  for (let x = 0; x <= cols; x++) {
    ctx.beginPath(); ctx.moveTo(x * tileSize, 0); ctx.lineTo(x * tileSize, canvas.height); ctx.stroke();
  }
}

// ── LÓGICA DE PINTURA ─────────────────────
function paint(e) {
  const rect = canvas.getBoundingClientRect();
  const x    = Math.floor((e.clientX - rect.left) / tileSize);
  const y    = Math.floor((e.clientY - rect.top)  / tileSize);

  if (x < 0 || x >= cols || y < 0 || y >= rows) return;

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
}

// ── EVENTOS DE MOUSE ──────────────────────
canvas.addEventListener("mousedown", (e) => { isPainting = true; paint(e); });

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / tileSize);
  const y = Math.floor((e.clientY - rect.top)  / tileSize);
  document.getElementById("coords-display").textContent =
    (x >= 0 && x < cols && y >= 0 && y < rows) ? `X: ${x} | Y: ${y}` : "X: — | Y: —";
  if (isPainting) paint(e);
});

canvas.addEventListener("mouseup",    () => { isPainting = false; });
canvas.addEventListener("mouseleave", () => { isPainting = false; });

// ── SELEÇÃO DE SPRITE ─────────────────────
const spriteItems = document.querySelectorAll(".sprite-item");

spriteItems.forEach(sprite => {
  sprite.addEventListener("click", () => {
    selectedTile = parseInt(sprite.dataset.id);
    spriteItems.forEach(s => s.classList.remove("active"));
    sprite.classList.add("active");
  });
});

document.querySelector('.sprite-item[data-id="1"]').classList.add("active");

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
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (map[y][x] !== EMPTY) count++;
  stTiles.textContent = count;
}

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
      try {
        parsed = JSON.parse(reader.result);
      } catch {
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

      map      = Array.from({ length: rows }, () => Array(cols).fill(EMPTY));
      startPos = null;
      endPos   = null;

      data.forEach((entry, i) => {
        const x      = i % cols;
        const y      = Math.floor(i / cols);
        if (y >= rows) return;

        const cellId = parseInt(entry, 10);
        if (isNaN(cellId) || cellId === 0) return; // "000" = empty in file format

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

// ── SALVAR ────────────────────────────────
function formatDataArray(entries) {
  const GROUP_SIZE = 9;
  const lines = [];
  for (let i = 0; i < entries.length; i += GROUP_SIZE)
    lines.push(entries.slice(i, i + GROUP_SIZE).map(e => `"${e}"`).join(", "));
  return "[\n        " + lines.join(",\n        ") + "]";
}

document.getElementById("saveMap").addEventListener("click", () => {
  const entries = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      entries.push(String(map[y][x] === EMPTY ? 0 : map[y][x]).padStart(3, "0"));

  const formattedData    = formatDataArray(entries);
  const levelName        = document.getElementById("level-name").value        || "";
  const levelDescription = document.getElementById("level-description").value || "";
  const levelAuthor      = document.getElementById("level-author").value      || "";

  const json = `{
    "level": {
        "information": {
            "name": ${JSON.stringify(levelName)},
            "description": ${JSON.stringify(levelDescription)},
            "author": ${JSON.stringify(levelAuthor)}
        },
        "data": ${formattedData}
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

// ── LIMPAR ────────────────────────────────
document.getElementById("clearMap").addEventListener("click", () => {
  map      = Array.from({ length: rows }, () => Array(cols).fill(EMPTY));
  startPos = null;
  endPos   = null;
  draw();
  updateStatus();
});

// ── INIT ──────────────────────────────────
updateStatus();
