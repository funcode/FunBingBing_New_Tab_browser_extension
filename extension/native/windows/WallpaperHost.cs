using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static class WallpaperHost
{
    private const int MaxRequestBytes = 1024;
    private const int SM_CMONITORS = 80;
    private const string JsonWhitespace = @"[ \t\r\n]*";
    private const string MemberSeparator = JsonWhitespace + ":" + JsonWhitespace;
    private const string VerifyMember = @"""type""" + MemberSeparator + @"""verify""";
    private const string ApplyMember = @"""type""" + MemberSeparator + @"""apply""";
    private const string VersionMember = @"""protocolVersion""" + MemberSeparator + "1";
    private const string PathMember = @"""path""" + MemberSeparator +
        @"""(?<path>(?:[^""\\\x00-\x1f]|\\(?:[""\\/bfnrt]|u[0-9a-fA-F]{4}))*)""";
    private const string Comma = JsonWhitespace + "," + JsonWhitespace;
    private const string ObjectStart = @"\A" + JsonWhitespace + @"\{" + JsonWhitespace;
    private const string ObjectEnd = JsonWhitespace + @"\}" + JsonWhitespace + @"\z";
    private const string ApplyField = "(?:(?<type>" + ApplyMember +
        ")|(?<version>" + VersionMember + ")|" + PathMember + ")";
    private const string Compatibility =
        @"{""type"":""compatibility"",""protocolVersion"":1,""compatible"":true,""canApplyWallpaper"":true}";
    private const string Accepted = @"{""type"":""accepted""}";

    private static readonly Regex VerifyRequest = new Regex(
        ObjectStart + "(?:" + VerifyMember + Comma + VersionMember + "|" +
        VersionMember + Comma + VerifyMember + ")" + ObjectEnd);
    private static readonly Regex ApplyRequest = new Regex(
        ObjectStart + ApplyField + Comma + ApplyField + Comma + ApplyField + ObjectEnd);
    private static readonly Regex JsonEscape = new Regex(@"\\(?:u[0-9a-fA-F]{4}|.)");
    private static readonly Regex AbsoluteFilePath = new Regex(
        @"\A(?:[a-z]:\\|\\\\[^\\.?][^\\?]*\\(?!(?:pipe|mailslot)\\)[^\\]+\\).+",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex DeviceName = new Regex(
        @"\\(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9\u00b9\u00b2\u00b3]) *(?:[.\\]|$)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

    [STAThread]
    public static int Main()
    {
        try
        {
            using (var input = new BinaryReader(Console.OpenStandardInput()))
            {
                return Run(input, WriteFrame, ApplyDesktop, WatchConnection);
            }
        }
        catch (EndOfStreamException)
        {
            return 1;
        }
        catch (IOException)
        {
            return 0;
        }
        catch (DecoderFallbackException)
        {
            return 1;
        }
    }

    internal static int Run(BinaryReader input, Action<string> reply, Func<string, string> apply,
        Action watchConnection = null)
    {
        int length = input.ReadInt32();
        if (length < 1 || length > MaxRequestBytes)
        {
            return 1;
        }

        byte[] message = input.ReadBytes(length);
        if (message.Length != length)
        {
            return 1;
        }

        string request = Utf8.GetString(message);
        if (VerifyRequest.IsMatch(request))
        {
            reply(Compatibility);
            return 0;
        }

        Match match = ApplyRequest.Match(request);
        if (!match.Success || match.Groups["type"].Captures.Count != 1 ||
            match.Groups["version"].Captures.Count != 1 || match.Groups["path"].Captures.Count != 1)
        {
            return 1;
        }

        if (watchConnection != null)
        {
            watchConnection();
        }
        reply(Compatibility);
        string path = JsonEscape.Replace(match.Groups["path"].Value, DecodeEscape);
        string status = "file-error";
        using (FileStream file = OpenSavedFile(path))
        {
            if (file != null && IsReadableImage(file))
            {
                reply(Accepted);
                status = apply(file.Name);
            }
        }
        reply(@"{""type"":""result"",""status"":""" + status + @"""}");
        return 0;
    }

    private static string DecodeEscape(Match escape)
    {
        char token = escape.Value[1];
        return token == 'u'
            ? ((char)int.Parse(escape.Value.Substring(2), NumberStyles.HexNumber, CultureInfo.InvariantCulture)).ToString()
            : "\"\\/\b\f\n\r\t"["\"\\/bfnrt".IndexOf(token)].ToString();
    }

    private static FileStream OpenSavedFile(string path)
    {
        path = path.Replace('/', '\\');
        if (!AbsoluteFilePath.IsMatch(path) || DeviceName.IsMatch(path) || path.IndexOf(':', 2) >= 0)
        {
            return null;
        }

        try
        {
            Utf8.GetByteCount(path);
            if (string.Equals(path, Path.GetFullPath(path), StringComparison.Ordinal))
            {
                return File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            }
        }
        catch (ArgumentException) { }
        catch (NotSupportedException) { }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }

        return null;
    }

    private static bool IsReadableImage(FileStream file)
    {
        try
        {
            using (Image image = Image.FromStream(file, false, true))
            {
                return image.RawFormat.Equals(ImageFormat.Jpeg) || image.RawFormat.Equals(ImageFormat.Png);
            }
        }
        catch (ArgumentException) { return false; }
        catch (ExternalException) { return false; }
        catch (IOException) { return false; }
        catch (OutOfMemoryException) { return false; }
    }

    private static string ApplyDesktop(string path)
    {
        IDesktopWallpaper desktop = null;
        try
        {
            var classId = new Guid("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD");
            desktop = (IDesktopWallpaper)Activator.CreateInstance(Type.GetTypeFromCLSID(classId));
            return ApplyToDisplays(desktop, path, GetSystemMetrics(SM_CMONITORS));
        }
        catch (COMException)
        {
            return "failed";
        }
        finally
        {
            if (desktop != null)
            {
                Marshal.ReleaseComObject(desktop);
            }
        }
    }

    internal static string ApplyToDisplays(IDesktopWallpaper desktop, string path, int activeMonitorCount)
    {
        const int S_OK = 0;
        const int S_FALSE = 1;
        const int E_FAIL = unchecked((int)0x80004005);

        uint count;
        if (desktop.GetMonitorDevicePathCount(out count) != S_OK)
        {
            return "failed";
        }

        var connected = new List<string>();
        bool incomplete = false;
        bool failedRectangle = false;
        for (uint index = 0; index < count; index++)
        {
            string monitor;
            if (desktop.GetMonitorDevicePathAt(index, out monitor) != S_OK || string.IsNullOrEmpty(monitor))
            {
                incomplete = true;
                continue;
            }

            MonitorRect rectangle;
            int attached = desktop.GetMonitorRECT(monitor, out rectangle);
            if (attached == S_OK)
            {
                connected.Add(monitor);
            }
            else if (attached == E_FAIL)
            {
                failedRectangle = true;
            }
            else if (attached != S_FALSE)
            {
                incomplete = true;
            }
        }

        if (connected.Count == 0)
        {
            return "failed";
        }

        // Windows can return E_FAIL for a stale monitor entry. Check the active display count.
        incomplete |= failedRectangle && (activeMonitorCount <= 0 || connected.Count < activeMonitorCount);
        // Leave Span before assigning a separate image to each monitor.
        int fill = desktop.SetPosition(WallpaperPosition.Fill);
        incomplete |= fill != S_OK && fill != S_FALSE;
        bool changed = fill == S_OK;
        foreach (string monitor in connected)
        {
            bool applied = desktop.SetWallpaper(monitor, path) == S_OK;
            changed |= applied;
            incomplete |= !applied;
        }

        return !incomplete ? "applied" : changed ? "partial" : "failed";
    }

    private static void WatchConnection()
    {
        const int StdInputHandle = -10;
        IntPtr input = GetStdHandle(StdInputHandle);
        new Thread(() =>
        {
            var buffer = new byte[256];
            int read;
            while (ReadFile(input, buffer, buffer.Length, out read, IntPtr.Zero) && read > 0)
            {
                // This host processes one request per connection.
            }

            // A stalled Windows call can outlive the browser connection.
            TerminateProcess(GetCurrentProcess(), 0);
        }) { IsBackground = true }.Start();
    }

    private static void WriteFrame(string message)
    {
        byte[] payload = Utf8.GetBytes(message);
        byte[] frame = new byte[sizeof(int) + payload.Length];
        Buffer.BlockCopy(BitConverter.GetBytes(payload.Length), 0, frame, 0, sizeof(int));
        Buffer.BlockCopy(payload, 0, frame, sizeof(int), payload.Length);

        // .NET Framework's console stream swallows broken-pipe writes.
        const int StdOutputHandle = -11;
        int written;
        if (!WriteFile(GetStdHandle(StdOutputHandle), frame, frame.Length, out written, IntPtr.Zero) ||
            written != frame.Length)
        {
            throw new IOException("The native messaging connection is closed.");
        }
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int handle);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WriteFile(IntPtr file, byte[] buffer, int length, out int written, IntPtr overlapped);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReadFile(IntPtr file, byte[] buffer, int length, out int read, IntPtr overlapped);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);
}

[StructLayout(LayoutKind.Sequential)]
internal struct MonitorRect
{
    public int Left, Top, Right, Bottom;
}

internal enum WallpaperPosition
{
    Fill = 4
}

[ComImport]
[Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IDesktopWallpaper
{
    [PreserveSig]
    int SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitor, [MarshalAs(UnmanagedType.LPWStr)] string path);
    [PreserveSig]
    int GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitor, [MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig]
    int GetMonitorDevicePathAt(uint index, [MarshalAs(UnmanagedType.LPWStr)] out string monitor);
    [PreserveSig]
    int GetMonitorDevicePathCount(out uint count);
    [PreserveSig]
    int GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitor, out MonitorRect rectangle);
    [PreserveSig]
    int SetBackgroundColor(uint color);
    [PreserveSig]
    int GetBackgroundColor(out uint color);
    [PreserveSig]
    int SetPosition(WallpaperPosition position);
}
