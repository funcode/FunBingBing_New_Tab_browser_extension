param([string] $Restore)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class DesktopWallpaperProbe
{
    [ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDesktopWallpaper
    {
        void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitor,
                          [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
        void GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitor,
                          [MarshalAs(UnmanagedType.LPWStr)] out string wallpaper);
        void GetMonitorDevicePathAt(uint index, [MarshalAs(UnmanagedType.LPWStr)] out string monitor);
        void GetMonitorDevicePathCount(out uint count);
        [PreserveSig] int GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitor, out Rect rect);
        void SetBackgroundColor(uint color);
        void GetBackgroundColor(out uint color);
        void SetPosition(int position);
        void GetPosition(out int position);
        void SetSlideshow(IntPtr items);
        void GetSlideshow(out IntPtr items);
        void SetSlideshowOptions(uint options, uint tick);
        void GetSlideshowOptions(out uint options, out uint tick);
        void AdvanceSlideshow([MarshalAs(UnmanagedType.LPWStr)] string monitor, int direction);
        void GetStatus(out uint status);
    }

    public struct Rect { public int Left, Top, Right, Bottom; }
    public sealed class Display { public string Id, File; }
    public sealed class Desktop { public int Position; public uint Status; public List<Display> Displays = new List<Display>(); }
    private static IDesktopWallpaper Connect()
    {
        return (IDesktopWallpaper)Activator.CreateInstance(
            Type.GetTypeFromCLSID(new Guid("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD")));
    }

    public static Desktop Read()
    {
        var api = Connect();
        try
        {
            var desktop = new Desktop();
            api.GetPosition(out desktop.Position);
            api.GetStatus(out desktop.Status);
            uint count;
            api.GetMonitorDevicePathCount(out count);
            for (uint i = 0; i < count; i++)
            {
                var display = new Display();
                api.GetMonitorDevicePathAt(i, out display.Id);
                Rect rect;
                int result = api.GetMonitorRECT(display.Id, out rect);
                if (result != 0) continue;
                api.GetWallpaper(display.Id, out display.File);
                desktop.Displays.Add(display);
            }
            return desktop;
        }
        finally { Marshal.ReleaseComObject(api); }
    }

    public static void Restore(int position, string[] ids, string[] files)
    {
        var api = Connect();
        try
        {
            api.SetPosition(4);
            for (int i = 0; i < ids.Length; i++) api.SetWallpaper(ids[i], files[i]);
            api.SetPosition(position);
        }
        finally { Marshal.ReleaseComObject(api); }
    }
}
'@

if ($Restore) {
    $desktop = Get-Content -LiteralPath $Restore -Raw -Encoding UTF8 | ConvertFrom-Json
    [DesktopWallpaperProbe]::Restore($desktop.Position, $desktop.Displays.Id, $desktop.Displays.File)
}
Add-Type -AssemblyName System.Windows.Forms
$current = [DesktopWallpaperProbe]::Read()
if ($current.Displays.Count -ne [Windows.Forms.Screen]::AllScreens.Length) {
    throw 'Windows did not return a wallpaper path for every active display.'
}
$current | ConvertTo-Json -Depth 4 -Compress
