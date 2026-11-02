$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$node = Get-Command node.exe -ErrorAction Stop

function Test-LocalPort([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync('127.0.0.1', $port)
        if (-not $task.Wait(500)) { return $false }
        return $client.Connected
    } catch { return $false } finally { $client.Dispose() }
}

foreach ($port in @(3000, 5173)) {
    if (Test-LocalPort $port) { throw "Port $port jest zajety. Zamknij poprzednia instancje Trivimo i sprobuj ponownie." }
}

$server = Start-Process -FilePath $node.Source -ArgumentList @('--import', 'tsx', 'apps/server/index.ts') -WorkingDirectory $project -WindowStyle Hidden -PassThru
$web = Start-Process -FilePath $node.Source -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1') -WorkingDirectory $project -WindowStyle Hidden -PassThru
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ((Test-LocalPort 3000) -and (Test-LocalPort 5173)) {
        Write-Output 'Trivimo dziala pod adresem http://localhost:5173/'
        exit 0
    }
    if ($server.HasExited -or $web.HasExited) { break }
    Start-Sleep -Milliseconds 200
}
if (-not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
if (-not $web.HasExited) { Stop-Process -Id $web.Id -ErrorAction SilentlyContinue }
throw 'Nie udalo sie uruchomic Trivimo. Sprawdz instalacje Node i zaleznosci npm.'
