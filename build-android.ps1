# Build aplikasi Android Kasvara POS (APK + AAB bertanda tangan) dengan tampilan terpasang di dalam aplikasi.
# Jalankan:  powershell -ExecutionPolicy Bypass -File <path>\build-android.ps1 -VersionCode 3
# Butuh env UPLOAD_KEYSTORE_PATH, UPLOAD_KEYSTORE_PASSWORD, UPLOAD_KEY_PASSWORD (opsional UPLOAD_KEY_ALIAS).
param(
  [Parameter(Mandatory = $true)][int]$VersionCode,
  [string]$OutDir = "G:\My Drive\Project Aplikasi\Aplikasi POS (Kasira)\Kasira-release"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
foreach ($v in "UPLOAD_KEYSTORE_PATH", "UPLOAD_KEYSTORE_PASSWORD", "UPLOAD_KEY_PASSWORD") {
  if (-not [Environment]::GetEnvironmentVariable($v)) { throw "Env $v belum diisi" }
}
$env:VERSION_CODE = "$VersionCode"

Write-Host "1/3  Menyalin tampilan aplikasi ke proyek Android..." -ForegroundColor Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install gagal" }
npm run android:sync
if ($LASTEXITCODE -ne 0) { throw "cap sync gagal" }

Write-Host "2/3  Build APK dan AAB rilis (versionCode $VersionCode)..." -ForegroundColor Cyan
Push-Location android
.\gradlew.bat assembleRelease bundleRelease
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw "Build Gradle gagal" }

Write-Host "3/3  Menyalin hasil ke $OutDir ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force $OutDir | Out-Null
$name = "kasira-pos-0.2.0-vc$VersionCode"
Copy-Item android\app\build\outputs\apk\release\app-release.apk "$OutDir\$name.apk" -Force
Copy-Item android\app\build\outputs\bundle\release\app-release.aab "$OutDir\$name.aab" -Force
Write-Host "Selesai: $OutDir\$name.apk dan .aab" -ForegroundColor Green
