param(
    [string]$AndroidJar,
    [string]$BuildTools,
    [string]$JavaHome = 'C:\Program Files\Java\jdk-21'
)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $workspace 'artifacts\android-tools'
if (!$AndroidJar) { $AndroidJar = Join-Path $toolsRoot 'platform-36_r02\android-36\android.jar' }
if (!$BuildTools) { $BuildTools = Join-Path $toolsRoot 'build-tools_r36_windows\android-16' }
foreach ($path in @($AndroidJar, (Join-Path $BuildTools 'aapt2.exe'), (Join-Path $JavaHome 'bin\javac.exe'))) {
    if (!(Test-Path -LiteralPath $path)) { throw "Missing build tool: $path. See android/README.md." }
}
function Run-Tool([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build tool failed: $Executable ($LASTEXITCODE)" }
}
$buildRoot = Join-Path $workspace ('artifacts\android-wallpaper\build-' + [guid]::NewGuid().ToString('N').Substring(0, 10))
$sourceRoot = Join-Path $PSScriptRoot 'app\src\main'
foreach ($folder in @($buildRoot, "$buildRoot\classes", "$buildRoot\generated", "$buildRoot\dex", "$buildRoot\tests")) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
}
Push-Location (Join-Path $workspace 'web')
try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Web explorer build failed' } }
finally { Pop-Location }
$webAssets = Join-Path $buildRoot 'web-assets\explorer'
New-Item -ItemType Directory -Path $webAssets -Force | Out-Null
Copy-Item -Path (Join-Path $workspace 'web\dist\*') -Destination $webAssets -Recurse
foreach ($asset in @('cover-arrival.mp4','cover-idle.mp4','inner-arrival.mp4','inner-idle.mp4','cover-poster.png','inner-poster.png')) {
    if (!(Test-Path -LiteralPath (Join-Path $sourceRoot ('assets\' + $asset)))) { throw 'Render assets first: uv run python scripts/render_wallpaper.py' }
}
$java = Join-Path $JavaHome 'bin\java.exe'
$javac = Join-Path $JavaHome 'bin\javac.exe'
$aapt = Join-Path $BuildTools 'aapt2.exe'
$manifestText = (Get-Content -LiteralPath "$sourceRoot\AndroidManifest.xml" -Raw).Replace('<manifest ', '<manifest package="org.fractalexplorer.wallpaper" ')
Set-Content -LiteralPath "$buildRoot\AndroidManifest.xml" -Value $manifestText -Encoding UTF8
Run-Tool $aapt @('compile', '--dir', "$sourceRoot\res", '-o', "$buildRoot\resources.zip")
Run-Tool $aapt @('link', '-o', "$buildRoot\resources.apk", '--manifest', "$buildRoot\AndroidManifest.xml", '-I', $AndroidJar, '--java', "$buildRoot\generated", '-A', "$sourceRoot\assets", '-A', "$buildRoot\web-assets", '-0', 'mp4', '-0', 'png', "$buildRoot\resources.zip")
$sourcePaths = @(Get-ChildItem -LiteralPath "$sourceRoot\java", "$buildRoot\generated" -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName)
$sourcePaths | ForEach-Object { '"' + $_.Replace('\','/') + '"' } | Set-Content -LiteralPath "$buildRoot\sources.txt" -Encoding ascii
Run-Tool $javac @('-source', '8', '-target', '8', '-Xlint:-options', '-bootclasspath', ($AndroidJar + ';' + "$BuildTools\core-lambda-stubs.jar"), '-d', "$buildRoot\classes", "@$buildRoot\sources.txt")
Run-Tool (Join-Path $JavaHome 'bin\jar.exe') @("-J-Djava.io.tmpdir=$buildRoot", '--create', '--file', "$buildRoot\classes.jar", '-C', "$buildRoot\classes", '.')
Run-Tool $java @("-Djava.io.tmpdir=$buildRoot", '-cp', "$BuildTools\lib\d8.jar", 'com.android.tools.r8.D8', '--lib', $AndroidJar, '--min-api', '30', '--output', "$buildRoot\dex", "$buildRoot\classes.jar")
Copy-Item -LiteralPath "$buildRoot\resources.apk" -Destination "$buildRoot\unsigned.apk"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$archive = [System.IO.Compression.ZipFile]::Open("$buildRoot\unsigned.apk", [System.IO.Compression.ZipArchiveMode]::Update)
try {
    # Windows aapt2 may emit backslashes in nested asset names. Android treats those as literal filename characters.
    foreach ($entry in @($archive.Entries)) {
        if ($entry.FullName.StartsWith('assets/') -and $entry.FullName.Contains('\')) {
            $normalized = $entry.FullName.Replace('\','/')
            if ($archive.GetEntry($normalized)) { throw "Duplicate normalized asset: $normalized" }
            $copy = $archive.CreateEntry($normalized, [System.IO.Compression.CompressionLevel]::Optimal)
            $inputStream = $entry.Open()
            $outputStream = $copy.Open()
            try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
            $entry.Delete()
        }
    }
    foreach ($dex in Get-ChildItem -LiteralPath "$buildRoot\dex" -Filter '*.dex') {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $dex.FullName, $dex.Name) | Out-Null
    }
} finally { $archive.Dispose() }
Run-Tool (Join-Path $BuildTools 'zipalign.exe') @('-f', '4', "$buildRoot\unsigned.apk", "$buildRoot\aligned.apk")
$outputRoot = Join-Path $workspace 'artifacts\android-wallpaper'
$keystore = Join-Path $outputRoot 'debug.keystore'
if (!(Test-Path -LiteralPath $keystore)) {
    Run-Tool (Join-Path $JavaHome 'bin\keytool.exe') @('-genkeypair', '-keystore', $keystore, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-keyalg', 'RSA', '-validity', '10000', '-dname', 'CN=Fractal Wallpaper Debug,O=Fractal Explorer,C=AT')
}
$apk = Join-Path $outputRoot 'fractal-wallpaper.apk'
Run-Tool $java @('-jar', "$BuildTools\lib\apksigner.jar", 'sign', '--ks', $keystore, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', $apk, "$buildRoot\aligned.apk")
Run-Tool $java @('-jar', "$BuildTools\lib\apksigner.jar", 'verify', '--verbose', $apk)
Run-Tool $javac @('-d', "$buildRoot\tests", "$sourceRoot\java\org\fractalexplorer\wallpaper\PlaybackState.java", "$PSScriptRoot\tests\PlaybackStateTest.java")
Run-Tool $java @('-cp', "$buildRoot\tests", 'PlaybackStateTest')
Run-Tool $javac @('-d', "$buildRoot\tests", "$sourceRoot\java\org\fractalexplorer\wallpaper\PlaybackState.java", "$sourceRoot\java\org\fractalexplorer\wallpaper\DisplayReveals.java", "$PSScriptRoot\tests\DisplayRevealsTest.java")
Run-Tool $java @('-cp', "$buildRoot\tests", 'org.fractalexplorer.wallpaper.DisplayRevealsTest')
Run-Tool $javac @('-d', "$buildRoot\tests", "$sourceRoot\java\org\fractalexplorer\wallpaper\ShufflePolicy.java", "$PSScriptRoot\tests\ShufflePolicyTest.java")
Run-Tool $java @('-cp', "$buildRoot\tests", 'org.fractalexplorer.wallpaper.ShufflePolicyTest')
Run-Tool $javac @('-d', "$buildRoot\tests", "$sourceRoot\java\org\fractalexplorer\wallpaper\PackPolicy.java", "$PSScriptRoot\tests\PackPolicyTest.java")
Run-Tool $java @('-cp', "$buildRoot\tests", 'org.fractalexplorer.wallpaper.PackPolicyTest', $buildRoot)
Run-Tool $javac @('-d', "$buildRoot\tests", "$sourceRoot\java\org\fractalexplorer\wallpaper\NativeWorkQueue.java", "$PSScriptRoot\tests\NativeWorkQueueTest.java")
Run-Tool $java @('-cp', "$buildRoot\tests", 'org.fractalexplorer.wallpaper.NativeWorkQueueTest')
Run-Tool $javac @('-cp', "$buildRoot\classes;$AndroidJar", '-d', "$buildRoot\tests", "$PSScriptRoot\tests\GalleryPreferencesTest.java")
Run-Tool $java @('-cp', "$buildRoot\tests;$buildRoot\classes;$AndroidJar", 'org.fractalexplorer.wallpaper.GalleryPreferencesTest')
Write-Output "APK ready: $apk"
