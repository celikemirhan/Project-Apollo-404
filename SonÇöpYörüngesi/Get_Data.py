import os
import requests
import json
import time
from datetime import datetime

def fetch_tle_to_json(url, output_filename):
    """
    Verilen URL'den TLE verisini çeker, parse eder ve standart JSON yapısında kaydeder.
    """
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()

        lines = response.text.strip().splitlines()
        tle_listesi = []

        for i in range(0, len(lines), 3):
            if i + 2 < len(lines):
                object_name = lines[i].strip()
                tle_line1 = lines[i + 1].strip()
                tle_line2 = lines[i + 2].strip()
                catalog_number = tle_line1[2:7].strip()

                obje_verisi = {
                    "object_name": object_name,
                    "tle_line1": tle_line1,
                    "tle_line2": tle_line2,
                    "catalog_number": catalog_number
                }
                tle_listesi.append(obje_verisi)

        with open(output_filename, 'w', encoding='utf-8') as json_dosyasi:
            json.dump(tle_listesi, json_dosyasi, indent=4, ensure_ascii=False)

        print(f"✅ Başarılı: {len(tle_listesi)} adet veri '{output_filename}' dosyasına kaydedildi.")

    except requests.exceptions.RequestException as e:
        print(f"❌ Hata: '{output_filename}' için veri çekilemedi: {e}")


def guncellemeleri_baslat(kaynaklar):
    """
    Dosyaların yaşını kontrol eder, 8 saatten eskiyse veya yoksa indirme işlemini başlatır.
    """
    su_an = datetime.now().strftime('%H:%M:%S')
    print(f"\n[{su_an}] Veri kontrolü başlatılıyor...")

    # 8 saat = 28800 saniye (Dosya eskiyse indir, yeniyse atla)
    GECERLILIK_SURESI_SANIYE = 8 * 3600

    for kaynak in kaynaklar:
        dosya_adi = kaynak["dosya_adi"]
        url = kaynak["url"]
        guncelle_lazim_mi = True

        if os.path.exists(dosya_adi):
            dosya_degistirme_zamani = os.path.getmtime(dosya_adi)
            su_anki_zaman = time.time()
            gecen_sure_saniye = su_anki_zaman - dosya_degistirme_zamani

            if gecen_sure_saniye < GECERLILIK_SURESI_SANIYE:
                kalan_sure_saat = (GECERLILIK_SURESI_SANIYE - gecen_sure_saniye) / 3600
                print(f"⚡ '{dosya_adi}' zaten güncel. (Kalan süre: {kalan_sure_saat:.1f} saat). Dosya atlanıyor.")
                guncelle_lazim_mi = False

        if guncelle_lazim_mi:
            print(f"🔄 '{dosya_adi}' internetten indiriliyor...")
            fetch_tle_to_json(url, dosya_adi)

    print("-" * 50)
    print("🚀 İşlem tamamlandı. Program kapatılıyor.")


# --- TÜM VERİ KAYNAKLARI (Çöpler ve Hedef Uydular) ---
VERI_KAYNAKLARI = [
    {
        "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-2251-debris&FORMAT=tle",
        "dosya_adi": "cosmos_2251_enkazi.json"
    },
    {
        "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-33-debris&FORMAT=tle",
        "dosya_adi": "iridium_33_enkazi.json"
    },
    {
        # Türksat uydularını da aynı formata (TLE) çektik!
        "url": "https://celestrak.org/NORAD/elements/gp.php?NAME=TURKSAT&FORMAT=tle",
        "dosya_adi": "turk_uydulari.json"
    },
    {
        "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-1408-debris&FORMAT=tle",
        "dosya_adi": "cosmos_1408_enkazi.json"
    },
    {
        "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=fengyun-1c-debris&FORMAT=tle",
        "dosya_adi": "fengyun_1c_enkazi.json"
    },
    {
        "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-2251-debris&FORMAT=tle",
        "dosya_adi": "./data/cosmos_2251_enkazi.json"
    },
    {
        "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-33-debris&FORMAT=tle",
        "dosya_adi": "./data/iridium_33_enkazi.json"
    },
    {
        # Türksat uydularını da aynı formata (TLE) çektik!
        "url": "https://celestrak.org/NORAD/elements/gp.php?NAME=TURKSAT&FORMAT=tle",
        "dosya_adi": "./data/turk_uydulari.json"
    },
    {
        "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-1408-debris&FORMAT=tle",
        "dosya_adi": "./data/cosmos_1408_enkazi.json"
    },
    {
        "url": "https://celestrak.org/NORAD/elements/gp.php?GROUP=fengyun-1c-debris&FORMAT=tle",
        "dosya_adi": "./data/fengyun_1c_enkazi.json"
    }
]

# Ana kontrolcüyü çalıştır
if __name__ == "__main__":
    guncellemeleri_baslat(VERI_KAYNAKLARI)