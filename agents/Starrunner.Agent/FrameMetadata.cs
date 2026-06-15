using System.Security.Cryptography;
using System.Text;

sealed record FrameMetadata(string Id, string TargetName, string ImageType, int FrameNumber, string SourceKind)
{
    public static FrameMetadata FromPath(string path)
    {
        var fileName = Path.GetFileNameWithoutExtension(path);
        var tokens = fileName.Split('_', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var segments = path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
        var imageTypeFolder = Directory.GetParent(path)?.Name ?? "";
        var targetFolder = Directory.GetParent(path)?.Parent?.Name ?? "";
        var dateFolder = Directory.GetParent(path)?.Parent?.Parent?.Name ?? "";
        var sourceKind = SourceKindFromFolders(imageTypeFolder, targetFolder, dateFolder);
        var targetName = TargetNameFromFolders(targetFolder, imageTypeFolder, sourceKind);
        var imageType = IsImageType(imageTypeFolder)
            ? NormalizeImageType(imageTypeFolder)
            : tokens.FirstOrDefault(IsImageType) ?? GuessImageType(segments);
        var frameNumber = tokens
            .Reverse()
            .Select(token => int.TryParse(token, out var value) ? value : 0)
            .FirstOrDefault(value => value > 0);

        frameNumber = frameNumber == 0 ? 1 : frameNumber;
        var id = $"{SanitizeId(targetName)}-{SanitizeId(imageType)}-{frameNumber:0000}-{ShortHash(path)}";
        return new FrameMetadata(id, targetName, imageType, frameNumber, sourceKind);
    }

    private static bool IsImageType(string value)
    {
        return value.Equals("light", StringComparison.OrdinalIgnoreCase)
            || value.Equals("dark", StringComparison.OrdinalIgnoreCase)
            || value.Equals("flat", StringComparison.OrdinalIgnoreCase)
            || value.Equals("bias", StringComparison.OrdinalIgnoreCase)
            || value.Equals("darkflat", StringComparison.OrdinalIgnoreCase);
    }

    private static string SourceKindFromFolders(string imageTypeFolder, string targetFolder, string dateFolder)
    {
        if (imageTypeFolder.Equals("snapshot", StringComparison.OrdinalIgnoreCase)
            || targetFolder.Equals("snapshot", StringComparison.OrdinalIgnoreCase))
        {
            return "snapshot";
        }

        return IsDateFolder(dateFolder) && IsImageType(imageTypeFolder) ? "sequence" : "unknown";
    }

    private static string TargetNameFromFolders(string targetFolder, string imageTypeFolder, string sourceKind)
    {
        if (sourceKind == "snapshot")
        {
            return "snapshot";
        }

        if (string.IsNullOrWhiteSpace(targetFolder) || IsDateFolder(targetFolder) || IsImageType(targetFolder))
        {
            return string.IsNullOrWhiteSpace(imageTypeFolder) || IsImageType(imageTypeFolder) ? "Unknown" : imageTypeFolder;
        }

        return targetFolder;
    }

    private static string GuessImageType(IEnumerable<string> segments)
    {
        return segments.FirstOrDefault(IsImageType) ?? "Light";
    }

    private static bool IsDateFolder(string value)
    {
        return DateOnly.TryParseExact(value, "yyyy-MM-dd", out _);
    }

    private static string NormalizeImageType(string value)
    {
        return value.Equals("darkflat", StringComparison.OrdinalIgnoreCase) ? "DarkFlat" : value.ToUpperInvariant();
    }

    private static string SanitizeId(string value)
    {
        var safe = new string(value.ToLowerInvariant().Select(character =>
            char.IsLetterOrDigit(character) ? character : '-').ToArray());
        return string.Join('-', safe.Split('-', StringSplitOptions.RemoveEmptyEntries));
    }

    private static string ShortHash(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value.ToLowerInvariant()));
        return Convert.ToHexString(hash)[..8].ToLowerInvariant();
    }
}
