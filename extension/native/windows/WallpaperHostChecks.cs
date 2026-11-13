using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Text;

public static class WallpaperHostChecks
{
    private const int Failed = unchecked((int)0x80004005);

    public static void Run(string fixtureDirectory)
    {
        string path = Path.Combine(fixtureDirectory, "Ataraxia " + Guid.NewGuid() + " \u5c71.jpg");
        try
        {
            using (var bitmap = new Bitmap(2, 2))
            {
                bitmap.Save(path, ImageFormat.Png);
            }

            CheckDisplays(path, 0, 0, 0, "applied");
            CheckDisplays(path, 1, 0, 0, "applied");
            CheckDisplays(path, Failed, 0, 0, "partial");
            CheckDisplays(path, 1, 0, Failed, "partial");
            CheckDisplays(path, 1, Failed, Failed, "failed");
            CheckDisplays(path, 0, Failed, Failed, "partial");

            var detached = new TestDesktop(path, 0, 0, 0) { AllDetached = true };
            Require(WallpaperHost.ApplyToDisplays(detached, path, 2) == "failed", "Detached displays must not count as applied.");
            Require(detached.Writes.Count == 0, "No Windows mutations are allowed without a connected target.");

            var stale = new TestDesktop(path, 1, 0, 0) { DetachedRectangle = Failed };
            Require(WallpaperHost.ApplyToDisplays(stale, path, 2) == "applied", "The active display count confirms the stale entry.");
            Require(WallpaperHost.ApplyToDisplays(stale, path, 3) == "partial", "A possibly active display with no rectangle prevents success.");

            CheckAcceptance(path);
            File.WriteAllText(path, "not an image");
            var replies = new List<string>();
            using (var request = ApplyRequest(path))
            {
                WallpaperHost.Run(request, replies.Add, delegate { throw new Exception("Corrupt image was applied."); });
            }
            Require(replies.Count == 2 && replies[1] == @"{""type"":""result"",""status"":""file-error""}",
                "A corrupt image must return file-error before acceptance.");
        }
        finally
        {
            File.Delete(path);
        }
    }

    private static void CheckDisplays(string path, int fill, int left, int right, string expected)
    {
        var desktop = new TestDesktop(path, fill, left, right);
        Require(WallpaperHost.ApplyToDisplays(desktop, path, 2) == expected,
            "Unexpected outcome for Fill=" + fill + ", left=" + left + ", right=" + right + ".");
        Require(desktop.Writes.SequenceEqual(new[] { "fill", "left", "right" }),
            "Only connected monitors should receive the image, after Fill is requested.");
    }

    private static void CheckAcceptance(string path)
    {
        var closed = new IOException("Acceptance could not be delivered.");
        var replies = new List<string>();
        try
        {
            using (var request = ApplyRequest(path))
            {
                WallpaperHost.Run(request, message =>
                {
                    replies.Add(message);
                    if (message == @"{""type"":""accepted""}")
                    {
                        throw closed;
                    }
                }, delegate { throw new Exception("An unaccepted request reached Windows."); });
            }
            throw new Exception("A failed acceptance write was ignored.");
        }
        catch (IOException error)
        {
            Require(error == closed && replies.Count == 2 &&
                replies[0] == @"{""type"":""compatibility"",""protocolVersion"":1,""compatible"":true,""canApplyWallpaper"":true}",
                "The valid image must reach acceptance after compatibility.");
        }
    }

    private static BinaryReader ApplyRequest(string path)
    {
        string jsonPath = path.Replace(@"\", @"\\").Replace("\u5c71", @"\u5c71");
        byte[] payload = Encoding.UTF8.GetBytes(
            @"{""path"":""" + jsonPath + @""",""protocolVersion"":1,""type"":""apply""}");
        return new BinaryReader(new MemoryStream(BitConverter.GetBytes(payload.Length).Concat(payload).ToArray()));
    }

    private static void Require(bool condition, string failure)
    {
        if (!condition)
        {
            throw new Exception(failure);
        }
    }

    private sealed class TestDesktop : IDesktopWallpaper
    {
        private readonly string path;
        private readonly int fill, left, right;
        internal readonly List<string> Writes = new List<string>();
        internal bool AllDetached;
        internal int DetachedRectangle = 1;

        internal TestDesktop(string path, int fill, int left, int right)
        {
            this.path = path;
            this.fill = fill;
            this.left = left;
            this.right = right;
        }

        public int GetMonitorDevicePathCount(out uint count) { count = 3; return 0; }
        public int GetMonitorDevicePathAt(uint index, out string monitor)
        {
            monitor = new[] { "left", "detached", "right" }[index];
            return 0;
        }

        public int GetMonitorRECT(string monitor, out MonitorRect rectangle)
        {
            rectangle = new MonitorRect();
            return AllDetached || monitor == "detached" ? DetachedRectangle : 0;
        }

        public int SetPosition(WallpaperPosition position)
        {
            Require((int)position == 4, "Windows must be asked for proportional Fill.");
            Writes.Add("fill");
            return fill;
        }

        public int SetWallpaper(string monitor, string imagePath)
        {
            Require(imagePath == path, "Each monitor must receive the original saved file.");
            Writes.Add(monitor);
            return monitor == "left" ? left : right;
        }

        public int GetWallpaper(string monitor, out string result) { throw new NotSupportedException(); }
        public int SetBackgroundColor(uint color) { throw new NotSupportedException(); }
        public int GetBackgroundColor(out uint color) { throw new NotSupportedException(); }
    }
}
