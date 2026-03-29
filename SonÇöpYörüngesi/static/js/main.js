let activeUydu = null;

let satEntities = {};
let orbitLineEntities = {};
let debrisOrbitLines = {};
let highlightedDebris = [];
let debrisNameMap = {};
let debrisGroup = [];
let debrisVis = true;
let viewer;
let orbitData = {};
let aiRiskPending = false;
let focusedDebrisEntity = null;
let currentThreats = [];
let threatOverlayActive = false;
let ulkePanelCacheKey = "";

const svgStringNormal = `
<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="grad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:rgb(255,200,200);stop-opacity:1" />
      <stop offset="30%" style="stop-color:rgb(255,0,0);stop-opacity:1" />
      <stop offset="100%" style="stop-color:rgb(100,0,0);stop-opacity:0.2" />
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="34" fill="url(#grad)" />
</svg>`;
const debrisSvgImageNormal = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStringNormal);

const svgStringFocused = `
<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="grad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:rgb(255,200,200);stop-opacity:1" />
      <stop offset="30%" style="stop-color:rgb(255,0,0);stop-opacity:1" />
      <stop offset="100%" style="stop-color:rgb(100,0,0);stop-opacity:0.2" />
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="30" fill="url(#grad)" />
  <circle cx="32" cy="32" r="26" fill="none" stroke="#d7d7d7" stroke-width="4" />
</svg>`;
const debrisSvgImageFocused = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStringFocused);

const svgStringThreat = `
<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="grad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:rgb(255,255,120);stop-opacity:1" />
      <stop offset="30%" style="stop-color:rgb(255,180,0);stop-opacity:1" />
      <stop offset="100%" style="stop-color:rgb(180,0,0);stop-opacity:0.25" />
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="34" fill="url(#grad)" />
  <circle cx="32" cy="32" r="28" fill="none" stroke="#ffff00" stroke-width="3" stroke-dasharray="6,4" />
</svg>`;
const debrisSvgImageThreat = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStringThreat);

function ecefToLatLon(x, y, z) {
    const a = 6378137.0;
    const e2 = 0.00669437999014;
    const lon = Math.atan2(y, x) * 180 / Math.PI;
    const p = Math.sqrt(x * x + y * y);
    let lat = Math.atan2(z, p * (1 - e2));
    for (let i = 0; i < 6; i++) {
        const sinLat = Math.sin(lat);
        const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
        lat = Math.atan2(z + e2 * N * sinLat, p);
    }
    return { lat: lat * 180 / Math.PI, lon };
}

function velToKms(vx, vy, vz) {
    return Math.sqrt(vx * vx + vy * vy + vz * vz) / 1000;
}

function kodaBayrak(kod) {
    if (!kod || kod.length !== 2) return '🌐';
    return [...kod.toUpperCase()]
        .map(c => String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0)))
        .join('');
}

function tehditGosterilebilirMi() {
    return threatOverlayActive && !!activeUydu;
}

function aktifTehditleriFiltrele(tehditler) {
    return (tehditler || [])
        .filter(t => (t.nihai_risk ?? 0) >= 15)
        .sort((a, b) => (b.nihai_risk ?? 0) - (a.nihai_risk ?? 0));
}

async function initViewer() {
    try {
        const imageryProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
        );

        viewer = new Cesium.Viewer('cesium', {
            baseLayer: new Cesium.ImageryLayer(imageryProvider),
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            infoBox: false,
            navigationHelpButton: false,
            animation: false,
            timeline: false,
            shouldAnimate: true,
            selectionIndicator: false
        });

        const cc = viewer.scene.screenSpaceCameraController;
        cc.inertiaZoom = 0.72;
        cc.inertiaTranslate = 0.68;
        cc.inertiaSpin = 0.68;
        cc.bounceAnimationTime = 1.5;
        cc.minimumZoomDistance = 150000;
        cc.maximumZoomDistance = 40000000;

        const scene = viewer.scene;
        const globe = scene.globe;
        scene.postProcessStages.bloom.enabled = false;
        globe.showGroundAtmosphere = true;
        scene.skyAtmosphere.show = true;
        scene.skyAtmosphere.atmosphereRayleighCoefficient = new Cesium.Cartesian3(5.5e-6, 13.0e-6, 28.4e-6);
        scene.skyAtmosphere.brightnessShift = 0.0;
        scene.skyAtmosphere.saturationShift = 0.2;
        globe.atmosphereLightIntensity = 10.0;
        globe.enableLighting = true;
        scene.fog.enabled = true;
        scene.fog.density = 0.0002;

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((click) => {
            const pickedObject = viewer.scene.pick(click.position);
            if (Cesium.defined(pickedObject) && Cesium.defined(pickedObject.id)) {
                const entityId = pickedObject.id.id || pickedObject.id;
                if (typeof entityId === 'string') {
                    if (entityId.startsWith('deb_')) {
                        focusOnDebris(pickedObject.id);
                        showClickCard(entityId, 'debris');
                    } else if (satEntities[entityId]) {
                        switchUydu(entityId);
                        focusSat();
                        const sel = document.getElementById('uydu-sel');
                        if (sel) sel.value = entityId;
                        showClickCard(entityId, 'satellite');
                    }
                }
            } else {
                resetFocusedDebris();
                closeClickCard();
                viewer.trackedEntity = undefined;
                threatOverlayActive = false;
                syncThreatVisuals();
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        initApp();
    } catch (e) {
        console.error("Viewer başlatılamadı:", e);
    }
}

function focusOnDebris(entity) {
    resetFocusedDebris();
    focusedDebrisEntity = entity;
    if (focusedDebrisEntity.billboard) {
        focusedDebrisEntity.billboard.width = 12;
        focusedDebrisEntity.billboard.height = 12;
        focusedDebrisEntity.billboard.image = debrisSvgImageFocused;
    }
    viewer.flyTo(focusedDebrisEntity, {
        duration: 2.0,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), 2500000)
    }).then(() => { viewer.trackedEntity = focusedDebrisEntity; });
}

function resetFocusedDebris() {
    if (focusedDebrisEntity && focusedDebrisEntity.billboard) {
        const id = focusedDebrisEntity.id;
        const isThreat = highlightedDebris.includes(id);
        focusedDebrisEntity.billboard.width = isThreat ? 10 : 5;
        focusedDebrisEntity.billboard.height = isThreat ? 10 : 5;
        focusedDebrisEntity.billboard.image = isThreat ? debrisSvgImageThreat : debrisSvgImageNormal;
    }
    focusedDebrisEntity = null;
}

function focusSat() {
    if (!satEntities[activeUydu]) return;
    resetFocusedDebris();
    threatOverlayActive = true;
    viewer.flyTo(satEntities[activeUydu], {
        duration: 2.0,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), 2500000)
    }).then(() => {
        viewer.trackedEntity = satEntities[activeUydu];
        syncThreatVisuals();
    });
}

async function initApp() {
    const meta = await fetch('/api/meta').then(r => r.json());
    activeUydu = meta.ilk_uydu;

    const sel = document.getElementById('uydu-sel');
    meta.uydular.forEach(u => {
        const o = document.createElement('option');
        o.value = u;
        o.textContent = u;
        if (u === activeUydu) o.selected = true;
        sel.appendChild(o);
    });

    document.getElementById('st-d').textContent = meta.debris_count + ' obje';
    await loadDebris();
    await updateAll();
    await updateRisk();
}

async function loadDebris() {
    if (!debrisVis) return;
    const data = await fetch('/api/debris').then(r => r.json());

    data.forEach(d => {
        orbitData[d.id] = {
            x: d.x, y: d.y, z: d.z,
            vx: d.vx, vy: d.vy, vz: d.vz,
            lastTime: viewer.clock.currentTime.clone(),
            tip: 'debris'
        };

        if (d.isim) debrisNameMap[d.isim] = d.id;

        if (!viewer.entities.getById(d.id)) {
            const e = viewer.entities.add({
                id: d.id,
                position: new Cesium.CallbackProperty((time, result) => {
                    const od = orbitData[d.id];
                    if (!od) return undefined;
                    const dt = Cesium.JulianDate.secondsDifference(time, od.lastTime);
                    if (!result) result = new Cesium.Cartesian3();
                    result.x = od.x + od.vx * dt;
                    result.y = od.y + od.vy * dt;
                    result.z = od.z + od.vz * dt;
                    return result;
                }, false),
                billboard: {
                    image: debrisSvgImageNormal,
                    width: 5,
                    height: 5,
                    color: new Cesium.Color(1.0, 1.0, 1.0, 0.90),
                    scaleByDistance: new Cesium.NearFarScalar(1.5e5, 2.2, 1.5e7, 0.8)
                }
            });
            debrisGroup.push(e);
        }
    });
}

async function updateAll() {
    const data = await fetch('/api/uydular').then(r => r.json());

    data.forEach(d => {
        const isActive = d.isim === activeUydu;
        orbitData[d.isim] = {
            x: d.x, y: d.y, z: d.z,
            vx: d.vx, vy: d.vy, vz: d.vz,
            lastTime: viewer.clock.currentTime.clone(),
            tip: 'satellite',
            lat: d.lat, lon: d.lon,
            alt_km: d.alt_km, speed_kms: d.speed_km_s
        };

        if (!satEntities[d.isim]) {
            satEntities[d.isim] = viewer.entities.add({
                id: d.isim,
                name: d.isim,
                position: new Cesium.CallbackProperty((time, result) => {
                    const od = orbitData[d.isim];
                    if (!od) return undefined;
                    const dt = Cesium.JulianDate.secondsDifference(time, od.lastTime);
                    if (!result) result = new Cesium.Cartesian3();
                    result.x = od.x + od.vx * dt;
                    result.y = od.y + od.vy * dt;
                    result.z = od.z + od.vz * dt;
                    return result;
                }, false),
                point: {
                    pixelSize: isActive ? 14 : 8,
                    color: isActive
                        ? new Cesium.Color(0.0, 0.75, 1.0, 1.0)
                        : new Cesium.Color(0.2, 0.8, 0.4, 0.8),
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: isActive ? 2 : 1
                },
                label: {
                    text: d.isim,
                    font: 'bold 18px sans-serif',
                    fillColor: Cesium.Color.YELLOW,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    outlineColor: Cesium.Color.BLACK.withAlpha(0.0),
                    outlineWidth: 2,
                    pixelOffset: new Cesium.Cartesian2(0, -30),
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 1.5e7, 0.6),
                    translucencyByDistance: new Cesium.NearFarScalar(5e5, 1.0, 1.5e7, 0.4),
                    show: isActive
                }
            });
            fetchOrbitLine(d.isim);
        }
    });

    document.getElementById('st-u').textContent = data.length + ' uydu';
    document.getElementById('st-t').textContent = new Date().toLocaleTimeString('tr-TR');
    document.getElementById('utc').textContent = '🕐 ' + new Date().toUTCString().slice(0, -3) + ' UTC';
}

async function fetchOrbitLine(uyduIsim) {
    try {
        const data = await fetch('/api/orbit/' + encodeURIComponent(uyduIsim)).then(r => r.json());
        if (!data || data.error || data.length < 2) return;
        const isActive = uyduIsim === activeUydu;
        const positions = data.map(s => new Cesium.Cartesian3(s.x, s.y, s.z));
        const lineId = 'orbit_line_' + uyduIsim;
        const existing = viewer.entities.getById(lineId);
        if (existing) viewer.entities.remove(existing);
        orbitLineEntities[uyduIsim] = viewer.entities.add({
            id: lineId,
            polyline: {
                positions,
                // KALINLIK ARTIRILDI: Aktif uydu için 3.5, diğerleri için 2.0
                width: isActive ? 3.5 : 2.0,
                material: isActive
                    ? new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.5, color: Cesium.Color.CYAN.withAlpha(0.8) })
                    : new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: Cesium.Color.fromCssColorString('#33cc66').withAlpha(0.5) }),
                arcType: Cesium.ArcType.NONE,
                clampToGround: false
            }
        });
    } catch (e) {
        console.warn('Orbit line hatası:', uyduIsim, e);
    }
}

function setOrbitLineStyle(uyduIsim, isActive) {
    const e = orbitLineEntities[uyduIsim];
    if (!e || !e.polyline) return;
    // KALINLIK VE PARLAKLIK EŞİTLENDİ
    e.polyline.width = isActive ? 3.5 : 2.0;
    e.polyline.material = isActive
        ? new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.5, color: Cesium.Color.CYAN.withAlpha(0.8) })
        : new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: Cesium.Color.fromCssColorString('#33cc66').withAlpha(0.5) });
}

function clearThreatHighlights() {
    highlightedDebris.forEach(id => {
        const e = viewer.entities.getById(id);
        if (e && e.billboard) {
            e.billboard.width = 5;
            e.billboard.height = 5;
            e.billboard.image = debrisSvgImageNormal;
            e.billboard.color = new Cesium.Color(1.0, 1.0, 1.0, 0.90);
        }
    });
    highlightedDebris = [];

    Object.values(debrisOrbitLines).forEach(e => {
        if (e) viewer.entities.remove(e);
    });
    debrisOrbitLines = {};
}

async function applyThreatHighlights(tehditler) {
    clearThreatHighlights();
    if (!tehditGosterilebilirMi()) return;

    const secilenler = aktifTehditleriFiltrele(tehditler).slice(0, 5);
    if (secilenler.length === 0) return;

    for (const t of secilenler) {
        const entityId = debrisNameMap[t.cop_isim];
        if (entityId) {
            const e = viewer.entities.getById(entityId);
            if (e && e.billboard) {
                e.billboard.width = 10;
                e.billboard.height = 10;
                e.billboard.image = debrisSvgImageThreat;
                e.billboard.color = Cesium.Color.WHITE;
                highlightedDebris.push(entityId);
            }
        }
        await fetchDebrisOrbitLine(t.cop_isim, t.renk);
    }
}

function syncThreatVisuals() {
    if (!tehditGosterilebilirMi()) {
        clearThreatHighlights();
        return;
    }
    applyThreatHighlights(currentThreats);
}

async function fetchDebrisOrbitLine(copIsim, renk) {
    try {
        const data = await fetch('/api/orbit_debris/' + encodeURIComponent(copIsim)).then(r => r.json());
        if (!data || data.error || data.length < 2) return;

        const positions = data.map(s => new Cesium.Cartesian3(s.x, s.y, s.z));
        const lineId = 'debris_orbit_' + copIsim.replace(/\s+/g, '_');

        const existing = viewer.entities.getById(lineId);
        if (existing) viewer.entities.remove(existing);

        const cssColor = (renk || '#ff6d00').toLowerCase();
        // RENK OPAKLIĞI %90 ile çok daha belirgin
        const finalColor = cssColor === '#ffd600'
            ? Cesium.Color.fromCssColorString('#ffd600').withAlpha(0.90)
            : Cesium.Color.fromCssColorString(cssColor).withAlpha(0.90);

        debrisOrbitLines[copIsim] = viewer.entities.add({
            id: lineId,
            polyline: {
                positions,
                // KALINLIK ARTIRILDI: Tehdit yörüngesi için 3.0
                width: 3.0,
                material: new Cesium.PolylineGlowMaterialProperty({
                    // PARLAKLIK ARTIRILDI: 0.6 yapıldı
                    glowPower: 0.6,
                    color: finalColor
                }),
                arcType: Cesium.ArcType.NONE,
                clampToGround: false
            }
        });
    } catch (e) {
        console.warn('Debris orbit hatası:', copIsim, e);
    }
}

async function updateRisk() {
    if (!activeUydu) return;
    const d = await fetch('/api/risk/' + encodeURIComponent(activeUydu)).then(r => r.json());

    document.getElementById('p-isim').textContent = activeUydu;
    document.getElementById('p-lat').textContent = d.lat != null ? d.lat.toFixed(4) + '°' : '—';
    document.getElementById('p-lon').textContent = d.lon != null ? d.lon.toFixed(4) + '°' : '—';
    document.getElementById('p-alt').textContent = d.alt_km != null ? d.alt_km.toFixed(2) + ' km' : '—';
    document.getElementById('p-vel').textContent = d.speed_km_s != null ? d.speed_km_s.toFixed(3) + ' km/s' : '—';

    applyRiskUI(d.seviye, d.renk, `%${d.risk_yuzde} · AI taranıyor…`);
    updateUlkePanel(d.lat, d.lon);
    updateAIRisk(activeUydu);
}

function applyRiskUI(seviye, renk, altBilgi) {
    const box = document.getElementById('risk-box');
    box.style.borderColor = renk;
    box.style.background = renk + '1a';
    document.getElementById('risk-lvl').style.color = renk;
    document.getElementById('risk-lvl').textContent = seviye;
    document.getElementById('risk-sub').innerHTML = altBilgi;
}

async function updateUlkePanel(lat, lon) {
    const el = document.getElementById('p-ulke');
    if (lat == null || lon == null || !el) {
        el.textContent = '—';
        return;
    }

    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (cacheKey === ulkePanelCacheKey) return;
    ulkePanelCacheKey = cacheKey;

    el.textContent = 'Sorgulanıyor…';
    el.classList.remove('ocean');
    try {
        const res = await fetch(`/api/ulke?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
        const data = await res.json();
        const isOcean = !data.ulke_kodu || data.ulke_kodu === '—' || data.ulke_kodu === '??';
        el.classList.toggle('ocean', isOcean);
        el.textContent = isOcean
            ? (data.ulke_adi || 'Okyanus / Uluslararası Bölge')
            : `${kodaBayrak(data.ulke_kodu)} ${data.ulke_adi}`;
    } catch {
        el.textContent = 'Alınamadı';
    }
}

async function updateAIRisk(uyduIsim) {
    if (aiRiskPending) return;
    aiRiskPending = true;
    try {
        const res = await fetch('/api/risk_ai/' + encodeURIComponent(uyduIsim));
        const data = await res.json();
        if (uyduIsim !== activeUydu) return;

        if (!res.ok || data.error) {
            const d2 = await fetch('/api/risk/' + encodeURIComponent(uyduIsim)).then(r => r.json());
            applyRiskUI(d2.seviye, d2.renk, `%${d2.risk_yuzde} <small>(heuristik)</small>`);
            currentThreats = [];
            renderTehditListesi([]);
            syncThreatVisuals();
            return;
        }

        const tehditler = data.tehditler || [];
        currentThreats = aktifTehditleriFiltrele(tehditler);

        if (currentThreats.length === 0) {
            applyRiskUI('DÜŞÜK', '#00e676', '🤖 %0 · Sarı ve üstü aktif tehdit yok · 24 sa tarandı');
        } else {
            const top = currentThreats[0];
            const tcaStr = `${Math.floor(top.tca_dk / 60)}s ${top.tca_dk % 60}dk`;
            applyRiskUI(
                top.seviye,
                top.renk,
                `🤖 <b>%${top.nihai_risk.toFixed(1)}</b> · ${currentThreats.length} aktif tehdit · ${tcaStr} sonra yaklaşma`
            );
        }

        renderTehditListesi(currentThreats);
        syncThreatVisuals();
    } catch (err) {
        console.warn('AI risk hatası:', err);
    } finally {
        aiRiskPending = false;
    }
}

function renderTehditListesi(tehditler) {
    const el = document.getElementById('tehdit-listesi');
    if (!el) return;
    if (!tehditler || tehditler.length === 0) {
        el.innerHTML = '<div class="tehdit-bos">✅ Sarı ve üstü aktif tehdit yok</div>';
        return;
    }

    el.innerHTML = tehditler.slice(0, 5).map(t => {
        const isim = t.cop_isim.length > 24 ? t.cop_isim.slice(0, 24) + '…' : t.cop_isim;
        // Tıklanabilirlik için cursor: pointer eklendi
        return `<div class="tehdit-item" data-cop="${String(t.cop_isim).replace(/"/g, '&quot;')}" style="border-left-color:${t.renk}; cursor: pointer;">
            <span class="tehdit-isim" title="${t.cop_isim}">${isim}</span>
            <span class="tehdit-skor" style="color:${t.renk}">%${t.nihai_risk.toFixed(1)}</span>
            <span class="tehdit-detay">${t.miss_distance_km.toFixed(1)} km · ${Math.floor(t.tca_dk / 60)}s ${t.tca_dk % 60}dk</span>
        </div>`;
    }).join('');

    el.querySelectorAll('.tehdit-item').forEach(item => {
        item.addEventListener('click', () => {
            const copIsim = item.dataset.cop;
            // Güncellenmiş focusThreatByName fonksiyonu çağrılır
            focusThreatByName(copIsim);
            el.querySelectorAll('.tehdit-item').forEach(x => x.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

// AKILLI ODAKLANMA FONKSİYONU: Önce yörüngeyi çizer, nokta yoksa yörüngeye uçar.
async function focusThreatByName(copIsim) {
    // Tehdidin rengini currentThreats listesinden bul
    const threatData = currentThreats.find(t => t.cop_isim === copIsim);
    const renk = threatData ? threatData.renk : '#ff6d00';

    // 1. Nokta sahnede olsa da olmasa da YÖRÜNGEYİ KESİNLİKLE ÇİZ:
    await fetchDebrisOrbitLine(copIsim, renk);

    const entityId = debrisNameMap[copIsim];
    const entity = entityId ? viewer.entities.getById(entityId) : null;
    
    // Çizdiğimiz yörüngenin ID'sini bul:
    const lineId = 'debris_orbit_' + copIsim.replace(/\s+/g, '_');
    const orbitLine = viewer.entities.getById(lineId);

    if (entity) {
        // DURUM A: Enkaz kameranın görüş alanında (haritada noktası var).
        focusOnDebris(entity);
        showClickCard(entityId, 'debris');
    } else if (orbitLine) {
        // DURUM B: Enkaz noktası henüz sahnede yok (Çok uzakta). 
        // Noktaya gidemediği için hiçbir şey yapmama hatası önlendi, çizilen yörüngeye uçuyor.
        resetFocusedDebris();
        closeClickCard(); // Nokta olmadığı için bilgi kartını kapatıyoruz
        viewer.flyTo(orbitLine, {
            duration: 2.0,
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 3000000)
        });
    }
}

function switchUydu(isim) {
    if (satEntities[activeUydu]) {
        satEntities[activeUydu].label.show = false;
        satEntities[activeUydu].point.pixelSize = 8;
        satEntities[activeUydu].point.color = new Cesium.Color(0.2, 0.8, 0.4, 0.8);
        satEntities[activeUydu].point.outlineWidth = 1;
    }
    setOrbitLineStyle(activeUydu, false);

    clearThreatHighlights();
    threatOverlayActive = false;
    viewer.trackedEntity = undefined;
    resetFocusedDebris();

    activeUydu = isim;

    if (satEntities[isim]) {
        satEntities[isim].label.show = true;
        satEntities[isim].point.pixelSize = 14;
        satEntities[isim].point.color = new Cesium.Color(0.0, 0.75, 1.0, 1.0);
        satEntities[isim].point.outlineWidth = 2;
    }
    setOrbitLineStyle(isim, true);
    fetchOrbitLine(isim);

    aiRiskPending = false;
    updateRisk();
}

function freeView() {
    viewer.trackedEntity = undefined;
    threatOverlayActive = false;
    syncThreatVisuals();
    resetFocusedDebris();
}

function zoomOut() {
    viewer.trackedEntity = undefined;
    threatOverlayActive = false;
    syncThreatVisuals();
    resetFocusedDebris();
    viewer.camera.flyHome(1.5);
}

function toggleDebris() {
    debrisVis = !debrisVis;
    debrisGroup.forEach(e => { e.show = debrisVis; });
    const btn = document.getElementById('btn-d');
    btn.textContent = debrisVis ? '☁ Debris Gizle' : '☁ Debris Göster';
    btn.classList.toggle('off', !debrisVis);
}

function closeClickCard() {
    const card = document.getElementById('click-card');
    if (card) card.classList.add('hidden');
}

async function fetchUlkeVeYaz(lat, lon) {
    const el = document.getElementById('cc-ulke');
    if (!el) return;
    el.textContent = '';
    el.classList.add('loading');
    el.classList.remove('ocean');
    try {
        const res = await fetch(`/api/ulke?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
        const data = await res.json();
        el.classList.remove('loading');
        const isOcean = !data.ulke_kodu || data.ulke_kodu === '—' || data.ulke_kodu === '??';
        el.classList.toggle('ocean', isOcean);
        el.textContent = isOcean
            ? (data.ulke_adi || 'Okyanus / Uluslararası Bölge')
            : `${kodaBayrak(data.ulke_kodu)} ${data.ulke_adi}`;
    } catch {
        el.classList.remove('loading');
        el.textContent = 'Alınamadı';
    }
}

function showClickCard(id, tip) {
    const od = orbitData[id];
    if (!od) return;
    const now = viewer.clock.currentTime;
    const dt = Cesium.JulianDate.secondsDifference(now, od.lastTime);
    const cx = od.x + od.vx * dt;
    const cy = od.y + od.vy * dt;
    const cz = od.z + od.vz * dt;

    let lat, lon, speedKms;
    if (tip === 'satellite') {
        lat = od.lat;
        lon = od.lon;
        speedKms = od.speed_kms;
    } else {
        const ll = ecefToLatLon(cx, cy, cz);
        lat = ll.lat;
        lon = ll.lon;
        speedKms = velToKms(od.vx, od.vy, od.vz);
    }

    const card = document.getElementById('click-card');
    const badge = document.getElementById('click-card-type-badge');
    if (!card) return;

    document.getElementById('click-card-icon').textContent = tip === 'satellite' ? '🛰' : '🗑';
    document.getElementById('click-card-title').textContent = id;
    badge.textContent = tip === 'satellite' ? 'TÜRK UYDUSU' : 'RİSKLİ ENKAZ';
    badge.className = tip === 'satellite' ? 'sat' : '';

    document.getElementById('cc-lat').textContent = lat != null ? lat.toFixed(4) + '°' : '—';
    document.getElementById('cc-lon').textContent = lon != null ? lon.toFixed(4) + '°' : '—';
    document.getElementById('cc-vel').textContent = speedKms != null ? speedKms.toFixed(3) + ' km/s' : '—';

    card.classList.remove('hidden');
    fetchUlkeVeYaz(lat, lon);
}

initViewer();
setInterval(updateAll, 3000);
setInterval(updateRisk, 30000);
setInterval(loadDebris, 10000);
setInterval(() => { if (activeUydu) fetchOrbitLine(activeUydu); }, 60000);