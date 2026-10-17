using System.Text.Json.Nodes;

namespace Xray.Engine.Tests;

public class EngineHostTests
{
    [Fact]
    public async Task AnswersEachRequestLineInOrderAndExitsCleanlyAtEndOfInput()
    {
        var input = new StringReader(
            $$"""
            {"id":1,"command":"handshake","params":{"protocolVersion":{{Protocol.Version}} } }

            {"id":2,"command":"ping"}
            {"id":3,"command":"ping"}
            """);
        var output = new StringWriter();

        var exitCode = await EngineHost.RunAsync(input, output, TestContext.Current.CancellationToken);

        Assert.Equal(0, exitCode);
        var text = output.ToString();
        Assert.DoesNotContain("\r", text);
        var lines = text.Split('\n');
        Assert.Equal(4, lines.Length);
        Assert.Equal("", lines[3]);
        Assert.Equal([1, 2, 3], lines[..3].Select(line => (int)JsonNode.Parse(line)!["id"]!));
        Assert.All(lines[..3], line => Assert.Null(JsonNode.Parse(line)!["error"]));
    }

    [Fact]
    public async Task WritesACommandsProgressAheadOfItsResponse()
    {
        var path = JsonValue.Create(PeClassifierTests.ManagedAssembly).ToJsonString();
        var input = new StringReader(
            $$"""
            {"id":1,"command":"handshake","params":{"protocolVersion":{{Protocol.Version}} } }
            {"id":2,"command":"decompile","params":{"path":{{path}},"languageVersion":"12.0"} }
            {"id":3,"command":"ping"}
            """);
        var output = new StringWriter();

        await EngineHost.RunAsync(input, output, TestContext.Current.CancellationToken);

        var text = output.ToString();
        Assert.DoesNotContain("\r", text);
        var lines = text.TrimEnd('\n').Split('\n').Select(line => JsonNode.Parse(line)!.AsObject()).ToList();
        Assert.Equal(1, (int?)lines[0]["id"]);
        var progress = lines[1..^2];
        Assert.NotEmpty(progress);
        Assert.All(progress, line => Assert.Equal(2, (int?)line["id"]));
        Assert.All(progress, line => Assert.NotNull(line["progress"]));
        // Types are decompiled several at once, so how many are done never goes
        // down, nor counts a type not yet reported, but can stay the same.
        var done = progress.Select(line => (int)line["progress"]!["done"]!).ToList();
        Assert.Equal(done.Order(), done);
        Assert.All(done.Select((count, position) => (count, position)), line => Assert.InRange(line.count, 0, line.position));
        Assert.Equal(2, (int?)lines[^2]["id"]);
        // A line per top-level type; file-scoped ones share a unit with the types that use them.
        Assert.All(progress, line => Assert.Equal(progress.Count, (int)line["progress"]!["total"]!));
        Assert.InRange(lines[^2]["result"]!["types"]!.AsArray().Count, 1, progress.Count);
        Assert.Equal(3, (int?)lines[^1]["id"]);
    }

    [Fact]
    public async Task KeepsServingAfterAnInvalidRequest()
    {
        var input = new StringReader(
            $$"""
            {"id":1,"command":"handshake","params":{"protocolVersion":{{Protocol.Version}} } }
            {oops
            {"id":2,"command":"ping"}
            """);
        var output = new StringWriter();

        await EngineHost.RunAsync(input, output, TestContext.Current.CancellationToken);

        var responses = output.ToString().TrimEnd('\n').Split('\n').Select(line => JsonNode.Parse(line)!).ToList();
        Assert.Equal(3, responses.Count);
        Assert.Equal("invalid-request", (string?)responses[1]["error"]!["code"]);
        Assert.Equal(2, (int?)responses[2]["id"]);
        Assert.NotNull(responses[2]["result"]);
    }
}
