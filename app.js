// app.js – DEMO AGROSOL
let map;
let haciendaActual = null;

let haciendaLayer = L.layerGroup();
let lotesLayer = L.layerGroup();
let llavesLayer = L.layerGroup();
let trabajoLayer = L.featureGroup();

let selectedLote = null;
let drawHandler = null;
const workState = new Map();

const elSelLote = document.getElementById("selLote");
const elAreaLote = document.getElementById("areaLote");
const elAreaTrab = document.getElementById("areaTrab");
const elPctTrab  = document.getElementById("pctTrab");

const btnAddWork = document.getElementById("btnAddWork");
const btnCancel  = document.getElementById("btnCancel");
const haciendaSelect = document.getElementById("haciendaSelect");

init();

/* ================= INIT ================= */

function init(){
  initMap();
  initUI();
  loadHaciendas();
  setHacienda(DEMO_DATA.haciendas[0].id);
}

function initMap(){
  map = L.map("map");

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution:"© Esri" }
  ).addTo(map);

  haciendaLayer.addTo(map);
  lotesLayer.addTo(map);
  trabajoLayer.addTo(map);
  llavesLayer.addTo(map);
}

/* ================= UI ================= */

function initUI(){
  btnAddWork.onclick = startDrawWork;
  btnCancel.onclick = cancelDraw;
  haciendaSelect.onchange = e => setHacienda(e.target.value);
}

function loadHaciendas(){
  haciendaSelect.innerHTML = "";
  DEMO_DATA.haciendas.forEach(h=>{
    const o=document.createElement("option");
    o.value=h.id; o.textContent=h.nombre;
    haciendaSelect.appendChild(o);
  });
}

/* ================= HACIENDA ================= */

function setHacienda(id){
  haciendaActual = DEMO_DATA.haciendas.find(h=>h.id===id);
  haciendaSelect.value=id;

  haciendaLayer.clearLayers();
  lotesLayer.clearLayers();
  trabajoLayer.clearLayers();
  llavesLayer.clearLayers();
  workState.clear();
  selectedLote=null;
  resetPanel();

  map.setView([haciendaActual.center.lat,haciendaActual.center.lng],haciendaActual.zoom);

  // borde hacienda
  if(haciendaActual.haciendaBorder){
    const b = L.geoJSON(haciendaActual.haciendaBorder,{
      style:{
        color:"#38bdf8",
        weight:4,
        fillOpacity:0
      }
    }).addTo(haciendaLayer);

    map.fitBounds(b.getBounds(),{padding:[20,20]});
  }

  haciendaActual.lotes.forEach(addLoteToMap);
}

/* ================= LOTES ================= */

function addLoteToMap(lote){
  const layer=L.geoJSON(lote.polygon,{
    style:{color:"rgba(255,255,255,.75)",weight:2,fillOpacity:0}
  }).on("click",()=>selectLote(lote,layer));

  layer.addTo(lotesLayer);
}

function selectLote(lote,layer){
  lotesLayer.eachLayer(l=>{
    try{l.setStyle({color:"rgba(255,255,255,.75)",weight:2});}catch{}
  });

  layer.setStyle({color:"rgba(125,211,252,.95)",weight:3});
  selectedLote={id:lote.id,nombre:lote.nombre,feature:lote.polygon};
  btnAddWork.disabled=false;
  updatePanel();
  showPopup();
}

/* ================= TRABAJO ================= */

function startDrawWork(){
  if(!selectedLote) return;
  btnAddWork.disabled=true;
  btnCancel.disabled=false;

  drawHandler=new L.Draw.Polygon(map,{allowIntersection:false});
  drawHandler.enable();

  map.once(L.Draw.Event.CREATED,e=>{
    const clipped=turf.intersect(e.layer.toGeoJSON(),selectedLote.feature);
    if(!clipped){ alert("Dibuja dentro del lote"); cancelDraw(); return; }

    const prev=workState.get(selectedLote.id);
    const union=prev?turf.union(prev,clipped):clipped;
    workState.set(selectedLote.id,union);

    const pct=getPct();
    L.geoJSON(clipped,{
      style:{
        fillColor:colorByPct(pct),
        fillOpacity:.45,
        color:"#fff",
        weight:1
      }
    }).addTo(trabajoLayer);

    updatePanel();
    showPopup();
    cancelDraw();
  });
}

function cancelDraw(){
  if(drawHandler) drawHandler.disable();
  btnCancel.disabled=true;
  btnAddWork.disabled=!selectedLote;
}

/* ================= UTIL ================= */

function getPct(){
  const loteA=turf.area(selectedLote.feature);
  const trab=turf.area(workState.get(selectedLote.id));
  return Math.min(100,(trab/loteA)*100);
}

function colorByPct(p){
  if(p>=99.5) return "#22c55e";
  if(p>=50) return "#eab308";
  return "#ef4444";
}

function updatePanel(){
  const pct=getPct();
  elSelLote.textContent=selectedLote.nombre;
  elPctTrab.textContent=pct.toFixed(0)+"%";
}

function resetPanel(){
  elSelLote.textContent="—";
  elPctTrab.textContent="—";
}

function showPopup(){
  const c=turf.centroid(selectedLote.feature).geometry.coordinates;
  L.popup()
   .setLatLng([c[1],c[0]])
   .setContent(`<b>${selectedLote.nombre}</b><br>${getPct().toFixed(0)}% trabajado`)
   .openOn(map);
}
