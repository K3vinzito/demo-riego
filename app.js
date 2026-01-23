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
      llavesVisibles ? llavesLayer.addTo(map) : map.removeLayer(llavesLayer);
    };
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

  haciendaLayer.clearLayers();
  lotesLayer.clearLayers();
  trabajoLayer.clearLayers();
  llavesLayer.clearLayers();
  workState.clear();
  selectedLote = null;
  resetPanel();
  hideLlaveCard();

  map.setView([haciendaActual.center.lat, haciendaActual.center.lng], haciendaActual.zoom || 16);

  if(haciendaActual.haciendaBorder){
    const b = L.geoJSON(haciendaActual.haciendaBorder,{
      style:{ color:"#38bdf8", weight:4, fillOpacity:0 }
    }).addTo(haciendaLayer);

    map.fitBounds(b.getBounds(),{ padding:[20,20] });
  }

  setTimeout(()=>map.invalidateSize(true),200);

  haciendaActual.lotes.forEach(addLoteToMap);
  haciendaActual.llaves.forEach(addLlaveToMap);

  if(!llavesVisibles) map.removeLayer(llavesLayer);
}

/* ================= LOTES ================= */

function addLoteToMap(lote){
  const layer = L.geoJSON(lote.polygon,{
    style:{ color:"rgba(255,255,255,.75)", weight:2, fillOpacity:0 }
  });

  layer.on("click",()=>selectLote(lote,layer));
  layer.addTo(lotesLayer);
}

function selectLote(lote, layer){
  hideLlaveCard();

  lotesLayer.eachLayer(l=>{
    try{l.setStyle({color:"rgba(255,255,255,.75)",weight:2});}catch{}
  });

  layer.setStyle({color:"rgba(125,211,252,.95)",weight:3});
  selectedLote={ id:lote.id, nombre:lote.nombre, feature:lote.polygon };

  btnAddWork.disabled=false;
  updatePanel();
  showPopup();
}

/* ================= TRABAJO ================= */

function startDrawWork(){
  if(!selectedLote) return;

  btnAddWork.disabled=true;
  btnCancel.disabled=false;

  drawHandler=new L.Draw.Polygon(map,{ allowIntersection:false });
  drawHandler.enable();

  map.once(L.Draw.Event.CREATED,e=>{
    const clipped=turf.intersect(e.layer.toGeoJSON(),selectedLote.feature);
    if(!clipped){ alert("Dibuja dentro del lote"); cancelDraw(); return; }

    const prev=workState.get(selectedLote.id);
    const union=prev?turf.union(prev,clipped):clipped;
    workState.set(selectedLote.id,union);

    L.geoJSON(clipped,{
      interactive:false,
      style:{
        fillColor:colorByPct(getPct(selectedLote.id)),
        fillOpacity:.45,
        color:"#fff",
        weight:1
      }
    }).addTo(trabajoLayer);

    lotesLayer.bringToFront();

    updatePanel();
    showPopup();
    cancelDraw();
  });
}

function cancelDraw(){
  if(drawHandler) drawHandler.disable();
  drawHandler=null;
  btnCancel.disabled=true;
  btnAddWork.disabled=!selectedLote;
}

/* ================= LLAVES ================= */

function addLlaveToMap(llave){
  const icon = L.icon({
    iconUrl:"./aspersor.png",
    iconSize:[36,36],
    iconAnchor:[18,18]
  });

  L.marker([llave.lat,llave.lng],{icon})
    .on("click",()=>showLlaveDetalle(llave))
    .addTo(llavesLayer);
}

function showLlaveDetalle(llave){
  elLlaveCard.style.display="block";
  elLlaveNombre.textContent=llave.nombre;
  elLlaveTipo.textContent=llave.tipo;
  elLlavePresion.textContent=llave.presion;
  elLlaveEstado.textContent=llave.estado;
  elLlaveObs.textContent=llave.observacion;
}

function hideLlaveCard(){
  if(elLlaveCard) elLlaveCard.style.display="none";
}

/* ================= UTIL ================= */

function getPct(id){
  const loteA=turf.area(selectedLote.feature);
  const trab=turf.area(workState.get(id)||{type:"FeatureCollection",features:[]});
  return Math.min(100,(trab/loteA)*100);
}

function colorByPct(p){
  if(p>=99.5) return "#22c55e";
  if(p>=50) return "#eab308";
  return "#ef4444";
}

function updatePanel(){
  const pct=getPct(selectedLote.id);
  elSelLote.textContent=selectedLote.nombre;
  elAreaLote.textContent="—";
  elAreaTrab.textContent="—";
  elPctTrab.textContent=pct.toFixed(0)+"%";
}

function resetPanel(){
  elSelLote.textContent="—";
  elAreaLote.textContent="—";
  elAreaTrab.textContent="—";
  elPctTrab.textContent="—";
}

function showPopup(){
  const c=turf.centroid(selectedLote.feature).geometry.coordinates;
  L.popup()
    .setLatLng([c[1],c[0]])
    .setContent(`<b>${selectedLote.nombre}</b><br>${getPct(selectedLote.id).toFixed(0)}% trabajado`)
    .openOn(map);
}
