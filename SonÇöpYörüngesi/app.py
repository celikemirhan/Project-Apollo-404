from flask import Flask, render_template, jsonify, request
from logic.satellite_logic import load_turk_uydulari, load_debris_files, get_anlik_konum, ts
from logic.risk_model import (
    heuristik_risk, get_risk_seviyesi,
    heuristik_risk_yuzde, get_risk_seviyesi_yuzde,
    hibrit_risk_hesapla, AI_PIPELINE,
)
from skyfield.api import EarthSatellite
import requests
import json, os, math
from datetime import timedelta, timezone
from Get_Data import guncellemeleri_baslat, VERI_KAYNAKLARI

# Uygulama başlarken verileri kontrol et ve gerekirse güncelle
guncellemeleri_baslat(VERI_KAYNAKLARI)

app = Flask(__name__)

TURK_UYDULAR   = load_turk_uydulari()
IRIDIUM_DEBRIS = load_debris_files()

# ---------------------------------------------------------------------------
# Enkaz yükleyici
# ---------------------------------------------------------------------------
def akilli_json_okuyucu(dosya_yolu: str):
    try:
        with open(dosya_yolu, "r", encoding="utf-8") as f:
            veriler = json.load(f)
        uydular = []
        for d in veriler:
            if "tle_line1" in d and "tle_line2" in d:
                isim = d.get("object_name", d.get("OBJECT_NAME", "Bilinmeyen"))
                uydular.append(EarthSatellite(d["tle_line1"], d["tle_line2"], isim, ts))
            elif "MEAN_MOTION" in d:
                uydu = EarthSatellite.from_omm(ts, d)
                if not uydu.name:
                    uydu.name = d.get("OBJECT_NAME", "Bilinmeyen OMM")
                uydular.append(uydu)
        return uydular
    except Exception as e:
        print(f"⚠️  {dosya_yolu} yüklenemedi: {e}")
        return []

_BASE      = os.path.dirname(os.path.abspath(__file__))
cosmos2251 = akilli_json_okuyucu(os.path.join(_BASE, "cosmos_2251_enkazi.json"))
iridium_ai = akilli_json_okuyucu(os.path.join(_BASE, "iridium_debris.json"))
cosmos1408 = akilli_json_okuyucu(os.path.join(_BASE, "cosmos_1408_enkazi.json"))
fengyun    = akilli_json_okuyucu(os.path.join(_BASE, "fengyun_1c_enkazi.json"))
TUM_COPLER = cosmos2251 + iridium_ai + cosmos1408 + fengyun

# İsim → EarthSatellite hızlı arama için dict
TUM_COPLER_DICT = {}
for cop in TUM_COPLER:
    TUM_COPLER_DICT[cop.name] = cop

print(f"✅ Enkaz: {len(TUM_COPLER)} obje yüklendi.")

# ---------------------------------------------------------------------------
# Ülke bulucu (reverse geocode + cache)
# ---------------------------------------------------------------------------
ULKE_CACHE = {}


def ulke_bul(lat: float, lon: float):
    try:
        cache_key = (round(float(lat), 2), round(float(lon), 2))
    except Exception:
        return {"ulke_adi": "Bilinmiyor", "ulke_kodu": "??"}

    if cache_key in ULKE_CACHE:
        return ULKE_CACHE[cache_key]

    sonuc = {"ulke_adi": "Okyanus / Uluslararası Bölge", "ulke_kodu": "—"}

    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={
                "lat": cache_key[0],
                "lon": cache_key[1],
                "format": "jsonv2",
                "zoom": 3,
                "addressdetails": 1,
                "accept-language": "tr,en",
            },
            headers={
                "User-Agent": "debris-tracker/1.0 (educational-project)",
            },
            timeout=4,
        )
        if response.ok:
            data = response.json() or {}
            address = data.get("address", {})
            country_name = (
                address.get("country")
                or address.get("state")
                or address.get("region")
                or "Okyanus / Uluslararası Bölge"
            )
            country_code = (address.get("country_code") or "—").upper()
            sonuc = {
                "ulke_adi": country_name,
                "ulke_kodu": country_code,
            }
    except Exception as e:
        print(f"⚠️ Ülke sorgusu başarısız ({lat}, {lon}): {e}")

    ULKE_CACHE[cache_key] = sonuc
    return sonuc

# ---------------------------------------------------------------------------
# Endpoint'ler
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/meta")
def api_meta():
    return jsonify({
        "uydular":         list(TURK_UYDULAR.keys()),
        "ilk_uydu":        list(TURK_UYDULAR.keys())[0] if TURK_UYDULAR else None,
        "debris_count":    len(IRIDIUM_DEBRIS),
        "ai_debris_count": len(TUM_COPLER),
        "ai_model_aktif":  AI_PIPELINE is not None,
    })

@app.route("/api/uydular")
def api_uydular():
    result = []
    for isim, tle in TURK_UYDULAR.items():
        k = get_anlik_konum(isim, tle["line1"], tle["line2"])
        if k:
            k["isim"] = isim
            result.append(k)
    return jsonify(result)

@app.route("/api/debris")
def api_debris():
    t = ts.now()
    out = []
    for i, sat in enumerate(IRIDIUM_DEBRIS):
        try:
            geocentric = sat.at(t)
            pos = geocentric.position.m
            vel = geocentric.velocity.m_per_s
            out.append({
                "id":   f"deb_{i}",
                "isim": sat.name,
                "x": float(pos[0]), "y": float(pos[1]), "z": float(pos[2]),
                "vx": float(vel[0]), "vy": float(vel[1]), "vz": float(vel[2]),
            })
        except Exception:
            pass
    return jsonify(out)

@app.route("/api/ulke")
def api_ulke():
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None:
        return jsonify({"error": "lat ve lon gerekli"}), 400
    return jsonify(ulke_bul(lat, lon))

@app.route("/api/risk/<uydu_isim>")
def api_risk(uydu_isim):
    tle = TURK_UYDULAR.get(uydu_isim)
    if not tle:
        return jsonify({"error": "Uydu bulunamadı"}), 404

    k = get_anlik_konum(uydu_isim, tle["line1"], tle["line2"])
    if not k:
        return jsonify({"error": "Konum hesaplanamadı"}), 500

    log_r        = heuristik_risk(k["alt_km"])
    seviye, renk = get_risk_seviyesi(log_r)
    yuzde        = heuristik_risk_yuzde(k["alt_km"])
    s_y, r_y     = get_risk_seviyesi_yuzde(yuzde)

    return jsonify({
        **k,
        "risk_log10": round(log_r, 3),
        "risk_prob":  f"{10**log_r:.2e}",
        "risk_yuzde": round(yuzde, 1),
        "seviye":     s_y,
        "renk":       r_y,
    })

@app.route("/api/risk_ai/<uydu_isim>")
def api_risk_ai(uydu_isim):
    if AI_PIPELINE is None:
        return jsonify({"error": "AI modeli yüklü değil"}), 503

    tle = TURK_UYDULAR.get(uydu_isim)
    if not tle:
        return jsonify({"error": "Uydu bulunamadı"}), 404

    try:
        hedef_uydu = EarthSatellite(tle["line1"], tle["line2"], uydu_isim, ts)
        tehditler  = hibrit_risk_hesapla(hedef_uydu, TUM_COPLER, ts)
        return jsonify({
            "uydu":           uydu_isim,
            "ai_model_aktif": True,
            "tehdit_sayisi":  len(tehditler),
            "tehditler":      tehditler,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/orbit/<uydu_isim>")
def api_orbit(uydu_isim):
    tle = TURK_UYDULAR.get(uydu_isim)
    if not tle:
        return jsonify({"error": "Uydu bulunamadı"}), 404

    sat    = EarthSatellite(tle["line1"], tle["line2"], uydu_isim, ts)
    now    = ts.now()
    now_dt = now.utc_datetime().replace(tzinfo=timezone.utc)

    no_kozai   = sat.model.no_kozai
    period_min = max(80.0, min(2 * math.pi / no_kozai, 1500.0))
    n_points   = 120
    step_min   = period_min / n_points

    samples = []
    for i in range(n_points + 1):
        t_dt = now_dt + timedelta(minutes=i * step_min)
        t    = ts.from_datetime(t_dt)
        try:
            pos = sat.at(t).position.m
            samples.append({"x": float(pos[0]), "y": float(pos[1]), "z": float(pos[2])})
        except Exception:
            pass

    return jsonify(samples)

@app.route("/api/orbit_debris/<cop_isim>")
def api_orbit_debris(cop_isim):
    sat = TUM_COPLER_DICT.get(cop_isim)
    if sat is None:
        return jsonify({"error": "Enkaz bulunamadı"}), 404

    now    = ts.now()
    now_dt = now.utc_datetime().replace(tzinfo=timezone.utc)

    try:
        no_kozai   = sat.model.no_kozai
        period_min = max(80.0, min(2 * math.pi / no_kozai, 1500.0))
    except Exception:
        period_min = 95.0

    n_points = 120
    step_min = period_min / n_points

    samples = []
    for i in range(n_points + 1):
        t_dt = now_dt + timedelta(minutes=i * step_min)
        t    = ts.from_datetime(t_dt)
        try:
            pos = sat.at(t).position.m
            samples.append({"x": float(pos[0]), "y": float(pos[1]), "z": float(pos[2])})
        except Exception:
            pass

    return jsonify(samples)

# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, port=5000)
