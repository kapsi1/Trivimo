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

function Stop-Tree($process) {
    if ($process -and -not $process.HasExited) {
        & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
    }
}

foreach ($port in @(3000, 5173)) {
    if (Test-LocalPort $port) { throw "Port $port jest zajety. Zamknij poprzednia instancje Trivimo (stop-trivimo.cmd) i sprobuj ponownie." }
}

# Oba serwery pisza logi do tego samego okna konsoli. Ctrl+C zatrzymuje oba.
$server = $null
$web = $null
try {
    $server = Start-Process -FilePath $node.Source -ArgumentList @('--import', 'tsx', 'apps/server/index.ts') -WorkingDirectory $project -NoNewWindow -PassThru
    $web = Start-Process -FilePath $node.Source -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--clearScreen', 'false') -WorkingDirectory $project -NoNewWindow -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ((Test-LocalPort 3000) -and (Test-LocalPort 5173)) { $ready = $true; break }
        if ($server.HasExited -or $web.HasExited) { break }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw 'Nie udalo sie uruchomic Trivimo. Sprawdz logi powyzej oraz instalacje Node i zaleznosci.' }

    Write-Output ''
    Write-Output 'Trivimo dziala pod adresem http://localhost:5173/  (Ctrl+C zatrzymuje oba serwery)'
    Write-Output ''

    while (-not $server.HasExited -and -not $web.HasExited) { Start-Sleep -Milliseconds 500 }
    $which = if ($server.HasExited) { 'API (port 3000)' } else { 'Vite (port 5173)' }
    throw "Serwer $which zakonczyl dzialanie. Zatrzymuje pozostaly."
} finally {
    Stop-Tree $server
    Stop-Tree $web
}
