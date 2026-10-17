# Deploy Zidny POS ke Cloudflare Pages (situs + API + database D1).
# Jalankan dari folder mana saja:  powershell -ExecutionPolicy Bypass -File <path>\deploy.ps1
# Aman dijalankan berulang: skema memakai CREATE IF NOT EXISTS.
param([string]$OwnerEmail = "")

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "1/3  Menyiapkan tabel database (D1 kasira-db)..." -ForegroundColor Cyan
npx wrangler d1 execute kasira-db --remote --file schema.sql --yes
if ($LASTEXITCODE -ne 0) { throw "Gagal menyiapkan database" }

if ($OwnerEmail) {
  Write-Host "2/3  Menyimpan email Pemilik Aplikasi sebagai secret..." -ForegroundColor Cyan
  $OwnerEmail | npx wrangler pages secret put OWNER_EMAIL --project-name kasira
  if ($LASTEXITCODE -ne 0) { throw "Gagal menyimpan OWNER_EMAIL" }
} else {
  Write-Host "2/3  OWNER_EMAIL dilewati (tidak diberikan)." -ForegroundColor DarkGray
}

Write-Host "3/3  Mengunggah situs dan API..." -ForegroundColor Cyan
npx wrangler pages deploy --project-name kasira --branch main --commit-dirty=true
if ($LASTEXITCODE -ne 0) { throw "Deploy gagal" }

Write-Host "Selesai. Buka https://kasira-c70.pages.dev" -ForegroundColor Green
