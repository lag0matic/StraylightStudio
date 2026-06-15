var cases = new[]
{
    new ParserCase(
        Path.Combine(@"C:\Astro\Nina-Output", "2015-12-31", "M33", "LIGHT", "M33_-15_10.21_LIGHT_0001.fits"),
        "M33",
        "LIGHT",
        1,
        "sequence"),
    new ParserCase(
        Path.Combine(@"C:\Astro\Nina-Output", "2015-12-31", "M33", "DARK", "M33_-15_10.21_DARK_0002.fits"),
        "M33",
        "DARK",
        2,
        "sequence"),
    new ParserCase(
        Path.Combine(@"C:\Astro\Nina-Output", "2015-12-31", "M33", "FLAT", "M33_-15_10.21_FLAT_0003.fits"),
        "M33",
        "FLAT",
        3,
        "sequence"),
    new ParserCase(
        Path.Combine(@"C:\Astro\Nina-Output", "2015-12-31", "M33", "BIAS", "M33_-15_10.21_BIAS_0004.fits"),
        "M33",
        "BIAS",
        4,
        "sequence"),
    new ParserCase(
        Path.Combine(@"C:\Astro\Nina-Output", "2015-12-31", "M33", "DARKFLAT", "M33_-15_10.21_DARKFLAT_0005.fits"),
        "M33",
        "DarkFlat",
        5,
        "sequence"),
    new ParserCase(
        Path.Combine(@"C:\Astro\Nina-Output", "2026-06-14", "SNAPSHOT", "2026-06-14_18-32-38__22.50_1.00s_0000.fits"),
        "snapshot",
        "Light",
        1,
        "snapshot")
};

foreach (var parserCase in cases)
{
    var metadata = FrameMetadata.FromPath(parserCase.Path);
    AssertEqual(parserCase.TargetName, metadata.TargetName, parserCase.Path, nameof(metadata.TargetName));
    AssertEqual(parserCase.ImageType, metadata.ImageType, parserCase.Path, nameof(metadata.ImageType));
    AssertEqual(parserCase.FrameNumber, metadata.FrameNumber, parserCase.Path, nameof(metadata.FrameNumber));
    AssertEqual(parserCase.SourceKind, metadata.SourceKind, parserCase.Path, nameof(metadata.SourceKind));

    if (string.IsNullOrWhiteSpace(metadata.Id))
    {
        throw new InvalidOperationException($"Expected stable id for {parserCase.Path}.");
    }
}

Console.WriteLine($"Frame metadata parser tests passed: {cases.Length}");

static void AssertEqual<T>(T expected, T actual, string path, string field)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
    {
        throw new InvalidOperationException($"{field} mismatch for {path}. Expected {expected}, got {actual}.");
    }
}

sealed record ParserCase(string Path, string TargetName, string ImageType, int FrameNumber, string SourceKind);
