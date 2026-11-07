param([string]$JavaHome='C:\Program Files\Java\jdk-21')
$ErrorActionPreference='Stop'
$workspace=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tools=Join-Path $workspace 'artifacts\android-tools\build-tools_r36_windows\android-16'
$platform=Join-Path $workspace 'artifacts\android-tools\platform-36_r02\android-36\android.jar'
$build=Join-Path $workspace ('artifacts\android-wallpaper\device-tests-'+[guid]::NewGuid().ToString('N').Substring(0,8))
foreach($folder in @($build,"$build\classes","$build\dex")){New-Item -ItemType Directory -Force -Path $folder|Out-Null}
function Run([string]$exe,[string[]]$arguments){& $exe @arguments;if($LASTEXITCODE-ne 0){throw "Test build failed: $exe"}}
Run "$tools\aapt2.exe" @('link','-o',"$build\resources.apk",'--manifest',"$PSScriptRoot\device\AndroidManifest.xml",'-I',$platform)
Run "$JavaHome\bin\javac.exe" (@('-source','8','-target','8','-Xlint:-options','-bootclasspath',($platform+';'+"$tools\core-lambda-stubs.jar"),'-d',"$build\classes") + @(Get-ChildItem -LiteralPath "$PSScriptRoot\device" -Filter '*.java' | Select-Object -ExpandProperty FullName))
Run "$JavaHome\bin\jar.exe" @("-J-Djava.io.tmpdir=$build",'--create','--file',"$build\tests.jar",'-C',"$build\classes",'.')
Run "$JavaHome\bin\java.exe" @('-cp',"$tools\lib\d8.jar",'com.android.tools.r8.D8','--lib',$platform,'--min-api','30','--output',"$build\dex","$build\tests.jar")
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$archive=[System.IO.Compression.ZipFile]::Open("$build\resources.apk",[System.IO.Compression.ZipArchiveMode]::Update)
try{[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,"$build\dex\classes.dex",'classes.dex')|Out-Null}finally{$archive.Dispose()}
Run "$tools\zipalign.exe" @('-f','4',"$build\resources.apk","$build\aligned.apk")
$apk=Join-Path $workspace 'artifacts\android-wallpaper\fractal-wallpaper-tests.apk'
Run "$JavaHome\bin\java.exe" @('-jar',"$tools\lib\apksigner.jar",'sign','--ks',"$workspace\artifacts\android-wallpaper\debug.keystore",'--ks-pass','pass:android','--key-pass','pass:android','--out',$apk,"$build\aligned.apk")
Write-Output "Device test APK: $apk"
