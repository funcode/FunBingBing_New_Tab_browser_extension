# Verify the Windows desktop wallpaper helper

Run the following commands from the extension root in Windows PowerShell. The build uses the .NET Framework C# compiler that ships with Windows.

```powershell
$output = Join-Path $env:TEMP "ataraxia-wallpaper-$([Guid]::NewGuid())"
$helper = powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\native\windows\Build-Helper.ps1 -OutputDirectory $output
node .\tests\manual\windows-wallpaper-host.mjs $helper
```

To exercise Setup in Chromium with a disposable profile, run `node .\tests\manual\windows-wallpaper-setup.mjs`. The test seeds native messaging permission, restores the production manifest, and records the real helper and silent host process results in `output/native-acceptance/wallpaper-setup.json`.

## Connect the unpacked extension

Load the extension unpacked from `chrome://extensions` or `edge://extensions` and copy its ID. Enter that ID for `$id` and select the corresponding browser for `$browser`.

```powershell
$id = Read-Host 'Unpacked extension ID'
$browser = 'Chrome' # Use 'Edge' for Microsoft Edge.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\native\windows\Register-DevelopmentHost.ps1 -Browser $browser -HelperPath $helper -ExtensionId $id
```

The script registers one allowed origin under the selected browser's current-user Native Messaging registry key. It refuses to replace an existing registration at that key or shadow a machine-wide registration for the selected browser. The manifest points at the built executable in `$output`. [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging).

In Ataraxia Setup, turn on desktop wallpaper integration and allow the native messaging permission when prompted. **Check again** starts another verification. After testing, remove the development registration with the same browser, helper path, and extension ID.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\native\windows\Register-DevelopmentHost.ps1 -Browser $browser -HelperPath $helper -ExtensionId $id -Remove
Remove-Item -LiteralPath $output -Recurse
```

If you registered both browsers, remove each registration before deleting the build directory. Production installation and published extension origins are tracked in [#163](https://github.com/funcode/FunBingBing/issues/163).

## Protocol version 1

The host name is `com.idealland.ataraxia_wallpaper`. Windows frames each UTF-8 JSON payload with a four-byte little-endian byte count. Each host process reads one request of up to 1,024 bytes for verification, writes the response to stdout, flushes it, and exits. Unsupported requests and malformed or incomplete frames receive no reply.

Setup sends this request.

```json
{"type":"verify","protocolVersion":1}
```

The verification response identifies compatibility for that request.

```json
{"type":"compatibility","protocolVersion":1,"compatible":true}
```

The desktop operation will send `{"type":"apply","protocolVersion":1,"path":"C:\\Users\\Example\\Downloads\\wallpaper.jpg"}` as the first request on its own connection. The path comes from the completed browser download. An apply-capable host starts its reply with compatibility on that connection. It then reports acceptance after obtaining the same-user operation lock and validating the saved file, followed by a terminal result. Busy and pre-acceptance failures can go straight to the terminal result. Compatibility for `verify` applies to Setup verification. The current Windows host implements `verify`; the apply operation is tracked in [#157](https://github.com/funcode/FunBingBing/issues/157) and [#158](https://github.com/funcode/FunBingBing/issues/158).

The operation connection provides the compatibility result for that job. Failure to establish compatibility clears Last-known helper availability. After compatibility is established, Busy, OS errors, and a missing terminal reply preserve availability. Save and notification errors also preserve the hint.
