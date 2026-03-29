import math
import os
import sys
import numpy as np
import pandas as pd
import scipy.sparse as sp
import joblib
from sklearn.base import BaseEstimator, TransformerMixin

# ---------------------------------------------------------------------------
# 1. ÖZEL SINIFLAR
# ---------------------------------------------------------------------------

class InfCleaner(BaseEstimator, TransformerMixin):
    def fit(self, X, y=None): return self
    def transform(self, X):
        if sp.issparse(X): X = X.toarray()
        X = np.array(X, dtype=np.float64)
        X[~np.isfinite(X)] = np.nan
        return X

class FinalInfCleaner(BaseEstimator, TransformerMixin):
    def fit(self, X, y=None): return self
    def transform(self, X):
        if sp.issparse(X): X = X.toarray()
        X = np.array(X, dtype=np.float64)
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
        X = np.clip(X, -1e15, 1e15)
        return X

# ---------------------------------------------------------------------------
# 2. MODEL YÜKLEME — proje kökünü otomatik bul
# ---------------------------------------------------------------------------

def _bul_proje_koku():
    adaylar = [
        os.path.dirname(os.path.abspath(__file__)),
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        os.getcwd(),
        os.path.dirname(sys.argv[0]) if sys.argv[0] else ".",
    ]
    for kok in adaylar:
        if os.path.isfile(os.path.join(kok, "modelFinal2.pkl")):
            return kok
    return os.getcwd()

PROJE_KOKU  = _bul_proje_koku()
_MODEL_PATH = os.path.join(PROJE_KOKU, "modelFinal2.pkl")
_TRAIN_CSV  = os.path.join(PROJE_KOKU, "train_data.csv")

AI_PIPELINE = None
REF_COLUMNS = None

try:
    # --- YENİ EKLENEN SİHİRLİ KODLAR ---
    import __main__
    __main__.InfCleaner = InfCleaner
    __main__.FinalInfCleaner = FinalInfCleaner
    # -----------------------------------

    AI_PIPELINE = joblib.load(_MODEL_PATH)
    if os.path.isfile(_TRAIN_CSV):
        _ref_df     = pd.read_csv(_TRAIN_CSV, nrows=0)
        REF_COLUMNS = _ref_df.drop(columns=["risk"], errors="ignore").columns.tolist()
    print(f"✅ AI modeli yüklendi: {_MODEL_PATH}")
except Exception as e:
    print(f"⚠️  AI modeli yüklenemedi ({_MODEL_PATH}): {e}")

# ---------------------------------------------------------------------------
# 3. HEURİSTİK (mevcut /api/risk için, değişmedi)
# ---------------------------------------------------------------------------

def heuristik_risk(alt_km: float) -> float:
    sigma    = 0.5
    miss     = max(abs(alt_km - 780), 0.3)
    risk_val = max(-((miss / sigma) ** 2) / 2 - math.log(sigma * math.sqrt(2 * math.pi)), -30.0)
    return risk_val

def heuristik_risk_yuzde(alt_km: float) -> float:
    """0-100 arası yüzde risk — frontend'e anlamlı değer."""
    uzaklik = abs(alt_km - 780)
    if   uzaklik <  10: return 85.0
    elif uzaklik <  50: return 60.0 - (uzaklik - 10) * 0.5
    elif uzaklik < 200: return 40.0 - (uzaklik - 50) * 0.15
    else:               return max(5.0, 25.0 - (uzaklik - 200) * 0.05)

def get_risk_seviyesi(log_r: float):
    if   log_r > -4:  return "KRİTİK", "#ff1744"
    elif log_r > -6:  return "YÜKSEK", "#ff6d00"
    elif log_r > -10: return "ORTA",   "#ffd600"
    else:             return "DÜŞÜK",  "#00e676"

def get_risk_seviyesi_yuzde(yuzde: float):
    if   yuzde > 65: return "KRİTİK", "#ff1744"
    elif yuzde > 30: return "DİKKAT", "#ff6d00"
    elif yuzde > 15: return "ORTA",   "#ffd600"
    else:            return "DÜŞÜK",  "#00e676"

# ---------------------------------------------------------------------------
# 4. HİBRİT AI + FİZİK RİSK
# ---------------------------------------------------------------------------

def hibrit_risk_hesapla(hedef_uydu, tum_copler, ts, tarama_suresi_dk: int = 1440):
    if AI_PIPELINE is None:
        return []

    from datetime import timedelta

    now     = ts.now()
    minutes = np.arange(0, tarama_suresi_dk, 1)
    times   = ts.from_datetimes(
        [now.utc_datetime() + timedelta(minutes=int(m)) for m in minutes]
    )

    t_positions = hedef_uydu.at(times).position.km
    tehditler   = []

    for cop in tum_copler:
        try:
            c_positions      = cop.at(times).position.km
            distances        = np.linalg.norm(t_positions - c_positions, axis=0)
            min_idx          = int(np.argmin(distances))
            miss_distance_km = float(distances[min_idx])

            if miss_distance_km > 100:
                continue

            time_to_tca_days   = minutes[min_idx] / (60 * 24)
            t_vel              = hedef_uydu.at(times[min_idx]).velocity.km_per_s
            c_vel              = cop.at(times[min_idx]).velocity.km_per_s
            relative_speed_kms = float(np.linalg.norm(t_vel - c_vel))

            live_features = {
                "time_to_tca":    [time_to_tca_days],
                "miss_distance":  [miss_distance_km * 1000],
                "relative_speed": [relative_speed_kms * 1000],
                "t_j2k_inc":      [hedef_uydu.model.inclo * (180 / np.pi)],
                "t_j2k_ecc":      [hedef_uydu.model.ecco],
                "c_j2k_inc":      [cop.model.inclo * (180 / np.pi)],
                "c_j2k_ecc":      [cop.model.ecco],
                "c_object_type":  ["DEBRIS"],
            }

            live_df = pd.DataFrame(live_features)
            if REF_COLUMNS is not None:
                for col in REF_COLUMNS:
                    if col not in live_df.columns:
                        live_df[col] = np.nan
                live_df = live_df[REF_COLUMNS]

            ai_risk    = float(np.clip(AI_PIPELINE.predict(live_df)[0], 0, 100))
            fizik_risk = 100.0 if miss_distance_km < 10 else max(0.0, 100 - miss_distance_km)
            nihai_risk = round(fizik_risk * 0.6 + ai_risk * 0.4, 2)
            seviye, renk = get_risk_seviyesi_yuzde(nihai_risk)

            tehditler.append({
                "cop_isim":           cop.name,
                "tca_dk":             int(minutes[min_idx]),
                "miss_distance_km":   round(miss_distance_km, 2),
                "relative_speed_kms": round(relative_speed_kms, 2),
                "ai_risk":            round(ai_risk, 2),
                "fizik_risk":         round(fizik_risk, 2),
                "nihai_risk":         nihai_risk,
                "seviye":             seviye,
                "renk":               renk,
            })
        except Exception as e:
            print(f"🚨 HATA ({cop.name}): {e}")
            continue

    tehditler.sort(key=lambda x: x["nihai_risk"], reverse=True)
    return tehditler