# rtw-vodozemac-build

RateTheWork'ün uçtan uca şifreleme ikililerinin **yeniden üretilebilir derlemesi**.

Bu depo, [`Meneleus/vodozemac-bindings`](https://github.com/Meneleus/vodozemac-bindings)
deposunun `v0.4.2` etiketinden (`42e4e0c`) alınmış bir fork'tur. Şifrelemenin kendisi
Matrix.org'un [`vodozemac`](https://github.com/matrix-org/vodozemac) kütüphanesidir
(Apache-2.0, Least Authority denetimi 2022). Bu depo yalnız onu tarayıcıya (wasm) ve
telefona (UniFFI: Kotlin / Swift) bağlayan ince katmandır.

## Neden

Hazır npm paketlerindeki (`@kinsh/vodozemac-wasm`, `@kinsh/vodozemac-rn`) ikililerin
yayımlanan kaynak koddan üretildiği kanıtlanamıyordu (güvenlik denetimi bulgusu C9).
Bu depo iki istemcinin ikililerini **aynı commit'ten, sabit araç zinciriyle** kendisi
derler ve kanıtlar.

## Upstream'den farklar

| Değişiklik | Neden |
|---|---|
| `rust-toolchain.toml` (rustc `1.100.0`, sabit) | Kayan `stable` aynı kaynaktan farklı ikili üretir |
| `codegen-units = 1` | Paralel kod üretiminin sırası çıktıyı değiştirmesin |
| wasm-opt kapalı | Ayrıca indirilen, sürümü kilitlenmeyen araç çıktıyı değiştirir |
| `--locked` (cargo) | Bağımlılıklar yalnız `Cargo.lock`'tan |
| Depodaki hazır `.so` / `.a` / xcframework silindi | İkililerin tek kaynağı bu deponun CI'ı |
| Upstream `build.yml` (npm yayımlama) silindi | npm'e yayımlamıyoruz |
| xcframework `Info.plist` sıralanıp yeniden yazılır | `xcodebuild` dilim sırasını rastgele yazıyor; ikililer aynıyken özet değişiyordu |
| `vodozemac =0.11.2` (upstream `0.10`) | RUSTSEC-2026-0510 / 0451 / 0445 düzeltmeleri |
| `.github/workflows/rtw-build.yml` | Aşağıda |
| `.github/workflows/rtw-lock.yml` | `Cargo.lock`'u sabit araç zinciriyle CI'da günceller; depoya yazmaz |

Rust kaynak kodu (`src/`, `crates/vodozemac-ffi/`) upstream'le **aynıdır**. Kaynak
değişikliği gerektiğinde ayrı commit'le, gerekçesiyle yapılır.

## Derleme ve kanıt

`rtw-build` iş akışı her hedefi (wasm, Android 3 ABI, iOS xcframework) **iki ayrı
makinede** derler. İki derlemenin dosya özetleri bayt bayt eşit değilse iş akışı kırmızı
olur ve hiçbir şey yayımlanmaz. Eşitse:

- her dosyanın SHA-256'sı `manifest.json`'a yazılır (kaynak commit, araç sürümleri,
  kilitli crate sürümleriyle birlikte),
- dosyalar GitHub artifact attestation (Sigstore, SLSA provenance) ile imzalanır,
- `rtw-vodozemac-<commit>` artefaktı yüklenir.

## İstemcide doğrulama

```bash
gh run download <run-id> -R muhammedozdmr/rtw-vodozemac-build -n rtw-vodozemac-<commit>
gh attestation verify <dosya> -R muhammedozdmr/rtw-vodozemac-build \
  --source-ref refs/heads/rtw \
  --signer-workflow muhammedozdmr/rtw-vodozemac-build/.github/workflows/rtw-build.yml
```

Kanıt yalnız `rtw` dalı ve `rtw-v*` etiketleri için üretilir. `--source-ref` ve
`--signer-workflow` olmadan doğrulama, başka bir daldan derlenmiş ikiliyi de kabul ederdi.

İstemciler (RateTheWork mobil ve webapp) `manifest.json`'daki özetleri kendi kilit
testlerinde sabitler; ikili değişirse test kırılır.

## Sürüm yükseltme

`vodozemac` / araç zinciri yükseltmesi ayrı bir daldır:

1. Değişiklik günlüğü okunur, `Cargo.toml` gereksinimi tam sürüme (`=x.y.z`) çekilir.
2. `rtw-lock` iş akışı o dalda tetiklenir; kilit farkı okunup elle commit edilir.
3. `advisories` işi kilitteki her paketi OSV/RustSec'te tarar (`scripts/osv-check.py`).
   Kayıt varsa kanıt üretilmez; kabul edilen kayıt yalnız gerekçesiyle eklenir.
4. **Pickle uyumluluğu:** önceki sürümün derlemesi `pickle-compat` artefaktını üretir
   (`scripts/generate-pickle-compat.mjs`); vektör `test-vectors/` altına konur. Yeni
   sürümün derlemesi `test-vectors/` altındaki HER vektörü açıp yazışmayı sürdürmek
   zorundadır (`scripts/verify-pickle-compat.mjs`). Kullanıcıların cihazındaki kimlik ve
   oturumların yükseltmeden sağ çıktığının kanıtı budur.
5. Dal `rtw`'ye birleşir; iki istemcinin manifest kilidi birlikte yenilenir.
