using System;
using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Serilog;

namespace NuGetDependencies;

/// <summary>
/// Reads and writes orders as JSON with Newtonsoft.Json, and logs what it does
/// with Serilog, through a sink of its own that writes to stdout: code from two
/// NuGet packages, called, configured and extended.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int InvalidJson = 2;

    private const string Usage = "Usage: NuGetDependencies order <id> <item>... | read <json> | log <count>";

    private static int Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        using var log = new LoggerConfiguration()
            .MinimumLevel.Debug()
            .Enrich.WithProperty("App", "NuGetDependencies")
            .WriteTo.Sink(new StdoutSink())
            .CreateLogger();

        if (args.Length == 0)
        {
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }

        switch (args[0])
        {
            case "order" when args.Length >= 3 && int.TryParse(args[1], out var id):
                return WriteOrder(log, id, args[2..]);
            case "read" when args.Length == 2:
                return ReadOrder(log, args[1]);
            case "log" when args.Length == 2 && int.TryParse(args[1], out var count) && count >= 0:
                return LogLevels(log, count);
            default:
                Console.Error.WriteLine(Usage);
                return InvalidInput;
        }
    }

    private static int WriteOrder(ILogger log, int id, string[] items)
    {
        var order = new Order { Id = id, Items = items, Placed = new DateTime(2026, 10, 8, 9, 30, 0, DateTimeKind.Utc) };
        log.Information("Writing order {OrderId} with {ItemCount} items", order.Id, order.Items.Length);
        Console.WriteLine(JsonConvert.SerializeObject(order, Formatting.Indented));
        return Succeeded;
    }

    private static int ReadOrder(ILogger log, string json)
    {
        try
        {
            var order = JsonConvert.DeserializeObject<Order>(json) ?? throw new JsonSerializationException("The order is null.");
            log.Information("Read {@Order}", order);

            var parsed = JObject.Parse(json);
            foreach (var property in parsed.Properties())
            {
                Console.WriteLine($"{property.Name}: {property.Value.Type}");
            }

            var gift = parsed.SelectToken("$.gift")?.Value<bool>() ?? false;
            Console.WriteLine(gift ? "A gift." : "Not a gift.");
            return Succeeded;
        }
        catch (JsonException exception)
        {
            log.Error("Could not read the order: {Reason}", exception.Message);
            Console.Error.WriteLine($"Invalid order: {exception.GetType().Name}");
            return InvalidJson;
        }
    }

    private static int LogLevels(ILogger log, int count)
    {
        var scoped = log.ForContext("Count", count);
        for (var i = 1; i <= count; i++)
        {
            scoped.Debug("Step {Step} of {Count}", i, count);
        }

        scoped.Warning("Done after {Steps} steps", count);
        return Succeeded;
    }
}
