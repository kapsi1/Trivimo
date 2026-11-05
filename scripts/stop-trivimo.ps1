$ErrorActionPreference = 'Stop'

# Zatrzymuje lokalne API (3000) i serwer Vite (5173), jesli dzialaja.
# Zabija cale drzewo procesow od najwyzszego rodzica node.exe (np. tsx watch / pnpm),
# zeby watcher nie uruchomil serwera ponownie.

function Get-RootNodeProcess([int]$processId) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
    while ($current) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ParentProcessId)" -ErrorAction SilentlyContinue
        if (-not $parent -or $parent.Name -ne 'node.exe') { break }
        $current = $parent
    }
    return $current
}

$stopped = 0
foreach ($port in @(3000, 5173)) {
    $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    if (-not $owners) {
        Write-Output "Port ${port}: nic nie nasluchuje."
        continue
    }
    foreach ($owner in $owners) {
        $root = Get-RootNodeProcess $owner
        if (-not $root) { continue }
        Write-Output "Port ${port}: zatrzymuje $($root.Name) (PID $($root.ProcessId)) wraz z procesami potomnymi."
        & taskkill.exe /PID $root.ProcessId /T /F | Out-Null
        $stopped++
    }
}

if ($stopped -eq 0) { Write-Output 'Serwery Trivimo nie byly uruchomione.' }
