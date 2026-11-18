# Verify the Windows desktop wallpaper helper

Run the following commands from the extension root in Windows PowerShell. The build uses the .NET Framework C# compiler that ships with Windows.

```powershell
$output = Join-Path $env:TEMP "ataraxia-wallpaper-$([Guid]::NewGuid())"
$helper = powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\native\windows\Build-Helper.ps1 -OutputDirectory $output
node .\tests\manual\windows-wallpaper-host.mjs $helper
```

To check result handling without changing the desktop, run the controlled display checks in Windows PowerShell. They exercise Fill already being set, a Fill error, a display error, disconnected monitors, and a closed connection before acceptance.

```powershell
Add-Type -Path .\native\windows\WallpaperHost.cs, .\native\windows\WallpaperHostChecks.cs -ReferencedAssemblies System.Drawing.dll, System.Core.dll
[WallpaperHostChecks]::Run($output)
```

To exercise Setup in Chromium with a disposable profile, run `node .\tests\manual\windows-wallpaper-setup.mjs`. The test seeds native messaging permission, restores the production manifest, and records the real helper and silent host process results in `output/native-acceptance/wallpaper-setup.json`.

Run `node .\tests\manual\windows-wallpaper-apply.mjs` from an interactive Windows session with a static wallpaper. The test temporarily changes the wallpaper, verifies the saved image path and Fill on each connected display, then restores the original wallpaper. It also runs a test build that pauses after acceptance so it can close the source tab before the Windows calls. It records both results in `output/native-acceptance/wallpaper-apply.json`.

Run the Windows outcome check with Chrome, Windows Node, and the project's Playwright dependency installed.

```powershell
node .\tests\manual\windows-wallpaper-outcomes.mjs
```

The check uses a disposable Chrome profile, a test-specific native host registration, and a controlled pause in place of the Windows wallpaper API call. It verifies standalone downloads during a pending desktop apply and rejection of corrupt or missing images. It forces Chrome to launch the helper through cmd.exe, verifies that the stalled helper exits after the 30-second deadline, and checks an explicit retry. Results are recorded in `output/native-acceptance/wallpaper-outcomes.json` for reuse in [#163](https://github.com/funcode/FunBingBing/issues/163).

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

The host name is `com.idealland.ataraxia_wallpaper`. Windows frames each UTF-8 JSON payload with a four-byte little-endian byte count. Each host process reads one request of up to 1,024 bytes, writes its framed replies to stdout, and exits. Unsupported requests and malformed or incomplete frames receive no reply.

Setup sends this request.

```json
{"type":"verify","protocolVersion":1}
```

The compatibility response must advertise `canApplyWallpaper: true`.

```json
{"type":"compatibility","protocolVersion":1,"compatible":true,"canApplyWallpaper":true}
```

The desktop action opens a separate native connection and sends the completed browser download's absolute filename.

```json
{"type":"apply","protocolVersion":1,"path":"C:\\Users\\Example\\Downloads\\wallpaper.jpg"}
```

The host sends the same compatibility reply on that connection. It validates the saved JPEG or PNG and returns a terminal result with status `file-error` if it cannot open or decode the image. Otherwise it sends `{"type":"accepted"}` before changing the desktop. The terminal frame is `{"type":"result","status":"applied"}` on complete success. Status `partial` means Windows reported a change but some part of the operation failed. Status `failed` means Windows did not confirm any change. The host uses the saved image in place and leaves it on disk.

The worker waits up to five seconds for compatibility and up to 30 seconds after compatibility for the terminal result. A missing terminal result after compatibility ends the pending operation, closes the native port, and shows the unconfirmed result. The helper watches native input during the apply request and terminates itself if the browser disconnects while the helper is stalled.

The operation connection provides the compatibility result for that job. Failure to establish compatibility clears Last-known helper availability. After compatibility is established, OS errors and a missing terminal reply preserve availability. Save and notification errors also preserve the hint.
