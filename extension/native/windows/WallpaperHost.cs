using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

internal static class WallpaperHost
{
    private const int MaxRequestBytes = 1024;
    private const string JsonWhitespace = @"[ \t\r\n]*";
    private const string MemberSeparator = JsonWhitespace + ":" + JsonWhitespace;
    private const string VerifyMember = @"""type""" + MemberSeparator + @"""verify""";
    private const string VersionMember = @"""protocolVersion""" + MemberSeparator + "1";
    private const string Comma = JsonWhitespace + "," + JsonWhitespace;

    private static readonly Regex VerifyRequest = new Regex(
        @"\A" + JsonWhitespace + @"\{" + JsonWhitespace + "(?:" +
        VerifyMember + Comma + VersionMember + "|" + VersionMember + Comma + VerifyMember +
        ")" + JsonWhitespace + @"\}" + JsonWhitespace + @"\z");

    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    private static readonly byte[] Compatibility = Utf8.GetBytes(
        @"{""type"":""compatibility"",""protocolVersion"":1,""compatible"":true}");

    public static int Main()
    {
        try
        {
            using (var input = new BinaryReader(Console.OpenStandardInput()))
            using (var output = new BinaryWriter(Console.OpenStandardOutput()))
            {
                int length = input.ReadInt32();
                if (length < 1 || length > MaxRequestBytes)
                {
                    return 1;
                }

                byte[] message = input.ReadBytes(length);
                if (message.Length != length || !VerifyRequest.IsMatch(Utf8.GetString(message)))
                {
                    return 1;
                }

                output.Write(Compatibility.Length);
                output.Write(Compatibility);
                output.Flush();
                return 0;
            }
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
}
