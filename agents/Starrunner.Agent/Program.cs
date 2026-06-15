using System.Collections.Concurrent;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<AgentOptions>(builder.Configuration.GetSection("Agent"));
builder.Services.AddSingleton<FrameRegistry>();
builder.Services.AddSingleton<Phd2Monitor>();
builder.Services.AddHostedService<NinaOutputWatcher>();
builder.Services.AddHostedService<PendingFrameProcessor>();
builder.Services.AddHostedService(serviceProvider => serviceProvider.GetRequiredService<Phd2Monitor>());
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin()
            .AllowAnyHeader()
            .AllowAnyMethod());
});

var app = builder.Build();
app.UseCors();

app.MapGet("/health", (FrameRegistry registry, Microsoft.Extensions.Options.IOptions<AgentOptions> options) =>
{
    var root = options.Value.NinaOutputRoot;

    return Results.Ok(new
    {
        name = "Starrunner.Agent",
        status = Directory.Exists(root) ? "ready" : "missing-output-root",
        ninaOutputRoot = root,
        stateFilePath = options.Value.StateFilePath,
        pendingFrames = registry.PendingCount,
        deliveredFrames = registry.DeliveredCount,
        utc = DateTimeOffset.UtcNow
    });
});

app.MapGet("/session", (FrameRegistry registry, Microsoft.Extensions.Options.IOptions<AgentOptions> options) =>
{
    return Results.Ok(new
    {
        ninaOutputRoot = options.Value.NinaOutputRoot,
        stateFilePath = options.Value.StateFilePath,
        extensions = options.Value.Extensions,
        pendingFrames = registry.PendingCount,
        deliveredFrames = registry.DeliveredCount
    });
});

app.MapPost("/session", (SessionUpdate update, Microsoft.Extensions.Options.IOptions<AgentOptions> options) =>
{
    if (!string.IsNullOrWhiteSpace(update.NinaOutputRoot))
    {
        options.Value.NinaOutputRoot = update.NinaOutputRoot.Trim();
    }

    return Results.Ok(new { options.Value.NinaOutputRoot });
});

app.MapGet("/frames/pending", (FrameRegistry registry) =>
{
    return Results.Ok(registry.PendingFrames());
});

app.MapGet("/frames/failed", (FrameRegistry registry) =>
{
    return Results.Ok(registry.FailedFrames());
});

app.MapGet("/phd2/status", (Phd2Monitor monitor) =>
{
    return Results.Ok(monitor.GetStatus());
});

app.MapGet("/frames/{id}", async (string id, FrameRegistry registry, CancellationToken cancellationToken) =>
{
    var frame = registry.Get(id);

    if (frame is null)
    {
        return Results.NotFound();
    }

    if (!File.Exists(frame.SourcePath))
    {
        registry.MarkFailed(id, "source file no longer exists");
        return Results.NotFound();
    }

    var stream = File.Open(frame.SourcePath, FileMode.Open, FileAccess.Read, FileShare.Read);
    await Task.CompletedTask.WaitAsync(cancellationToken);
    return Results.File(stream, "application/fits", frame.FileName, enableRangeProcessing: true);
});

app.MapPost("/frames/{id}/ack", (string id, FrameAck ack, FrameRegistry registry) =>
{
    var frame = registry.Get(id);

    if (frame is null)
    {
        return Results.NotFound();
    }

    if (!string.Equals(frame.Sha256, ack.Sha256, StringComparison.OrdinalIgnoreCase))
    {
        return Results.BadRequest(new { error = "checksum mismatch" });
    }

    registry.MarkDelivered(id);
    return Results.Ok(registry.Get(id));
});

app.MapPost("/frames/{id}/retry", (string id, FrameRegistry registry) =>
{
    if (!registry.Retry(id))
    {
        return Results.NotFound();
    }

    return Results.Ok(registry.Get(id));
});

app.Run();

sealed class AgentOptions
{
    public string NinaOutputRoot { get; set; } = @"C:\NINA\Output";
    public int StableDelaySeconds { get; set; } = 3;
    public string[] Extensions { get; set; } = [".fit", ".fits"];
    public string StateFilePath { get; set; } = "agent-state.json";
    public string Phd2Host { get; set; } = "127.0.0.1";
    public int Phd2Port { get; set; } = 4400;
}

sealed record SessionUpdate(string? NinaOutputRoot);

sealed record FrameAck(string Sha256);

sealed record FrameRecord(
    string Id,
    string TargetName,
    string ImageType,
    int FrameNumber,
    string SourceKind,
    string FileName,
    string SourcePath,
    long SizeBytes,
    string Sha256,
    DateTimeOffset CreatedAt,
    string Status,
    string? Error = null
);

sealed class FrameRegistry
{
    private readonly ConcurrentDictionary<string, FrameRecord> _frames = new();
    private readonly object _stateLock = new();
    private readonly string _stateFilePath;

    public FrameRegistry(Microsoft.Extensions.Options.IOptions<AgentOptions> options, ILogger<FrameRegistry> logger)
    {
        _stateFilePath = ResolveStateFilePath(options.Value.StateFilePath);
        LoadState(logger);
    }

    public int PendingCount => _frames.Values.Count(frame => frame.Status == "pending");
    public int DeliveredCount => _frames.Values.Count(frame => frame.Status == "delivered");

    public FrameRecord? Get(string id)
    {
        _frames.TryGetValue(id, out var frame);
        return frame;
    }

    public IEnumerable<FrameRecord> PendingFrames()
    {
        return _frames.Values
            .Where(frame => frame.Status == "pending")
            .OrderBy(frame => frame.CreatedAt)
            .ThenBy(frame => frame.FrameNumber);
    }

    public IEnumerable<FrameRecord> FailedFrames()
    {
        return _frames.Values
            .Where(frame => frame.Status == "failed")
            .OrderByDescending(frame => frame.CreatedAt)
            .ThenBy(frame => frame.FrameNumber);
    }

    public bool UpsertPending(FrameRecord frame)
    {
        var addedPending = false;
        _frames.AddOrUpdate(
            frame.Id,
            _ =>
            {
                addedPending = true;
                return frame;
            },
            (_, existing) =>
            {
                if (existing.Status == "delivered")
                {
                    return existing;
                }

                addedPending = true;
                return frame;
            });
        return addedPending;
    }

    public void MarkDelivered(string id)
    {
        _frames.AddOrUpdate(id, _ => throw new InvalidOperationException("Frame not found"), (_, existing) =>
            existing with { Status = "delivered", Error = null });
        SaveState();
    }

    public void MarkFailed(string id, string error)
    {
        _frames.AddOrUpdate(id, _ => throw new InvalidOperationException("Frame not found"), (_, existing) =>
            existing with { Status = "failed", Error = error });
        SaveState();
    }

    public bool Retry(string id)
    {
        if (!_frames.TryGetValue(id, out var existing))
        {
            return false;
        }

        _frames[id] = existing with { Status = "pending", Error = null };
        SaveState();
        return true;
    }

    private static string ResolveStateFilePath(string configuredPath)
    {
        var path = string.IsNullOrWhiteSpace(configuredPath) ? "agent-state.json" : configuredPath.Trim();
        return Path.IsPathRooted(path) ? path : Path.Combine(AppContext.BaseDirectory, path);
    }

    private void LoadState(ILogger logger)
    {
        if (!File.Exists(_stateFilePath))
        {
            return;
        }

        try
        {
            var json = File.ReadAllText(_stateFilePath);
            var state = JsonSerializer.Deserialize<AgentState>(json, JsonOptions);

            foreach (var frame in state?.Frames ?? [])
            {
                _frames[frame.Id] = frame;
            }
        }
        catch (Exception error)
        {
            logger.LogWarning(error, "Could not read agent state file {StateFilePath}", _stateFilePath);
        }
    }

    private void SaveState()
    {
        lock (_stateLock)
        {
            var directory = Path.GetDirectoryName(_stateFilePath);

            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var state = new AgentState(
                1,
                DateTimeOffset.UtcNow,
                _frames.Values
                    .Where(frame => frame.Status is "delivered" or "failed")
                    .OrderBy(frame => frame.CreatedAt)
                    .ThenBy(frame => frame.Id)
                    .ToArray());

            File.WriteAllText(_stateFilePath, JsonSerializer.Serialize(state, JsonOptions));
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };
}

sealed record AgentState(int Version, DateTimeOffset UpdatedAt, FrameRecord[] Frames);

sealed record PhdGuideSample(
    int Frame,
    double Time,
    double Dx,
    double Dy,
    double? RaDuration,
    string? RaDirection,
    double? DecDuration,
    string? DecDirection,
    double? Snr,
    double? Hfd,
    double? AvgDist,
    DateTimeOffset ReceivedAt
);

sealed record Phd2Status(
    bool Connected,
    string AppState,
    string Version,
    string LastEvent,
    string? Error,
    DateTimeOffset? LastEventAt,
    PhdGuideSample[] Samples
);

sealed class Phd2Monitor(
    Microsoft.Extensions.Options.IOptions<AgentOptions> options,
    ILogger<Phd2Monitor> logger) : BackgroundService
{
    private readonly object _lock = new();
    private readonly Queue<PhdGuideSample> _samples = new();
    private bool _connected;
    private string _appState = "Unknown";
    private string _version = "";
    private string _lastEvent = "";
    private string? _error;
    private DateTimeOffset? _lastEventAt;

    public Phd2Status GetStatus()
    {
        lock (_lock)
        {
            return new Phd2Status(
                _connected,
                _appState,
                _version,
                _lastEvent,
                _error,
                _lastEventAt,
                _samples.ToArray());
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await MonitorOnce(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception error)
            {
                SetDisconnected(error.Message);
                logger.LogInformation(error, "PHD2 event monitor disconnected");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    private async Task MonitorOnce(CancellationToken stoppingToken)
    {
        using var client = new TcpClient();
        await client.ConnectAsync(options.Value.Phd2Host, options.Value.Phd2Port, stoppingToken);
        SetConnected();

        await using var stream = client.GetStream();
        using var reader = new StreamReader(stream);

        while (!stoppingToken.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(stoppingToken);

            if (line is null)
            {
                throw new IOException("PHD2 closed the event stream.");
            }

            HandleEvent(line);
        }
    }

    private void HandleEvent(string line)
    {
        using var document = JsonDocument.Parse(line);
        var root = document.RootElement;
        var eventName = GetString(root, "Event") ?? "Unknown";

        lock (_lock)
        {
            _connected = true;
            _lastEvent = eventName;
            _lastEventAt = DateTimeOffset.UtcNow;
            _error = null;

            if (eventName == "Version")
            {
                _version = GetString(root, "PHDVersion") ?? _version;
            }
            else if (eventName == "AppState")
            {
                _appState = GetString(root, "State") ?? _appState;
            }
            else if (eventName == "GuideStep")
            {
                _appState = "Guiding";
                _samples.Enqueue(new PhdGuideSample(
                    GetInt(root, "Frame") ?? 0,
                    GetDouble(root, "Time") ?? 0,
                    GetDouble(root, "dx") ?? 0,
                    GetDouble(root, "dy") ?? 0,
                    GetDouble(root, "RADuration"),
                    GetString(root, "RADirection"),
                    GetDouble(root, "DECDuration"),
                    GetString(root, "DECDirection"),
                    GetDouble(root, "SNR"),
                    GetDouble(root, "HFD"),
                    GetDouble(root, "AvgDist"),
                    DateTimeOffset.UtcNow));

                while (_samples.Count > 240)
                {
                    _samples.Dequeue();
                }
            }
            else if (eventName == "Paused")
            {
                _appState = "Paused";
            }
            else if (eventName == "GuidingStopped")
            {
                _appState = "Stopped";
            }
            else if (eventName == "StarLost")
            {
                _appState = "LostLock";
            }
            else if (eventName == "StartCalibration")
            {
                _appState = "Calibrating";
            }
            else if (eventName == "LoopingExposures")
            {
                _appState = "Looping";
            }
        }
    }

    private void SetConnected()
    {
        lock (_lock)
        {
            _connected = true;
            _error = null;
        }
    }

    private void SetDisconnected(string error)
    {
        lock (_lock)
        {
            _connected = false;
            _error = error;
        }
    }

    private static string? GetString(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private static int? GetInt(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var value) && value.TryGetInt32(out var result)
            ? result
            : null;
    }

    private static double? GetDouble(JsonElement element, string property)
    {
        return element.TryGetProperty(property, out var value) && value.TryGetDouble(out var result)
            ? result
            : null;
    }
}

sealed class NinaOutputWatcher(
    Microsoft.Extensions.Options.IOptions<AgentOptions> options,
    ILogger<NinaOutputWatcher> logger) : BackgroundService
{
    private FileSystemWatcher? _watcher;

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var root = options.Value.NinaOutputRoot;

        if (!Directory.Exists(root))
        {
            logger.LogWarning("NINA output root does not exist: {Root}", root);
            return Task.CompletedTask;
        }

        foreach (var file in Directory.EnumerateFiles(root, "*.*", SearchOption.AllDirectories))
        {
            if (IsAllowedExtension(file, options.Value.Extensions))
            {
                QueueFile(file);
            }
        }

        _watcher = new FileSystemWatcher(root)
        {
            EnableRaisingEvents = true,
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size
        };

        _watcher.Created += (_, eventArgs) => QueueFile(eventArgs.FullPath);
        _watcher.Changed += (_, eventArgs) => QueueFile(eventArgs.FullPath);
        _watcher.Renamed += (_, eventArgs) => QueueFile(eventArgs.FullPath);

        return Task.CompletedTask;
    }

    private void QueueFile(string path)
    {
        if (!IsAllowedExtension(path, options.Value.Extensions))
        {
            return;
        }

        PendingFrameProcessor.Queue(path);
        logger.LogInformation("Queued FITS candidate {Path}", path);
    }

    public override void Dispose()
    {
        _watcher?.Dispose();
        base.Dispose();
    }

    private static bool IsAllowedExtension(string path, IEnumerable<string> extensions)
    {
        var extension = Path.GetExtension(path);
        return extensions.Any(allowed => string.Equals(extension, allowed, StringComparison.OrdinalIgnoreCase));
    }
}

sealed class PendingFrameProcessor(
    FrameRegistry registry,
    Microsoft.Extensions.Options.IOptions<AgentOptions> options,
    ILogger<PendingFrameProcessor> logger) : BackgroundService
{
    private static readonly ConcurrentQueue<string> PendingFiles = new();
    private static readonly SemaphoreSlim Signal = new(0);

    public static void Queue(string path)
    {
        PendingFiles.Enqueue(path);
        Signal.Release();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await Signal.WaitAsync(stoppingToken);

            if (!PendingFiles.TryDequeue(out var path))
            {
                continue;
            }

            try
            {
                await ProcessWhenStable(path, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception error)
            {
                logger.LogWarning(error, "Could not process FITS file {Path}", path);
            }
        }
    }

    private async Task ProcessWhenStable(string path, CancellationToken cancellationToken)
    {
        var stableDelay = TimeSpan.FromSeconds(Math.Max(1, options.Value.StableDelaySeconds));
        var first = await GetStableFileSnapshot(path, stableDelay, cancellationToken);

        if (first is null)
        {
            return;
        }

        var sha256 = await ComputeSha256(path, cancellationToken);
        var metadata = FrameMetadata.FromPath(path);
        var record = new FrameRecord(
            metadata.Id,
            metadata.TargetName,
            metadata.ImageType,
            metadata.FrameNumber,
            metadata.SourceKind,
            Path.GetFileName(path),
            path,
            first.SizeBytes,
            sha256,
            first.CreatedAt,
            "pending"
        );

        if (registry.UpsertPending(record))
        {
            logger.LogInformation("Registered pending frame {Id} ({SizeBytes} bytes)", record.Id, record.SizeBytes);
        }
        else
        {
            logger.LogInformation("Skipped already delivered frame {Id}", record.Id);
        }
    }

    private static async Task<FileSnapshot?> GetStableFileSnapshot(
        string path,
        TimeSpan stableDelay,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
        {
            return null;
        }

        var first = new FileInfo(path);
        await Task.Delay(stableDelay, cancellationToken);

        if (!File.Exists(path))
        {
            return null;
        }

        var second = new FileInfo(path);

        if (first.Length != second.Length || second.Length == 0)
        {
            PendingFrameProcessor.Queue(path);
            return null;
        }

        await using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        return new FileSnapshot(second.Length, second.CreationTimeUtc);
    }

    private static async Task<string> ComputeSha256(string path, CancellationToken cancellationToken)
    {
        await using var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}

sealed record FileSnapshot(long SizeBytes, DateTime CreatedAtUtc)
{
    public DateTimeOffset CreatedAt => new(CreatedAtUtc, TimeSpan.Zero);
}
