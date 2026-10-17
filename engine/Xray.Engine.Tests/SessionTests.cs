using System.Reflection;
using System.Text.Json.Nodes;

namespace Xray.Engine.Tests;

public class SessionTests
{
    private static JsonObject Send(Session session, string line) =>
        JsonNode.Parse(session.Handle(line))!.AsObject();

    private static Session HandshakenSession()
    {
        var session = new Session();
        Send(session, Handshake(1));
        return session;
    }

    private static string Handshake(int id) =>
        $$"""{"id":{{id}},"command":"handshake","params":{"protocolVersion":{{Protocol.Version}} } }""";

    private static string? ErrorCode(JsonObject response) => (string?)response["error"]?["code"];

    [Fact]
    public void HandshakeReportsProtocolEngineAndDecompilerVersions()
    {
        var response = Send(new Session(), Handshake(7));

        Assert.Equal(7, (int?)response["id"]);
        Assert.Null(response["error"]);
        var result = response["result"]!.AsObject();
        Assert.Equal(Protocol.Version, (int?)result["protocolVersion"]);
        Assert.StartsWith("0.0.0", (string?)result["engineVersion"]);
        Assert.StartsWith("11.", (string?)result["decompilerVersion"]);
    }

    [Fact]
    public void HandshakeRefusesADifferentProtocolVersion()
    {
        var response = Send(new Session(), """{"id":1,"command":"handshake","params":{"protocolVersion":99}}""");

        Assert.Equal(1, (int?)response["id"]);
        Assert.Null(response["result"]);
        Assert.Equal("protocol-mismatch", ErrorCode(response));
        Assert.Equal(
            $"The client speaks engine protocol version 99 but this engine speaks version {Protocol.Version}.",
            (string?)response["error"]!["message"]);
    }

    [Fact]
    public void AFailedHandshakeDoesNotUnlockOtherCommands()
    {
        var session = new Session();
        Send(session, """{"id":1,"command":"handshake","params":{"protocolVersion":99}}""");

        var response = Send(session, """{"id":2,"command":"ping"}""");

        Assert.Equal("handshake-required", ErrorCode(response));
    }

    [Theory]
    [InlineData("""{"id":1,"command":"handshake"}""")]
    [InlineData("""{"id":1,"command":"handshake","params":{"protocolVersion":"1"}}""")]
    public void HandshakeNeedsAnIntegerProtocolVersion(string line)
    {
        var response = Send(new Session(), line);

        Assert.Equal("invalid-request", ErrorCode(response));
    }

    [Fact]
    public void PingBeforeHandshakeIsRefused()
    {
        var response = Send(new Session(), """{"id":3,"command":"ping"}""");

        Assert.Equal(3, (int?)response["id"]);
        Assert.Equal("handshake-required", ErrorCode(response));
    }

    [Fact]
    public void PingAfterHandshakeAnswersWithAnEmptyResult()
    {
        var response = Send(HandshakenSession(), """{"id":2,"command":"ping","params":{}}""");

        Assert.Equal(2, (int?)response["id"]);
        Assert.Null(response["error"]);
        Assert.Empty(response["result"]!.AsObject());
    }

    [Fact]
    public void UnknownCommandsAreReported()
    {
        var response = Send(HandshakenSession(), """{"id":4,"command":"frobnicate"}""");

        Assert.Equal(4, (int?)response["id"]);
        Assert.Equal("unknown-command", ErrorCode(response));
        Assert.Equal("Unknown command \"frobnicate\".", (string?)response["error"]!["message"]);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[1,2,3]")]
    [InlineData("""{"command":"ping"}""")]
    [InlineData("""{"id":"one","command":"ping"}""")]
    [InlineData("""{"id":1.5,"command":"ping"}""")]
    public void RequestsWithoutAnIntegerIdAreInvalidAndAnsweredWithANullId(string line)
    {
        var response = Send(HandshakenSession(), line);

        Assert.True(response.ContainsKey("id"));
        Assert.Null(response["id"]);
        Assert.Equal("invalid-request", ErrorCode(response));
    }

    [Theory]
    [InlineData("""{"id":5}""")]
    [InlineData("""{"id":5,"command":42}""")]
    [InlineData("""{"id":5,"command":"ping","params":[]}""")]
    public void MalformedRequestsWithAnIdAreInvalidAndKeepTheirId(string line)
    {
        var response = Send(HandshakenSession(), line);

        Assert.Equal(5, (int?)response["id"]);
        Assert.Equal("invalid-request", ErrorCode(response));
    }

    private static JsonObject Classify(string path) =>
        Send(HandshakenSession(), new JsonObject
        {
            ["id"] = 9,
            ["command"] = "classify",
            ["params"] = new JsonObject { ["path"] = path },
        }.ToJsonString());

    [Fact]
    public void ClassifyReportsAManagedAssemblyAndItsMachine()
    {
        var response = Classify(PeClassifierTests.ManagedAssembly);

        Assert.Equal(9, (int?)response["id"]);
        Assert.Null(response["error"]);
        var result = response["result"]!.AsObject();
        Assert.Equal("managed-assembly", (string?)result["kind"]);
        Assert.IsType<string>((string?)result["machine"]);
        Assert.False(result.ContainsKey("reason"));
    }

    [Fact]
    public void ClassifyReportsANativeExecutableAndItsMachine()
    {
        var response = Classify(PeClassifierTests.NativeExecutable);

        Assert.Equal(
            """{"kind":"native-executable","machine":"Amd64"}""",
            response["result"]!.ToJsonString());
    }

    [Fact]
    public void ClassifyReportsWhyAFileIsNotPe()
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path, "Just some text.\n");

            var response = Classify(path);

            Assert.Equal("""{"kind":"not-pe","reason":"no-dos-header"}""", response["result"]!.ToJsonString());
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void ClassifyReportsAMissingFile()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "no-such-file.dll");

        var response = Classify(path);

        Assert.Equal("file-not-found", ErrorCode(response));
        Assert.Equal($"There is no file at {path}.", (string?)response["error"]!["message"]);
    }

    [Fact]
    public void ClassifyReportsAFolder()
    {
        var response = Classify(AppContext.BaseDirectory);

        Assert.Equal("not-a-file", ErrorCode(response));
        Assert.Equal($"{AppContext.BaseDirectory} is a folder, not a file.", (string?)response["error"]!["message"]);
    }

    [Theory]
    [InlineData("""{"id":9,"command":"classify"}""")]
    [InlineData("""{"id":9,"command":"classify","params":{"path":""}}""")]
    [InlineData("""{"id":9,"command":"classify","params":{"path":42}}""")]
    public void ClassifyNeedsAPath(string line)
    {
        var response = Send(HandshakenSession(), line);

        Assert.Equal(9, (int?)response["id"]);
        Assert.Equal("invalid-params", ErrorCode(response));
        Assert.Equal("\"classify\" needs a non-empty string \"path\".", (string?)response["error"]!["message"]);
    }

    private static JsonObject Inspect(string path) =>
        Send(HandshakenSession(), new JsonObject
        {
            ["id"] = 10,
            ["command"] = "inspect",
            ["params"] = new JsonObject { ["path"] = path },
        }.ToJsonString());

    [Fact]
    public void InspectReportsAManagedAssemblysMetadata()
    {
        var response = Inspect(PeClassifierTests.ManagedAssembly);

        Assert.Equal(10, (int?)response["id"]);
        Assert.Null(response["error"]);
        var result = response["result"]!.AsObject();
        Assert.Equal(
            """{"name":"Xray.Engine","version":"0.0.0.0","culture":null,"publicKeyToken":null}""",
            result["assembly"]!.ToJsonString());
        Assert.Contains(
            """{"name":"ICSharpCode.Decompiler","version":"11.1.0.9782","culture":null,"publicKeyToken":"d4bfe873e7598c49"}""",
            result["references"]!.AsArray().Select(reference => reference!.ToJsonString()));
        Assert.Equal(".NETCoreApp,Version=v8.0", (string?)result["targetFramework"]);
        Assert.True(result.ContainsKey("targetPlatform"));
        Assert.Null(result["targetPlatform"]);
        Assert.Equal("v4.0.30319", (string?)result["runtimeVersion"]);
        Assert.Equal(
            typeof(Session).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()!.InformationalVersion,
            (string?)result["informationalVersion"]);
        Assert.Equal("I386", (string?)result["machine"]);
        Assert.False((bool?)result["pe32Plus"]);
        Assert.Equal("""{"ilOnly":true,"requires32Bit":false,"prefers32Bit":false}""", result["corFlags"]!.ToJsonString());
        Assert.Equal("windows-cui", (string?)result["subsystem"]);
        Assert.Equal("Program", (string?)result["entryPoint"]!["type"]);
        Assert.Equal("<Main>", (string?)result["entryPoint"]!["method"]);
        Assert.True((int?)result["typeCount"] > 0);
        Assert.True((int?)result["methodCount"] > 0);
        Assert.Equal(0, (int?)result["resourceCount"]);
        // No PDB was given to check.
        Assert.True(result.ContainsKey("pdb"));
        Assert.Null(result["pdb"]);
        // The marks of obfuscation, counted: the engine bears none.
        var obfuscation = result["obfuscation"]!.AsObject();
        Assert.Equal(["attributes", "names", "strings"], obfuscation.Select(entry => entry.Key));
        Assert.Contains(
            "System.Runtime.Versioning.TargetFrameworkAttribute",
            obfuscation["attributes"]!.AsArray().Select(attribute => (string?)attribute));
        Assert.Equal(
            ["count", "unprintable", "short", "unprintableExamples", "shortExamples"],
            obfuscation["names"]!.AsObject().Select(entry => entry.Key));
        Assert.True((int?)obfuscation["names"]!["count"] > 0);
        Assert.Equal(0, (int?)obfuscation["names"]!["unprintable"]);
        Assert.Equal("[]", obfuscation["names"]!["unprintableExamples"]!.ToJsonString());
        Assert.Equal(
            ["literals", "decoderCalls", "decoderTypes"],
            obfuscation["strings"]!.AsObject().Select(entry => entry.Key));
        Assert.True((int?)obfuscation["strings"]!["literals"] > 0);
        Assert.Equal(0, (int?)obfuscation["strings"]!["decoderCalls"]);
        Assert.Equal("[]", obfuscation["strings"]!["decoderTypes"]!.ToJsonString());
    }

    [Theory]
    [InlineData(true, """{"format":"portable","mismatch":null}""")]
    [InlineData(false, """{"format":"portable","mismatch":"other-build"}""")]
    public void InspectChecksWhetherThePdbItIsGivenIsTheAssemblysOwn(bool own, string expected)
    {
        var response = Send(HandshakenSession(), new JsonObject
        {
            ["id"] = 10,
            ["command"] = "inspect",
            ["params"] = new JsonObject
            {
                ["path"] = DebugSymbolsTests.Subjects,
                ["pdbPath"] = own ? DebugSymbolsTests.SubjectsPdb : DebugSymbolsTests.EnginePdb,
            },
        }.ToJsonString());

        Assert.Equal(expected, response["result"]!["pdb"]!.ToJsonString());
    }

    private static JsonObject Resources(string path) =>
        Send(HandshakenSession(), new JsonObject
        {
            ["id"] = 12,
            ["command"] = "resources",
            ["params"] = new JsonObject { ["path"] = path },
        }.ToJsonString());

    [Fact]
    public void ResourcesReportsEachResourceOfAnAssemblysManifest()
    {
        var response = Resources(typeof(SessionTests).Assembly.Location);

        Assert.Equal(12, (int?)response["id"]);
        Assert.Null(response["error"]);
        var result = response["result"]!.AsObject();
        Assert.Equal(
            """{"name":"Xray.Engine.Tests","version":"1.0.0.0","culture":null,"publicKeyToken":null}""",
            result["assembly"]!.ToJsonString());
        var resources = result["resources"]!.AsArray().ToDictionary(resource => (string)resource!["name"]!);
        Assert.Equal(
            ["Subjects.Note", "Xray.Engine.Tests.Resources.Blobs.resources", "Xray.Engine.Tests.Resources.Phrases.resources"],
            resources.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(
            """{"name":"Subjects.Note","public":false,"location":"embedded","linkedTo":null,"data":"QSBub3RlLCBlbWJlZGRlZCBhcyBpdCBpcy4K","entries":null,"notDecoded":null}""",
            resources["Subjects.Note"]!.ToJsonString());
        Assert.Equal(
            """[{"name":"Blob","kind":"bytes","value":"AAEC/w=="},{"name":"Note","kind":"stream","value":"QSBub3RlLCBlbWJlZGRlZCBhcyBpdCBpcy4K"}]""",
            new JsonArray([.. resources["Xray.Engine.Tests.Resources.Blobs.resources"]!["entries"]!.AsArray()
                .OrderBy(entry => (string)entry!["name"]!, StringComparer.Ordinal)
                .Select(entry => entry!.DeepClone())]).ToJsonString());
        var phrases = resources["Xray.Engine.Tests.Resources.Phrases.resources"]!.AsObject();
        Assert.True((bool?)phrases["public"]);
        Assert.Null(phrases["data"]);
        Assert.Null(phrases["notDecoded"]);
        Assert.Contains(
            """{"name":"Lines","kind":"string","value":"first\r\nsecond"}""",
            phrases["entries"]!.AsArray().Select(entry => entry!.ToJsonString()));
    }

    [Fact]
    public void ResourcesRefusesANativeExecutable()
    {
        var response = Resources(PeClassifierTests.NativeExecutable);

        Assert.Equal("not-a-managed-assembly", ErrorCode(response));
    }

    [Fact]
    public void ResourcesReportsAMissingFile()
    {
        Assert.Equal("file-not-found", ErrorCode(Resources(Path.Combine(AppContext.BaseDirectory, "no-such-file.dll"))));
    }

    [Fact]
    public void InspectReportsALibraryWithANullEntryPoint()
    {
        var result = Inspect(typeof(ICSharpCode.Decompiler.CSharp.CSharpDecompiler).Assembly.Location)["result"]!.AsObject();

        Assert.True(result.ContainsKey("entryPoint"));
        Assert.Null(result["entryPoint"]);
    }

    [Fact]
    public void InspectRefusesANativeExecutable()
    {
        var response = Inspect(PeClassifierTests.NativeExecutable);

        Assert.Equal("not-a-managed-assembly", ErrorCode(response));
        Assert.Equal($"{PeClassifierTests.NativeExecutable} is not a Managed Assembly.", (string?)response["error"]!["message"]);
    }

    [Fact]
    public void InspectReportsAMissingFile()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "no-such-file.dll");

        var response = Inspect(path);

        Assert.Equal("file-not-found", ErrorCode(response));
        Assert.Equal($"There is no file at {path}.", (string?)response["error"]!["message"]);
    }

    [Fact]
    public void InspectReportsAFolder()
    {
        Assert.Equal("not-a-file", ErrorCode(Inspect(AppContext.BaseDirectory)));
    }

    [Theory]
    [InlineData("""{"id":10,"command":"inspect"}""")]
    [InlineData("""{"id":10,"command":"inspect","params":{"path":""}}""")]
    public void InspectNeedsAPath(string line)
    {
        var response = Send(HandshakenSession(), line);

        Assert.Equal("invalid-params", ErrorCode(response));
        Assert.Equal("\"inspect\" needs a non-empty string \"path\".", (string?)response["error"]!["message"]);
    }

    private static JsonObject Decompile(JsonObject parameters) =>
        Send(HandshakenSession(), new JsonObject
        {
            ["id"] = 11,
            ["command"] = "decompile",
            ["params"] = parameters,
        }.ToJsonString());

    private static JsonObject Decompile(string path, string languageVersion = "12.0") =>
        Decompile(new JsonObject { ["path"] = path, ["languageVersion"] = languageVersion });

    [Fact]
    public void DecompileAnswersTheAssemblyAttributesAndEachTopLevelTypesCode()
    {
        var response = Decompile(PeClassifierTests.ManagedAssembly);

        Assert.Equal(11, (int?)response["id"]);
        Assert.Null(response["error"]);
        var result = response["result"]!.AsObject();
        Assert.Contains("[assembly: AssemblyVersion(\"0.0.0.0\")]", (string?)result["assemblyAttributes"]);
        Assert.Equal(["assemblyAttributes", "unsafeCode", "nullableAnnotations", "types", "xaml"], result.Select(property => property.Key));
        Assert.False((bool?)result["unsafeCode"]);
        Assert.True((bool?)result["nullableAnnotations"]);
        var session = Assert.Single(
            result["types"]!.AsArray(),
            type => (string?)type!["namespace"] == "Xray.Engine" && (string?)type["name"] == "Session")!;
        Assert.Equal(["namespace", "name", "code", "sourceFile", "sourcePath", "declares"], session.AsObject().Select(property => property.Key));
        Assert.Equal("""[{"namespace":"Xray.Engine","name":"Session"}]""", session["declares"]!.ToJsonString());
        Assert.Contains("internal sealed class Session\n", (string?)session["code"]);
        // It declares no file-scoped types, and no PDB was given.
        Assert.Null(session["sourceFile"]);
        Assert.Null(session["sourcePath"]);
    }

    [Fact]
    public void DecompileWithTheAssemblysOwnPdbSaysWhereEachUnitsSourceFileWas()
    {
        var types = Decompile(new JsonObject
        {
            ["path"] = DebugSymbolsTests.Subjects,
            ["languageVersion"] = "12.0",
            ["pdbPath"] = DebugSymbolsTests.SubjectsPdb,
        })["result"]!["types"]!.AsArray();

        var unit = Assert.Single(types, type => Path.GetFileName((string?)type!["sourcePath"]) == "DebugSymbolSubjects.cs")!;
        Assert.Contains("int runningTotal = 0;", (string?)unit["code"]);
        Assert.Equal(
            """[{"namespace":"Xray.Engine.Tests.Other","name":"Neighbour"},{"namespace":"Xray.Engine.Tests.Subjects","name":"Tally"},{"namespace":"Xray.Engine.Tests.Subjects","name":"Halves"},{"namespace":"Xray.Engine.Tests.Subjects","name":"ICounted"}]""",
            unit["declares"]!.ToJsonString());
    }

    [Fact]
    public void DecompileAnswersTheXamlOfTheWpfResources()
    {
        var result = Decompile(new JsonObject
        {
            ["path"] = WpfXamlTests.Subject,
            ["languageVersion"] = "12.0",
            ["referenceDirectories"] = new JsonArray([.. WpfXamlTests.WindowsDesktopReferences().Select(directory => JsonValue.Create(directory))]),
        })["result"]!.AsObject();

        var xaml = result["xaml"]!.AsObject();
        Assert.Equal(["resource", "documents", "notDecompiled"], xaml.Select(property => property.Key));
        Assert.Equal("Swatch.g.resources", (string?)xaml["resource"]);
        Assert.Null(xaml["notDecompiled"]);
        var app = Assert.Single(xaml["documents"]!.AsArray(), document => (string?)document!["entry"] == "app.baml")!;
        Assert.Equal(["entry", "class", "applicationDefinition", "code"], app.AsObject().Select(property => property.Key));
        Assert.Equal("Swatch.App", (string?)app["class"]);
        Assert.True((bool?)app["applicationDefinition"]);
        Assert.StartsWith("<Application x:Class=\"Swatch.App\"", (string?)app["code"]);
    }

    [Fact]
    public void DecompileAnswersNoXamlForAnAssemblyWithoutWpfResources()
    {
        var result = Decompile(PeClassifierTests.ManagedAssembly)["result"]!.AsObject();

        Assert.True(result.ContainsKey("xaml"));
        Assert.Null(result["xaml"]);
    }

    [Theory]
    [InlineData("inspect", """{"path":"x.dll","pdbPath":""}""")]
    [InlineData("inspect", """{"path":"x.dll","pdbPath":7}""")]
    [InlineData("decompile", """{"path":"x.dll","languageVersion":"12.0","pdbPath":""}""")]
    [InlineData("decompile", """{"path":"x.dll","languageVersion":"12.0","pdbPath":["x.pdb"]}""")]
    public void APdbPathIfGivenMustBeANonEmptyString(string command, string parameters)
    {
        var response = Send(HandshakenSession(), new JsonObject
        {
            ["id"] = 12,
            ["command"] = command,
            ["params"] = JsonNode.Parse(parameters),
        }.ToJsonString());

        Assert.Equal("invalid-params", ErrorCode(response));
        Assert.Equal($"\"{command}\" needs \"pdbPath\", if given, to be a non-empty string.", (string?)response["error"]!["message"]);
    }

    [Theory]
    [InlineData("""{"path":"x.dll","languageVersion":"12.0","referenceDirectories":"refs"}""")]
    [InlineData("""{"path":"x.dll","languageVersion":"12.0","referenceDirectories":[""]}""")]
    [InlineData("""{"path":"x.dll","languageVersion":"12.0","referenceDirectories":[7]}""")]
    public void ReferenceDirectoriesIfGivenMustBeNonEmptyStrings(string parameters)
    {
        var response = Decompile(JsonNode.Parse(parameters)!.AsObject());

        Assert.Equal("invalid-params", ErrorCode(response));
        Assert.Equal("\"decompile\" needs \"referenceDirectories\", if given, to be an array of non-empty strings.", (string?)response["error"]!["message"]);
    }

    [Fact]
    public void DecompileTakesFoldersToFindReferencesIn()
    {
        var response = Decompile(new JsonObject
        {
            ["path"] = PeClassifierTests.ManagedAssembly,
            ["languageVersion"] = "12.0",
            ["referenceDirectories"] = new JsonArray(AppContext.BaseDirectory),
        });

        Assert.Null(response["error"]);
        Assert.NotEmpty(response["result"]!["types"]!.AsArray());
    }

    [Fact]
    public void DecompileSendsProgressBeforeEachTypeWithTheRequestsId()
    {
        var notifications = new List<string>();
        var session = new Session(notifications.Add);
        Send(session, Handshake(1));

        var response = Send(session, new JsonObject
        {
            ["id"] = 11,
            ["command"] = "decompile",
            ["params"] = new JsonObject { ["path"] = PeClassifierTests.ManagedAssembly, ["languageVersion"] = "12.0" },
        }.ToJsonString());

        var types = response["result"]!["types"]!.AsArray();
        var progress = notifications.Select(line => JsonNode.Parse(line)!.AsObject()).ToList();
        Assert.All(progress, line => Assert.Equal(["id", "progress"], line.Select(property => property.Key)));
        Assert.All(progress, line => Assert.Equal(11, (int?)line["id"]));
        Assert.All(progress, line => Assert.Equal(["done", "total", "current"], line["progress"]!.AsObject().Select(property => property.Key)));
        var reported = progress
            .Select(line => ((int)line["progress"]!["done"]!, (int)line["progress"]!["total"]!, (string)line["progress"]!["current"]!))
            .ToList();
        // Types are decompiled several at once, so how many are done never goes
        // down, nor counts a type not yet reported, but can stay the same.
        Assert.Equal(reported.Select(line => line.Item1).Order(), reported.Select(line => line.Item1));
        Assert.All(reported.Select((line, position) => (line.Item1, position)), line => Assert.InRange(line.Item1, 0, line.position));
        Assert.All(reported, line => Assert.Equal(reported.Count, line.Item2));
        // A line per top-level type, each a unit of its own: the engine declares
        // no file-scoped types, and those its regular expressions' source
        // generator writes are left to the generator (LeaveRegexesToGenerator).
        Assert.Equal(types.Count, reported.Count);
        Assert.Equal(reported.Select(line => line.Item3).Order(), types.Select(type => FullName(type!)).Order());
    }

    [Fact]
    public void OnlyDecompileSendsProgress()
    {
        var notifications = new List<string>();
        var session = new Session(notifications.Add);
        Send(session, Handshake(1));

        Send(session, """{"id":2,"command":"ping"}""");
        Send(session, new JsonObject
        {
            ["id"] = 3,
            ["command"] = "inspect",
            ["params"] = new JsonObject { ["path"] = PeClassifierTests.ManagedAssembly },
        }.ToJsonString());

        Assert.Empty(notifications);
    }

    private static string FullName(JsonNode type) =>
        (string?)type["namespace"] is "" ? (string)type["name"]! : $"{type["namespace"]}.{type["name"]}";

    [Theory]
    [InlineData("7.3", "namespace Xray.Engine\n{")]
    [InlineData("12.0", "namespace Xray.Engine;")]
    public void DecompileWritesTheLanguageVersionAskedFor(string languageVersion, string expected)
    {
        var types = Decompile(PeClassifierTests.ManagedAssembly, languageVersion)["result"]!["types"]!.AsArray();

        Assert.Contains(expected, (string?)types.Single(type => (string?)type!["name"] == "Session")!["code"]);
    }

    [Theory]
    [InlineData("""{"path":"x.dll"}""")]
    [InlineData("""{"path":"x.dll","languageVersion":12}""")]
    [InlineData("""{"path":"x.dll","languageVersion":"twelve"}""")]
    [InlineData("""{"path":"x.dll","languageVersion":"99.0"}""")]
    [InlineData("""{"path":"x.dll","languageVersion":"12.0.1"}""")]
    public void DecompileNeedsALanguageVersionItKnows(string parameters)
    {
        var response = Decompile(JsonNode.Parse(parameters)!.AsObject());

        Assert.Equal("invalid-params", ErrorCode(response));
        Assert.Equal(
            "\"decompile\" needs a \"languageVersion\" naming a C# version, such as \"12.0\".",
            (string?)response["error"]!["message"]);
    }

    [Fact]
    public void DecompileNeedsAPath()
    {
        var response = Decompile(new JsonObject { ["languageVersion"] = "12.0" });

        Assert.Equal("invalid-params", ErrorCode(response));
        Assert.Equal("\"decompile\" needs a non-empty string \"path\".", (string?)response["error"]!["message"]);
    }

    [Fact]
    public void DecompileRefusesANativeExecutable()
    {
        Assert.Equal("not-a-managed-assembly", ErrorCode(Decompile(PeClassifierTests.NativeExecutable)));
    }

    [Fact]
    public void DecompileReportsAMissingFile()
    {
        Assert.Equal("file-not-found", ErrorCode(Decompile(Path.Combine(AppContext.BaseDirectory, "no-such-file.dll"))));
    }
}
