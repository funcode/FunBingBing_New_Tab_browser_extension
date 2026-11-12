param(
    [Parameter(Mandatory)]
    [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'

$framework = Join-Path $env:WINDIR 'Microsoft.NET'
$compiler = Join-Path $framework 'Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
    $compiler = Join-Path $framework 'Framework\v4.0.30319\csc.exe'
}

$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
[IO.Directory]::CreateDirectory($output) | Out-Null
$executable = Join-Path $output 'ataraxia-wallpaper-host.exe'
$source = Join-Path $PSScriptRoot 'WallpaperHost.cs'
$arguments = @('/nologo', '/target:exe', '/platform:anycpu', '/optimize+', "/out:`"$executable`"", "`"$source`"")
$process = Start-Process -FilePath $compiler -ArgumentList $arguments -NoNewWindow -Wait -PassThru
if ($process.ExitCode -ne 0) {
    throw "Helper compilation failed with exit code $($process.ExitCode)."
}
$executable
