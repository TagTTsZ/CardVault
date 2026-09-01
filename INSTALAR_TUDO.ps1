Write-Host "CardVault - instalação" -ForegroundColor Cyan
Write-Host ""
Write-Host "1/3 Instalando dependências..."
npm.cmd install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "2/3 Sincronizando catálogo completo e imagens..."
npm.cmd run sync-all
if ($LASTEXITCODE -ne 0) {
  Write-Host "A sincronização encontrou um erro. Leia a mensagem acima." -ForegroundColor Yellow
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "3/3 Verificando banco..."
npm.cmd run verify

Write-Host ""
Write-Host "Pronto. Configure o .env para PayPal e rode: npm.cmd start" -ForegroundColor Green
