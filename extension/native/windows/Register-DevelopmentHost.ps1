param(
    [Parameter(Mandatory)]
    [ValidateSet('Chrome', 'Edge')]
    [string] $Browser,

    [Parameter(Mandatory)]
    [string] $HelperPath,

    [Parameter(Mandatory)]
    [ValidatePattern('\A[a-p]{32}\z', Options = [Text.RegularExpressions.RegexOptions]::None)]
    [string] $ExtensionId,

    [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$hostName = 'com.idealland.ataraxia_wallpaper'
$browserKey = @{ Chrome = 'Google\Chrome'; Edge = 'Microsoft\Edge' }[$Browser]
$registryRoot = "Software\$browserKey\NativeMessagingHosts"
$registryPath = "HKCU:\$registryRoot\$hostName"
$executable = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($HelperPath)
$directory = [IO.Path]::GetDirectoryName($executable)
$manifestPath = Join-Path $directory "$hostName.development.$($Browser.ToLowerInvariant()).$ExtensionId.json"
$manifest = [ordered]@{
    name = $hostName
    description = 'Ataraxia wallpaper development helper'
    path = $executable
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Compress

$registered = Test-Path -LiteralPath $registryPath
if ($registered -and (Get-Item -LiteralPath $registryPath).GetValue('') -ne $manifestPath) {
    throw "$Browser already has a different per-user registration for $hostName."
}

$manifestExists = [IO.File]::Exists($manifestPath)
if ($manifestExists -and [IO.File]::ReadAllText($manifestPath) -cne $manifest) {
    throw "The manifest path already contains a different file: $manifestPath"
}

if ($Remove) {
    if ($registered) {
        Remove-Item -LiteralPath $registryPath
    }
    if ($manifestExists) {
        [IO.File]::Delete($manifestPath)
    }
    return
}

if (-not [IO.File]::Exists($executable) -or [IO.Path]::GetExtension($executable) -ne '.exe') {
    throw "Build the helper executable before registering it: $executable"
}

if ((Test-Path -LiteralPath "HKLM:\$registryRoot\$hostName") -or
    (Test-Path -LiteralPath "HKLM:\Software\WOW6432Node\$browserKey\NativeMessagingHosts\$hostName")) {
    throw "$Browser already has a machine-wide registration for $hostName."
}

$createdManifest = $false
try {
    if (-not $manifestExists) {
        $file = [IO.File]::Open($manifestPath, [IO.FileMode]::CreateNew)
        $createdManifest = $true
        try {
            $bytes = [Text.Encoding]::UTF8.GetBytes($manifest)
            $file.Write($bytes, 0, $bytes.Length)
        } finally {
            $file.Dispose()
        }
    }
    if (-not $registered) {
        [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($registryRoot).Dispose()
        New-Item -Path $registryPath -Value $manifestPath | Out-Null
    }
} catch {
    if ($createdManifest) {
        [IO.File]::Delete($manifestPath)
    }
    throw
}
$manifestPath
