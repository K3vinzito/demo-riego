// app.js
let map;
let haciendaActual = null;

let lotesLayer = L.layerGroup();
let llavesLayer = L.layerGroup();
let trabajoLayer = L.featureGroup(); // aquí quedan las zonas trabajadas

let selectedLote = null; // {id, nombre, feature, leafletLayer}
let drawControl = null;
let drawHandler = null;

// Guardamos por lote: union de polígonos trabajados
const workState = new Map(); // loteId -> { unionFeature: GeoJSON Feature<Polygon|MultiPolygon>, areaHa: number }

const elSelLote = document.getElementById("selLote");
const elAreaLote = document.getElementById("areaLote");
const elAreaTrab = document.getElementById("areaTrab");
const elPctTrab  = document.getElementById("pctTrab");

const btnAddWork = document.getElementById("btnAddWork");
const btnCancel  = document.getElementById("btnCancel");
const haciendaSelect = document.getElementById("haciendaSelect");

init();

function init(){
  initMap();
  initUI();
  loadHaciendas();
  setHacienda(window.DEMO_DATA.haciendas[0].id);
}

function initMap(){
  map = L.map('map', {
    zoomControl: true,
    preferCanvas: true
  });

  // Satelital (Esri World Imagery)
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles © Esri"
    }
  ).addTo(map);

  lotesLayer.addTo(map);
  llavesLayer.addTo(map);
  trabajoLayer.addTo(map);

  // Un look más “pro”
  map.attributionControl.setPrefix("");
}

function initUI(){
  btnAddWork.addEventListener("click", startDrawWork);
  btnCancel.addEventListener("click", cancelDraw);

  haciendaSelect.addEventListener("change", (e) => {
    setHacienda(e.target.value);
  });
}

function loadHaciendas(){
  haciendaSelect.innerHTML = "";
  for(const h of window.DEMO_DATA.haciendas){
    const opt = document.createElement("option");
    opt.value = h.id;
    opt.textContent = h.nombre;
    haciendaSelect.appendChild(opt);
  }
}

function setHacienda(haciendaId){
  haciendaActual = window.DEMO_DATA.haciendas.find(h => h.id === haciendaId);
  haciendaSelect.value = haciendaId;

  // limpiar capas
  lotesLayer.clearLayers();
  llavesLayer.clearLayers();
  trabajoLayer.clearLayers();
  selectedLote = null;
  btnAddWork.disabled = true;
  btnCancel.disabled = true;
  resetPanel();

  // centrar mapa
  map.setView([haciendaActual.center.lat, haciendaActual.center.lng], haciendaActual.zoom);

  // cargar lotes
  (haciendaActual.lotes || []).forEach(l => addLoteToMap(l));

  // cargar llaves
  (haciendaActual.llaves || []).forEach(k => addLlaveToMap(k));
}

function addLoteToMap(lote){
  const layer = L.geoJSON(lote.polygon, {
    style: {
      color: "rgba(255,255,255,.75)",
      weight: 2,
      fillOpacity: 0 // IMPORTANTE: lote sin pintar
    }
  });

  layer.on("click", (e) => {
    selectLote(lote, layer);
  });

  layer.addTo(lotesLayer);
}

function selectLote(lote, layer){
  // reset estilo a todos
  lotesLayer.eachLayer(l => {
    try { l.setStyle({ color:"rgba(255,255,255,.75)", weight:2 }); } catch {}
  });

  // resaltar seleccionado
  try { layer.setStyle({ color:"rgba(125,211,252,.95)", weight:3 }); } catch {}

  selectedLote = {
    id: lote.id,
    nombre: lote.nombre,
    feature: lote.polygon,       // GeoJSON
    leafletLayer: layer
  };

  btnAddWork.disabled = false;
  updatePanelForSelected();
  showLotePopup();
}

function addLlaveToMap(llave){
  // Marcador “pro” simple (círculo)
  const marker = L.circleMarker([llave.lat, llave.lng], {
    radius: 7,
    color: "rgba(59,130,246,.95)",
    weight: 2,
    fillColor: "rgba(59,130,246,.35)",
    fillOpacity: 1
  });

  marker.bindPopup(`
    <b>${escapeHtml(llave.nombre)}</b><br/>
    Llave de riego
  `);

  marker.addTo(llavesLayer);
}

function startDrawWork(){
  if(!selectedLote) return;

  btnAddWork.disabled = true;
  btnCancel.disabled = false;

  // Activar dibujo de polígono
  if(drawHandler) drawHandler.disable();

  drawHandler = new L.Draw.Polygon(map, {
    allowIntersection: false,
    showArea: false,
    shapeOptions: {
      color: "rgba(234,179,8,.95)",
      weight: 2
    }
  });

  drawHandler.enable();

  map.once(L.Draw.Event.CREATED, (evt) => {
    const drawnLayer = evt.layer;              // Leaflet layer
    const drawnGeo = drawnLayer.toGeoJSON();   // GeoJSON

    // Recortar al lote seleccionado (si se sale, se recorta)
    const clipped = clipToLote(drawnGeo, selectedLote.feature);

    if(!clipped){
      alert("La zona dibujada no cae dentro del lote. Intenta de nuevo.");
      cancelDraw();
      return;
    }

    // Guardar/actualizar unión de trabajo del lote
    const newUnion = mergeWork(selectedLote.id, clipped);

    // Dibujar la zona resultante (la zona que se trabajó EXACTA)
    // Nota: dibujamos SOLO la zona nueva recortada (no toda la unión), para que vea lo que hizo.
    const color = colorByPercent(getWorkedPercent(selectedLote.id));
    const painted = L.geoJSON(clipped, {
      style: {
        color: "rgba(255,255,255,.15)",
        weight: 1,
        fillColor: color,
        fillOpacity: 0.45
      }
    });
    painted.addTo(trabajoLayer);

    // Actualizar UI
    updatePanelForSelected();
    showLotePopup();

    cancelDraw();
  });
}

function cancelDraw(){
  if(drawHandler){
    try { drawHandler.disable(); } catch {}
    drawHandler = null;
  }
  btnCancel.disabled = true;
  btnAddWork.disabled = !selectedLote;
}

function clipToLote(drawnGeo, loteGeo){
  try{
    // turf.intersect requiere Polygons.
    const a = drawnGeo;
    const b = loteGeo;

    const clipped = turf.intersect(a, b);
    return clipped || null;
  }catch(err){
    return null;
  }
}

function mergeWork(loteId, newWorkFeature){
  const prev = workState.get(loteId);

  // si es la primera vez
  if(!prev){
    const areaHa = sqmToHa(turf.area(newWorkFeature));
    workState.set(loteId, { unionFeature: newWorkFeature, areaHa });
    return newWorkFeature;
  }

  // unir (para evitar doble conteo en áreas superpuestas)
  let union = prev.unionFeature;
  try{
    union = turf.union(union, newWorkFeature);
  }catch{
    // fallback si union falla: mantenemos el anterior y sumamos área simple
    // (en demo rara vez falla si polígonos no son raros)
  }

  const areaHa = sqmToHa(turf.area(union));
  workState.set(loteId, { unionFeature: union, areaHa });
  return union;
}

function getLoteAreaHa(){
  if(!selectedLote) return 0;
  return sqmToHa(turf.area(selectedLote.feature));
}

function getWorkedAreaHa(loteId){
  const st = workState.get(loteId);
  return st ? st.areaHa : 0;
}

function getWorkedPercent(loteId){
  const loteArea = getLoteAreaHa();
  if(loteArea <= 0) return 0;
  const worked = getWorkedAreaHa(loteId);
  return Math.max(0, Math.min(100, (worked / loteArea) * 100));
}

function colorByPercent(pct){
  if(pct >= 99.5) return "rgba(34,197,94,1)";     // verde
  if(pct >= 50)   return "rgba(234,179,8,1)";     // amarillo
  return "rgba(239,68,68,1)";                     // rojo
}

function updatePanelForSelected(){
  if(!selectedLote) return;

  const aLote = getLoteAreaHa();
  const aTrab = getWorkedAreaHa(selectedLote.id);
  const pct = getWorkedPercent(selectedLote.id);

  elSelLote.textContent = `${selectedLote.nombre} (${selectedLote.id})`;
  elAreaLote.textContent = aLote ? aLote.toFixed(2) : "—";
  elAreaTrab.textContent = aTrab ? aTrab.toFixed(2) : "0.00";
  elPctTrab.textContent  = `${pct.toFixed(0)}%`;
}

function resetPanel(){
  elSelLote.textContent = "—";
  elAreaLote.textContent = "—";
  elAreaTrab.textContent = "—";
  elPctTrab.textContent = "—";
}

function showLotePopup(){
  if(!selectedLote) return;

  const pct = getWorkedPercent(selectedLote.id);
  const statusColor = colorByPercent(pct);

  const html = `
    <div style="min-width:180px">
      <div style="font-weight:700;margin-bottom:6px">${escapeHtml(selectedLote.nombre)}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="width:10px;height:10px;border-radius:999px;background:${statusColor};display:inline-block"></span>
        <span><b>${pct.toFixed(0)}%</b> trabajado</span>
      </div>
      <div style="font-size:12px;opacity:.8;margin-top:6px">
        Toca “Añadir trabajo” y dibuja dentro del lote
      </div>
    </div>
  `;

  // popup en el centro del lote
  const centroid = turf.centroid(selectedLote.feature).geometry.coordinates; // [lng,lat]
  L.popup({ closeButton: true })
    .setLatLng([centroid[1], centroid[0]])
    .setContent(html)
    .openOn(map);
}

function sqmToHa(sqm){ return sqm / 10000; }

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[s]));
}
