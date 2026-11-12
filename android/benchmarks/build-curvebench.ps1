param([string]$JavaHome='C:\Program Files\Java\jdk-21')
$ErrorActionPreference='Stop'
$workspace=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tools=Join-Path $workspace 'artifacts\android-tools\build-tools_r36_windows\android-16'
$platform=Join-Path $workspace 'artifacts\android-tools\platform-36_r02\android-36\android.jar'
$output=Join-Path $workspace 'artifacts\curvebench'
$assets=Join-Path $output 'assets'
$build=Join-Path $output ('build-'+[guid]::NewGuid().ToString('N').Substring(0,8))
foreach($folder in @($output,$assets,$build,"$build\classes","$build\dex","$build\tests")){New-Item -ItemType Directory -Force -Path $folder|Out-Null}
function Run([string]$exe,[string[]]$arguments){& $exe @arguments;if($LASTEXITCODE-ne 0){throw "Benchmark build failed: $exe"}}
foreach($profile in @(@('cover',1080,2520,'cover-idle.mp4'),@('main',2256,2504,'inner-idle.mp4'),@('verify',96,128,'inner-idle.mp4'))){
  foreach($rate in @(15,30)){
    $suffix=if($rate -eq 15){''}else{'-30'}
    $destination=Join-Path $assets ($profile[0]+$suffix+'.mp4')
    Run 'ffmpeg.exe' @('-hide_banner','-loglevel','error','-nostdin','-y','-i',"$workspace\android\app\src\main\assets\$($profile[3])",'-t','2','-an','-vf',"scale=$($profile[1]):$($profile[2]):flags=lanczos,fps=$rate,setsar=1",'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-g',"$($rate*2)",'-movflags','+faststart',$destination)
  }
}
Run "$JavaHome\bin\javac.exe" @('-d',"$build\tests","$PSScriptRoot\curvebench\BenchMath.java","$PSScriptRoot\curvebench\BenchMathTest.java")
Run "$JavaHome\bin\java.exe" @('-cp',"$build\tests",'org.fractalexplorer.curvebench.BenchMathTest')
Run "$tools\aapt2.exe" @('link','-o',"$build\resources.apk",'--manifest',"$PSScriptRoot\curvebench\AndroidManifest.xml",'-I',$platform,'-A',$assets,'-0','mp4')
$sources=@('BenchMath.java','CurveGl.java','BenchActivity.java')|ForEach-Object{"$PSScriptRoot\curvebench\$_"}
Run "$JavaHome\bin\javac.exe" (@('-source','8','-target','8','-Xlint:-options','-bootclasspath',($platform+';'+"$tools\core-lambda-stubs.jar"),'-d',"$build\classes")+$sources)
Run "$JavaHome\bin\jar.exe" @("-J-Djava.io.tmpdir=$build",'--create','--file',"$build\classes.jar",'-C',"$build\classes",'.')
Run "$JavaHome\bin\java.exe" @('-cp',"$tools\lib\d8.jar",'com.android.tools.r8.D8','--lib',$platform,'--min-api','30','--output',"$build\dex","$build\classes.jar")
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$archive=[System.IO.Compression.ZipFile]::Open("$build\resources.apk",[System.IO.Compression.ZipArchiveMode]::Update)
try{[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,"$build\dex\classes.dex",'classes.dex')|Out-Null}finally{$archive.Dispose()}
Run "$tools\zipalign.exe" @('-f','4',"$build\resources.apk","$build\aligned.apk")
$apk=Join-Path $output 'fractal-playback-benchmark-1.0.apk'
Run "$JavaHome\bin\java.exe" @('-jar',"$tools\lib\apksigner.jar",'sign','--ks',"$workspace\artifacts\android-wallpaper\debug.keystore",'--ks-pass','pass:android','--key-pass','pass:android','--out',$apk,"$build\aligned.apk")
Run "$JavaHome\bin\java.exe" @('-jar',"$tools\lib\apksigner.jar",'verify','--verbose',$apk)
Write-Output "Benchmark APK: $apk"
