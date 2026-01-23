// app.js – DEMO AGROSOL (DEMO PRO FIXES: móvil + llaves + clicks)
let map;
let haciendaActual = null;

let haciendaLayer = L.layerGroup();
let lotesLayer = L.layerGroup();
let llavesLayer = L.layerGroup();
let trabajoLayer = L.featureGroup(); // zonas pintadas

let selectedLote = null;
let drawHandler = null;

// Guardamos unión por lote para área acumulada sin doble conteo
const workState = new Map(); // loteId -> Feature<Polygon|MultiPolygon>

let llavesVisibles = true;

// ===== UI refs (lote) =====
const elSelLote = document.getElementById("selLote");
const elAreaLote = document.getElementById("areaLote");
const elAreaTrab = document.getElementById("areaTrab");
const elPctTrab  = document.getElementById("pctTrab");

const btnAddWork = document.getElementById("btnAddWork");
const btnCancel  = document.getElementById("btnCancel");
const haciendaSelect = document.getElementById("haciendaSelect");

// ===== UI refs (llaves) =====
const btnToggleLlaves = document.getElementById("btnToggleLlaves");
const elLlaveCard = document.getElementById("llaveDetalle");
const elLlaveNombre = document.getElementById("llaveNombre");
const elLlaveTipo = document.getElementById("llaveTipo");
const elLlavePresion = document.getElementById("llavePresion");
const elLlaveEstado = document.getElementById("llaveEstado");
const elLlaveObs = document.getElementById("llaveObs");

init();

/* ================= INIT ================= */

function init(){
  initMap();
  initUI();
  loadHaciendas();
  setHacienda(DEMO_DATA.haciendas[0].id);
}

function initMap(){
  map = L.map("map", { preferCanvas:true });

  L.tileLayer(
    "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/{z}/{x}/{y}?access_token=pk.eyJ1Ijoia2V2YW1kZXIiLCJhIjoiY21rcHE4cWVvMGtzYzNkcHBlNjQ4cnEyeCJ9.qwAmvKeTPMwUxuYiVPxuhg",
    {
      tileSize: 512,
      zoomOffset: -1,
      attribution: "© Mapbox © OpenStreetMap"
    }
  ).addTo(map);

  map.options.maxZoom = 20;

  haciendaLayer.addTo(map);
  lotesLayer.addTo(map);
  trabajoLayer.addTo(map);
  llavesLayer.addTo(map);

  // UX: sin prefijo feo
  if(map.attributionControl) map.attributionControl.setPrefix("");
}

/* ================= UI ================= */

function initUI(){
  btnAddWork.onclick = startDrawWork;
  btnCancel.onclick = cancelDraw;
  haciendaSelect.onchange = e => setHacienda(e.target.value);

  if(btnToggleLlaves){
    btnToggleLlaves.onclick = () => {
      llavesVisibles = !llavesVisibles;
      if(llavesVisibles){
        llavesLayer.addTo(map);
        btnToggleLlaves.classList.add("active");
      }else{
        map.removeLayer(llavesLayer);
        btnToggleLlaves.classList.remove("active");
      }
    };

    // estado inicial
    if(llavesVisibles) btnToggleLlaves.classList.add("active");
  }
}

function loadHaciendas(){
  haciendaSelect.innerHTML = "";
  DEMO_DATA.haciendas.forEach(h=>{
    const o=document.createElement("option");
    o.value=h.id;
    o.textContent=h.nombre;
    haciendaSelect.appendChild(o);
  });
}

/* ================= HACIENDA ================= */

function setHacienda(id){
  haciendaActual = DEMO_DATA.haciendas.find(h=>h.id===id);
  haciendaSelect.value=id;

  // limpiar
  haciendaLayer.clearLayers();
  lotesLayer.clearLayers();
  trabajoLayer.clearLayers();
  llavesLayer.clearLayers();
  workState.clear();
  selectedLote = null;
  resetPanel();
  hideLlaveCard();

  // default view (por si no hay borde)
  map.setView([haciendaActual.center.lat, haciendaActual.center.lng], haciendaActual.zoom || 16);

  // BORDE HACIENDA + AJUSTE AUTOMÁTICO (clave para móvil)
  if(haciendaActual.haciendaBorder){
    const b = L.geoJSON(haciendaActual.haciendaBorder,{
      style:{ color:"#38bdf8", weight:4, fillOpacity:0 }
    }).addTo(haciendaLayer);

    map.fitBounds(b.getBounds(),{ padding:[20,20] });

    // Importantísimo para que en móvil no “cargue mal”
    setTimeout(()=> map.invalidateSize(true), 200);
  } else {
    setTimeout(()=> map.invalidateSize(true), 200);
  }

  // cargar lotes
  (haciendaActual.lotes || []).forEach(addLoteToMap);

  // cargar llaves (según toggle)
  (haciendaActual.llaves || []).forEach(addLlaveToMap);
  if(!llavesVisibles){
    try{ map.removeLayer(llavesLayer); }catch{}
    if(btnToggleLlaves) btnToggleLlaves.classList.remove("active");
  }else{
    llavesLayer.addTo(map);
    if(btnToggleLlaves) btnToggleLlaves.classList.add("active");
  }
}

/* ================= LOTES ================= */

function addLoteToMap(lote){
  const layer = L.geoJSON(lote.polygon,{
    style:{ color:"rgba(255,255,255,.75)", weight:2, fillOpacity:0 }
  });

  layer.on("click",()=> selectLote(lote, layer));
  layer.addTo(lotesLayer);
}

function selectLote(lote, layer){
  // ocultar detalle de llave cuando seleccionas un lote
  hideLlaveCard();

  lotesLayer.eachLayer(l=>{
    try{ l.setStyle({color:"rgba(255,255,255,.75)", weight:2}); }catch{}
  });

  try{ layer.setStyle({color:"rgba(125,211,252,.95)", weight:3}); }catch{}

  selectedLote = { id:lote.id, nombre:lote.nombre, feature:lote.polygon, layer };

  btnAddWork.disabled = false;
  updatePanel();
  showPopup();
}

/* ================= TRABAJO ================= */

function startDrawWork(){
  if(!selectedLote) return;

  btnAddWork.disabled = true;
  btnCancel.disabled = false;

  drawHandler = new L.Draw.Polygon(map, { allowIntersection:false });
  drawHandler.enable();

  map.once(L.Draw.Event.CREATED, e => {
    const drawn = e.layer.toGeoJSON();
    const clipped = safeIntersect(drawn, selectedLote.feature);

    if(!clipped){
      alert("Dibuja dentro del lote");
      cancelDraw();
      return;
    }

    // union por lote
    const prev = workState.get(selectedLote.id);
    let union = clipped;
    if(prev){
      try{ union = turf.union(prev, clipped); }catch{ union = prev; }
    }
    workState.set(selectedLote.id, union);

    // pintar SOLO lo recortado (lo que hizo el usuario)
    const pct = getPct(selectedLote.id);
    const painted = L.geoJSON(clipped, {
      // 🔥 CLAVE: que NO sea interactivo para que el click pase al lote debajo
      interactive: false,
      style:{
        fillColor: colorByPct(pct),
        fillOpacity: .45,
        color: "#fff",
        weight: 1
      }
    });

    painted.addTo(trabajoLayer);

    // traer bordes de lotes arriba para que se vean bien
    lotesLayer.bringToFront();

    updatePanel();
    showPopup();
    cancelDraw();
  });
}

function cancelDraw(){
  if(drawHandler){
    try{ drawHandler.disable(); }catch{}
  }
  drawHandler = null;
  btnCancel.disabled = true;
  btnAddWork.disabled = !selectedLote;
}

/* ================= LLAVES ================= */

// Icono SVG inline (siempre carga, no depende de internet)
function createValveIcon(){
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 48 48">
    <defs>
      <filter id="s" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,.55)"/>
      </filter>
    </defs>
    <g filter="url(#s)">
      <circle cx="24" cy="24" r="18" fill="rgba(125,211,252,.18)" stroke="rgba(125,211,252,.85)" stroke-width="2"/>
      <path d="M16 22h16v4H16z" fill="rgba(125,211,252,.95)"/>
      <circle cx="24" cy="24" r="6" fill="rgba(37,99,235,.95)"/>
      <path d="M24 12c4 0 8 2 10 5" fill="none" stroke="rgba(37,99,235,.95)" stroke-width="2" stroke-linecap="round"/>
    </g>
  </svg>`.trim();

  return L.divIcon({
    className: "valve-icon",
    html: svg,
    iconSize: [34,34],
    iconAnchor: [17,17],
    popupAnchor: [0,-16]
  });
}

function addLlaveToMap(llave){
  const icon = createValveIcon();

  const marker = L.marker([llave.lat, llave.lng], { icon });

  marker.on("click", () => {
    showLlaveDetalle(llave);

    // centra suavemente al tocar
    try{ map.panTo([llave.lat, llave.lng], { animate:true, duration:0.25 }); }catch{}
  });

  marker.bindTooltip(escapeHtml(llave.nombre), { direction:"top", offset:[0,-10], opacity:0.9 });

  marker.addTo(llavesLayer);
}

function showLlaveDetalle(llave){
  // NO tocar el panel de lote: usamos tarjeta dedicada
  if(elLlaveCard){
    elLlaveCard.style.display = "block";
    elLlaveNombre.textContent = llave.nombre || "—";
    elLlaveTipo.textContent = llave.tipo || "—";
    elLlavePresion.textContent = llave.presion || "—";
    elLlaveEstado.textContent = llave.estado || "—";
    elLlaveObs.textContent = llave.observacion || "—";
  }
}

function hideLlaveCard(){
  if(elLlaveCard) elLlaveCard.style.display = "none";
}

/* ================= UTIL (áreas / % / UI) ================= */

function safeIntersect(a,b){
  try{
    const r = turf.intersect(a,b);
    return r || null;
  }catch{
    return null;
  }
}

function sqmToHa(sqm){ return sqm / 10000; }

function getLoteAreaHa(){
  if(!selectedLote) return 0;
  try{ return sqmToHa(turf.area(selectedLote.feature)); }catch{ return 0; }
}

function getWorkedAreaHa(loteId){
  const feat = workState.get(loteId);
  if(!feat) return 0;
  try{ return sqmToHa(turf.area(feat)); }catch{ return 0; }
}

function getPct(loteId){
  if(!selectedLote) return 0;
  const loteA = getLoteAreaHa();
  if(loteA <= 0) return 0;
  const trabA = getWorkedAreaHa(loteId);
  return Math.max(0, Math.min(100, (trabA / loteA) * 100));
}

function colorByPct(p){
  if(p >= 99.5) return "#22c55e"; // verde
  if(p >= 50)   return "#eab308"; // amarillo
  return "#ef4444";               // rojo
}

function updatePanel(){
  if(!selectedLote) return;

  const loteHa = getLoteAreaHa();
  const trabHa = getWorkedAreaHa(selectedLote.id);
  const pct = getPct(selectedLote.id);

  elSelLote.textContent = selectedLote.nombre;
  elAreaLote.textContent = loteHa ? loteHa.toFixed(2) : "—";
  elAreaTrab.textContent = trabHa ? trabHa.toFixed(2) : "0.00";
  elPctTrab.textContent  = pct.toFixed(0) + "%";
}

function resetPanel(){
  elSelLote.textContent = "—";
  elAreaLote.textContent = "—";
  elAreaTrab.textContent = "—";
  elPctTrab.textContent  = "—";
}

function showPopup(){
  if(!selectedLote) return;

  const pct = getPct(selectedLote.id);
  const c = turf.centroid(selectedLote.feature).geometry.coordinates; // [lng,lat]

  L.popup()
    .setLatLng([c[1], c[0]])
    .setContent(`<b>${escapeHtml(selectedLote.nombre)}</b><br>${pct.toFixed(0)}% trabajado`)
    .openOn(map);
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[s]));
}
