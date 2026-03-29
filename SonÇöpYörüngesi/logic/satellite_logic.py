import json
import os
import glob
import numpy as np
from skyfield.api import load, EarthSatellite, wgs84

# Zaman ölçeğini bir kez tanımlıyoruz
ts = load.timescale()

def load_turk_uydulari():
    """
    data/turk_uydulari.json dosyasını okur. 
    Dosya yoksa veya bozuksa demo verisi döner.
    """
    path = "data/turk_uydulari.json"
    
    # 1. Klasör ve dosya kontrolü
    if not os.path.exists(path):
        print(f"⚠️ {path} bulunamadı, demo verisi yükleniyor.")
        return {"DEMO-SAT": {
            "line1": "1 38798U 12060A   26086.50000000  .00000050  00000+0  99999-5 0  9999",
            "line2": "2 38798  98.1000  90.0000 0001500  90.0000 270.0000 14.52000000600000"
        }}

    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        
        result = {}
        for item in data:
            # Farklı JSON formatlarına karşı esneklik sağlıyoruz
            name = item.get("object_name") or item.get("name")
            l1 = item.get("tle_line1") or item.get("line1")
            l2 = item.get("tle_line2") or item.get("line2")
            
            if name and l1 and l2:
                # TLE verisindeki olası gizli boşlukları temizle (strip)
                result[name] = {"line1": l1.strip(), "line2": l2.strip()}
        return result
    except Exception as e:
        print(f"❌ JSON okuma hatası: {e}")
        return {}

def load_debris_files():
    satellites = []
    # BURAYI GÜNCELLEDİK: Artık data klasörünün içine bakıyor
    debris_files = glob.glob("data/*_enkazi.json") 
    
    print(f"🔍 Sistem şu klasörü tarıyor: data/")
    print(f"📂 Bulunan Enkaz Dosyaları: {debris_files}")
    
    for path in debris_files:
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            for item in data:
                sat = EarthSatellite(item["tle_line1"], item["tle_line2"], item["object_name"], ts)
                satellites.append(sat)
        except Exception as e:
            print(f"❌ {path} okunurken hata: {e}")
    return satellites

def get_anlik_konum(sat_name, line1, line2):
    try:
        sat = EarthSatellite(line1, line2, sat_name, ts)
        t = ts.now()
        geocentric = sat.at(t)
        
        subpoint = wgs84.subpoint(geocentric)
        pos = geocentric.position.m
        vel_km = geocentric.velocity.km_per_s
        vel_m = geocentric.velocity.m_per_s # M/S cinsinden vektörel hız
        
        return {
            "x": float(pos[0]), 
            "y": float(pos[1]), 
            "z": float(pos[2]),
            "vx": float(vel_m[0]), # X yönündeki hız (60fps için)
            "vy": float(vel_m[1]), # Y yönündeki hız
            "vz": float(vel_m[2]), # Z yönündeki hız
            "lat": float(subpoint.latitude.degrees),
            "lon": float(subpoint.longitude.degrees),
            "alt_km": float(subpoint.elevation.km),
            "speed_km_s": float(np.linalg.norm(vel_km))
        }
    except Exception as e:
        print(f"❌ {sat_name} konumu hesaplanamadı: {e}")
        return None