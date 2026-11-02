$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../../health-sync/app/src/main/java/pl/healthsync/domain'
$cache = Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1'
$java = 'C:/Program Files/Android/Android Studio/jbr/bin/java.exe'
$names = @('kotlin-compiler-embeddable-2.0.21.jar', 'kotlin-stdlib-2.0.21.jar', 'kotlin-script-runtime-2.0.21.jar', 'kotlin-reflect-1.6.10.jar', 'trove4j-1.0.20200330.jar', 'kotlinx-coroutines-core-jvm-1.6.4.jar', 'annotations-13.0.jar')
$jars = foreach ($name in $names) {
    $jar = Get-ChildItem -Path $cache -Filter $name -File -Recurse | Select-Object -First 1
    if (-not $jar) { throw "Brak zależności próby: $name" }
    $jar.FullName
}
if (-not (Test-Path -LiteralPath $java)) { throw 'Brak Java z Android Studio' }
$classpath = $jars -join ';'
$stdlib = $jars[1]
$output = Join-Path $PSScriptRoot '../node_modules/.cache/takeout-spike'
New-Item -ItemType Directory -Force -Path $output | Out-Null
& $java -cp $classpath (Join-Path $PSScriptRoot '../tests/spikes/KotlinCompilerLauncher.java') -no-stdlib -no-reflect -classpath $stdlib -d $output (Join-Path $source 'TakeoutCsv.kt') (Join-Path $source 'TakeoutRecords.kt') (Join-Path $source 'TakeoutActivityCsv.kt') (Join-Path $source 'TakeoutActivityEstimate.kt') (Join-Path $PSScriptRoot '../tests/spikes/TakeoutParserSpike.kt')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $java -cp "$output;$stdlib" pl.healthsync.domain.TakeoutParserSpikeKt
exit $LASTEXITCODE
