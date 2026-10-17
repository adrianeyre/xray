using System.Reflection;
using System.Reflection.PortableExecutable;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using ICSharpCode.Decompiler.CSharp;

namespace Xray.Engine;

/// <summary>
/// One client conversation. Each request line yields exactly one response line:
/// <c>{"id":1,"command":"ping","params":{}}</c> →
/// <c>{"id":1,"result":{}}</c> or <c>{"id":1,"error":{"code":"…","message":"…"}}</c>.
/// A long command may first send any number of progress lines, carrying its
/// request's id, through the session's notifier:
/// <c>{"id":1,"progress":{"done":3,"total":40,"current":"App.Program"}}</c>.
/// <list type="bullet">
/// <item><c>handshake {protocolVersion}</c> → <c>{protocolVersion, engineVersion, decompilerVersion}</c></item>
/// <item><c>ping</c> → <c>{}</c></item>
/// <item><c>classify {path}</c> → <c>{kind, machine?, reason?}</c>: see <see cref="Classify"/></item>
/// <item><c>inspect {path, pdbPath?}</c> → the Managed Assembly's metadata, whether the PDB is its own, and the marks of obfuscation it holds: see <see cref="Inspect"/></item>
/// <item><c>decompile {path, languageVersion, pdbPath?, referenceDirectories?}</c> → its C#, one unit per top-level type, and the XAML of its WPF resources: see <see cref="Decompile"/></item>
/// <item><c>resources {path}</c> → the Assembly's name and the resources of its manifest: see <see cref="Resources"/></item>
/// </list>
/// </summary>
internal sealed class Session
{
    // Responses only ever reach the core client, never HTML, so keep quotes and
    // non-ASCII readable rather than \u-escaped.
    private static readonly JsonSerializerOptions WireFormat = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly Action<string> notify;
    private bool handshakeDone;

    /// <param name="notify">Sends a progress line to the client while a command runs, ahead of its response.</param>
    public Session(Action<string>? notify = null)
    {
        this.notify = notify ?? (_ => { });
    }

    public string Handle(string line)
    {
        JsonNode? id = null;
        try
        {
            if (!TryParseRequest(line, out id, out var command, out var parameters, out var problem))
            {
                return Error(id, Protocol.ErrorCodes.InvalidRequest, problem);
            }

            if (command == "handshake")
            {
                return Handshake(id, parameters);
            }

            if (!handshakeDone)
            {
                return Error(id, Protocol.ErrorCodes.HandshakeRequired, $"Send \"handshake\" before \"{command}\".");
            }

            return command switch
            {
                "ping" => Result(id, new JsonObject()),
                "classify" => WithFile(id, command, parameters, Classify),
                "inspect" => WithPdb(id, command, parameters, pdbPath => WithFile(id, command, parameters, path => Inspect(path, pdbPath))),
                "decompile" => Decompile(id, command, parameters),
                "resources" => WithFile(id, command, parameters, Resources),
                _ => Error(id, Protocol.ErrorCodes.UnknownCommand, $"Unknown command \"{command}\"."),
            };
        }
        catch (Exception exception)
        {
            return Error(id, Protocol.ErrorCodes.InternalError, exception.Message);
        }
    }

    private string Handshake(JsonNode? id, JsonObject parameters)
    {
        if (parameters["protocolVersion"] is not JsonValue requested || !requested.TryGetValue(out int clientVersion))
        {
            return Error(id, Protocol.ErrorCodes.InvalidRequest, "\"handshake\" needs an integer \"protocolVersion\".");
        }

        if (clientVersion != Protocol.Version)
        {
            return Error(
                id,
                Protocol.ErrorCodes.ProtocolMismatch,
                $"The client speaks engine protocol version {clientVersion} but this engine speaks version {Protocol.Version}.");
        }

        handshakeDone = true;
        return Result(id, new JsonObject
        {
            ["protocolVersion"] = Protocol.Version,
            ["engineVersion"] = InformationalVersion(typeof(Session).Assembly),
            ["decompilerVersion"] = InformationalVersion(typeof(CSharpDecompiler).Assembly),
        });
    }

    /// <summary>
    /// Runs a command on the file at <c>params.path</c> (ideally absolute;
    /// otherwise relative to the engine's working directory), reporting a
    /// missing, unreadable or unsuitable file as an error rather than a crash.
    /// </summary>
    private static string WithFile(JsonNode? id, string command, JsonObject parameters, Func<string, JsonObject> run)
    {
        if (parameters["path"] is not JsonValue pathValue || !pathValue.TryGetValue(out string? path) || path == "")
        {
            return Error(id, Protocol.ErrorCodes.InvalidParams, $"\"{command}\" needs a non-empty string \"path\".");
        }

        try
        {
            return Result(id, run(path));
        }
        catch (InspectionException exception)
        {
            return Error(id, exception.Code, exception.Message);
        }
        // Before "not found": opening a folder as a file can throw FileNotFoundException on Windows.
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException && Directory.Exists(path))
        {
            return Error(id, Protocol.ErrorCodes.NotAFile, $"{path} is a folder, not a file.");
        }
        catch (Exception exception) when (exception is FileNotFoundException or DirectoryNotFoundException)
        {
            return Error(id, Protocol.ErrorCodes.FileNotFound, $"There is no file at {path}.");
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return Error(id, Protocol.ErrorCodes.FileUnreadable, $"Could not read {path}: {exception.Message}");
        }
    }

    /// <summary>
    /// Runs a command given the optional <c>params.pdbPath</c>: the path of a
    /// PDB to read beside the Assembly, which must be a non-empty string if
    /// present.
    /// </summary>
    private static string WithPdb(JsonNode? id, string command, JsonObject parameters, Func<string?, string> run)
    {
        switch (parameters["pdbPath"])
        {
            case null:
                return run(null);
            case JsonValue value when value.TryGetValue(out string? pdbPath) && pdbPath != "":
                return run(pdbPath);
            default:
                return Error(id, Protocol.ErrorCodes.InvalidParams, $"\"{command}\" needs \"pdbPath\", if given, to be a non-empty string.");
        }
    }

    /// <summary>
    /// Reads the file's PE headers and answers
    /// <c>{"kind":"managed-assembly","machine":"I386"}</c>,
    /// <c>{"kind":"native-executable","machine":"Amd64"}</c> or
    /// <c>{"kind":"not-pe","reason":"no-dos-header"}</c>. <c>machine</c> is the
    /// name of a <see cref="Machine"/> value (or its number, if unnamed);
    /// <c>reason</c> is <c>no-dos-header</c>, <c>no-pe-header</c> or
    /// <c>malformed-pe-headers</c>.
    /// </summary>
    private static JsonObject Classify(string path)
    {
        var classification = PeClassifier.Classify(path);
        var result = new JsonObject { ["kind"] = WireName(classification.Kind) };
        if (classification.Machine is { } machine)
        {
            result["machine"] = machine.ToString();
        }

        if (classification.Reason is { } reason)
        {
            result["reason"] = WireName(reason);
        }

        return result;
    }

    /// <summary>
    /// Reads a Managed Assembly's metadata and answers it as recorded (see
    /// <see cref="AssemblyMetadata"/>):
    /// <code>
    /// {"assembly":{"name":"App","version":"1.0.0.0","culture":null,"publicKeyToken":null},
    ///  "references":[{"name":"System.Runtime","version":"8.0.0.0","culture":null,"publicKeyToken":"b03f5f7f11d50a3a"}],
    ///  "targetFramework":".NETCoreApp,Version=v8.0","targetPlatform":null,"runtimeVersion":"v4.0.30319",
    ///  "informationalVersion":"1.0.0+5e3c9a1",
    ///  "machine":"I386","pe32Plus":false,"corFlags":{"ilOnly":true,"requires32Bit":false,"prefers32Bit":false},
    ///  "subsystem":"windows-cui","entryPoint":{"type":"App.Program","method":"Main"},
    ///  "typeCount":2,"methodCount":3,"resourceCount":0,
    ///  "pdb":{"format":"portable","mismatch":null},
    ///  "obfuscation":{"attributes":["System.Runtime.CompilerServices.CompilationRelaxationsAttribute"],
    ///   "names":{"count":5,"unprintable":0,"short":0,"unprintableExamples":[],"shortExamples":[]},
    ///   "strings":{"literals":1,"decoderCalls":0,"decoderTypes":[]}}}
    /// </code>
    /// <c>machine</c> is named as in <see cref="Classify"/>; <c>subsystem</c> is a
    /// <see cref="Subsystem"/> value's wire name. <c>pdb</c> is null unless
    /// <c>params.pdbPath</c> names a PDB to check (see <see cref="DebugSymbols"/>):
    /// its <c>format</c>, <c>portable</c> or <c>windows</c> (null if it is a PDB
    /// of neither), and why it is not the Assembly's own, a
    /// <see cref="PdbMismatch"/> value's wire name (null if it is). A file that
    /// is not a Managed Assembly is the error <c>not-a-managed-assembly</c>; one
    /// whose metadata cannot be read, <c>invalid-metadata</c>. <c>obfuscation</c>
    /// counts the marks of obfuscation it holds, for core to judge (see
    /// <see cref="ObfuscationEvidence"/>): the attributes applied to the
    /// assembly and its module, how many of its names are unprintable or one
    /// or two characters long, with the first few of each, and how many of its
    /// strings are literals and how many calls to string decoders, and which
    /// types hold those decoders.
    /// </summary>
    private static JsonObject Inspect(string path, string? pdbPath)
    {
        var metadata = AssemblyInspector.Inspect(path);
        var pdb = pdbPath is null ? null : DebugSymbols.Check(path, pdbPath);
        return new JsonObject
        {
            ["assembly"] = Identity(metadata.Assembly),
            ["references"] = new JsonArray([.. metadata.References.Select(Identity)]),
            ["targetFramework"] = metadata.TargetFramework,
            ["targetPlatform"] = metadata.TargetPlatform,
            ["runtimeVersion"] = metadata.RuntimeVersion,
            ["informationalVersion"] = metadata.InformationalVersion,
            ["machine"] = metadata.Machine.ToString(),
            ["pe32Plus"] = metadata.Pe32Plus,
            ["corFlags"] = new JsonObject
            {
                ["ilOnly"] = metadata.CorFlags.HasFlag(CorFlags.ILOnly),
                ["requires32Bit"] = metadata.CorFlags.HasFlag(CorFlags.Requires32Bit),
                ["prefers32Bit"] = metadata.CorFlags.HasFlag(CorFlags.Prefers32Bit),
            },
            ["subsystem"] = WireName(metadata.Subsystem),
            ["entryPoint"] = metadata.EntryPoint is { } entryPoint
                ? new JsonObject { ["type"] = entryPoint.Type, ["method"] = entryPoint.Method }
                : null,
            ["typeCount"] = metadata.TypeCount,
            ["methodCount"] = metadata.MethodCount,
            ["resourceCount"] = metadata.ResourceCount,
            ["pdb"] = pdb is null
                ? null
                : new JsonObject
                {
                    ["format"] = pdb.Format is { } format ? WireName(format) : null,
                    ["mismatch"] = pdb.Mismatch is { } mismatch ? WireName(mismatch) : null,
                },
            ["obfuscation"] = Obfuscation(metadata.Obfuscation),
        };
    }

    private static JsonObject Obfuscation(ObfuscationEvidence evidence) =>
        new()
        {
            ["attributes"] = Strings(evidence.Attributes),
            ["names"] = new JsonObject
            {
                ["count"] = evidence.Names.Count,
                ["unprintable"] = evidence.Names.Unprintable,
                ["short"] = evidence.Names.Short,
                ["unprintableExamples"] = Strings(evidence.Names.UnprintableExamples),
                ["shortExamples"] = Strings(evidence.Names.ShortExamples),
            },
            ["strings"] = new JsonObject
            {
                ["literals"] = evidence.Strings.Literals,
                ["decoderCalls"] = evidence.Strings.DecoderCalls,
                ["decoderTypes"] = Strings(evidence.Strings.DecoderTypes),
            },
        };

    private static JsonArray Strings(IEnumerable<string> values) => new([.. values.Select(value => JsonValue.Create(value))]);

    /// <summary>
    /// Decompiles a Managed Assembly to C# of the given language version
    /// (<c>params.languageVersion</c>, as a project's <c>LangVersion</c>
    /// writes it: <c>"7.3"</c>, <c>"12.0"</c>…) and answers
    /// <code>
    /// {"assemblyAttributes":"using System.Reflection;\n\n[assembly: AssemblyVersion(\"1.0.0.0\")]\n",
    ///  "unsafeCode":false,"nullableAnnotations":true,
    ///  "types":[{"namespace":"App","name":"Program","code":"namespace App;\n\ninternal static class Program\n{…}\n","sourceFile":null,"sourcePath":null,
    ///    "declares":[{"namespace":"App","name":"Program"}]}],
    ///  "xaml":null}
    /// </code>
    /// with a <c>types</c> entry for every top-level type a project declares, in
    /// metadata order, except that a file-scoped type is declared in the
    /// <c>code</c> of the types that use it, whose <c>sourceFile</c> names the
    /// file it was declared in (see <see cref="AssemblyDecompiler"/>). Given
    /// <c>params.pdbPath</c>, the Assembly's own PDB, locals keep their names,
    /// and the types of each source file it records are declared in the
    /// <c>code</c> of the first of them, whose <c>sourcePath</c> is that file's
    /// path, as recorded; any other PDB is ignored. <c>declares</c> names every
    /// top-level type a unit declares, its own first. <c>unsafeCode</c>
    /// and <c>nullableAnnotations</c> say whether the module was compiled with
    /// unsafe code allowed, and with nullable annotations, as its metadata
    /// records (see <see cref="DecompiledAssembly"/>). Given
    /// <c>params.referenceDirectories</c>, the assemblies it references are
    /// looked for in those folders too, after the decompiler's own places
    /// (see <see cref="AssemblyDecompiler.Decompile"/>). Lines end in
    /// <c>\n</c>. <c>xaml</c> is null unless the Assembly's WPF resources,
    /// <c>&lt;Assembly&gt;.g.resources</c>, hold BAML; then it is the XAML
    /// each BAML document decompiles to (see <see cref="WpfXamlReader"/>):
    /// <code>
    /// {"resource":"App.g.resources",
    ///  "documents":[{"entry":"mainwindow.baml","class":"App.MainWindow","applicationDefinition":false,"code":"&lt;Window x:Class=\"App.MainWindow\" …"}],
    ///  "notDecompiled":null}
    /// </code>
    /// with a <c>documents</c> entry for each, in the order the resources hold
    /// them: its <c>entry</c> there, named after its XAML file's path; the
    /// <c>class</c> its <c>x:Class</c> names, or null; and whether it is the
    /// app's <c>applicationDefinition</c>, whose class's <c>Main</c> the markup
    /// compiler generated as the entry point. The members the markup compiler
    /// generated of each such class, which it generates again from its XAML,
    /// are left out of <c>types</c>, and the class is declared
    /// <c>partial</c>. Should one document not decompile, <c>documents</c> is
    /// empty, <c>notDecompiled</c> says why, and every class keeps all its
    /// members. A type the decompiler fails on is the error
    /// <c>decompilation-failed</c>, naming it; a file that is not a Managed
    /// Assembly is <c>not-a-managed-assembly</c>, as for <see cref="Inspect"/>.
    /// Types are decompiled several at once, one on each processor; before
    /// each, a progress line says how many are done, of how many, and which
    /// it is starting on:
    /// <c>{"id":11,"progress":{"done":0,"total":2,"current":"App.Program"}}</c>.
    /// There is one for every type, and <c>done</c> never goes down, though it
    /// may stay the same from one to the next.
    /// </summary>
    private string Decompile(JsonNode? id, string command, JsonObject parameters)
    {
        if (parameters["languageVersion"] is not JsonValue versionValue
            || !versionValue.TryGetValue(out string? version)
            || LanguageVersionNamed(version) is not { } languageVersion)
        {
            return Error(
                id,
                Protocol.ErrorCodes.InvalidParams,
                $"\"{command}\" needs a \"languageVersion\" naming a C# version, such as \"12.0\".");
        }

        var referenceDirectories = new List<string>();
        switch (parameters["referenceDirectories"])
        {
            case null:
                break;
            case JsonArray directories when directories.All(directory => directory is JsonValue value && value.TryGetValue(out string? text) && text != ""):
                referenceDirectories.AddRange(directories.Select(directory => directory!.GetValue<string>()));
                break;
            default:
                return Error(
                    id,
                    Protocol.ErrorCodes.InvalidParams,
                    $"\"{command}\" needs \"referenceDirectories\", if given, to be an array of non-empty strings.");
        }

        return WithPdb(id, command, parameters, pdbPath => WithFile(id, command, parameters, path =>
        {
            var decompiled = AssemblyDecompiler.Decompile(
                path,
                languageVersion,
                progress => notify(Progress(id, new JsonObject
                {
                    ["done"] = progress.Done,
                    ["total"] = progress.Total,
                    ["current"] = progress.Current,
                })),
                pdbPath,
                referenceDirectories);
            return new JsonObject
            {
                ["assemblyAttributes"] = decompiled.AssemblyAttributes,
                ["unsafeCode"] = decompiled.UnsafeCode,
                ["nullableAnnotations"] = decompiled.NullableAnnotations,
                ["types"] = new JsonArray([
                    .. decompiled.Types.Select(type => new JsonObject
                    {
                        ["namespace"] = type.Namespace,
                        ["name"] = type.Name,
                        ["code"] = type.Code,
                        ["sourceFile"] = type.SourceFile,
                        ["sourcePath"] = type.SourcePath,
                        ["declares"] = new JsonArray([
                            .. type.Declares.Select(declared => new JsonObject
                            {
                                ["namespace"] = declared.Namespace,
                                ["name"] = declared.Name,
                            }),
                        ]),
                    }),
                ]),
                ["xaml"] = decompiled.Xaml is { } xaml
                    ? new JsonObject
                    {
                        ["resource"] = xaml.Resource,
                        ["documents"] = new JsonArray([
                            .. xaml.Documents.Select(document => new JsonObject
                            {
                                ["entry"] = document.Entry,
                                ["class"] = document.Class,
                                ["applicationDefinition"] = document.ApplicationDefinition,
                                ["code"] = document.Code,
                            }),
                        ]),
                        ["notDecompiled"] = xaml.NotDecompiled,
                    }
                    : null,
            };
        }));
    }

    /// <summary>
    /// Reads the resources of a Managed Assembly's manifest, as a satellite
    /// assembly's too (see <see cref="ManifestResources"/>), and answers
    /// <code>
    /// {"assembly":{"name":"App","version":"1.0.0.0","culture":null,"publicKeyToken":null},
    ///  "resources":[
    ///   {"name":"App.Strings.resources","public":true,"location":"embedded","linkedTo":null,"data":null,
    ///    "entries":[{"name":"Greeting","kind":"string","value":"Hello"},{"name":"Logo","kind":"bytes","value":"iVBORw0…"}],
    ///    "notDecoded":null},
    ///   {"name":"App.Limits.resources","public":true,"location":"embedded","linkedTo":null,"data":"zsrvvgEAAAC…",
    ///    "entries":null,"notDecoded":"Its entry \"Max\" is a System.Int32, not a string, a byte[] or a stream."},
    ///   {"name":"App.Assets.logo.png","public":false,"location":"embedded","linkedTo":null,"data":"iVBORw0…",
    ///    "entries":null,"notDecoded":null}]}
    /// </code>
    /// with a <c>resources</c> entry for each, in metadata order.
    /// <c>location</c> is <c>embedded</c> (its bytes in the Assembly),
    /// <c>file</c> or <c>assembly</c> (in the file or assembly
    /// <c>linkedTo</c> names). <c>data</c> holds an embedded resource's bytes,
    /// in base64, unless it is a <c>.resources</c> file whose <c>entries</c>,
    /// each a <c>string</c>, <c>bytes</c> or <c>stream</c> (the bytes in
    /// base64), are given instead; <c>notDecoded</c> says why a
    /// <c>.resources</c> file's are not. A file that is not a Managed Assembly
    /// is the error <c>not-a-managed-assembly</c>; one whose metadata cannot be
    /// read, <c>invalid-metadata</c>, as for <see cref="Inspect"/>.
    /// </summary>
    private static JsonObject Resources(string path)
    {
        var read = ManifestResources.Read(path);
        return new JsonObject
        {
            ["assembly"] = Identity(read.Assembly),
            ["resources"] = new JsonArray([
                .. read.Resources.Select(resource => new JsonObject
                {
                    ["name"] = resource.Name,
                    ["public"] = resource.Public,
                    ["location"] = WireName(resource.Location),
                    ["linkedTo"] = resource.LinkedTo,
                    ["data"] = resource.Bytes is { } bytes ? Convert.ToBase64String(bytes) : null,
                    ["entries"] = resource.Entries is { } entries
                        ? new JsonArray([
                            .. entries.Select(entry => new JsonObject
                            {
                                ["name"] = entry.Name,
                                ["kind"] = WireName(entry.Kind),
                                ["value"] = entry.Text ?? Convert.ToBase64String(entry.Bytes!),
                            }),
                        ])
                        : null,
                    ["notDecoded"] = resource.NotDecoded,
                }),
            ]),
        };
    }

    /// <summary><c>"7.3"</c> → <c>CSharp7_3</c>, <c>"12.0"</c> → <c>CSharp12_0</c>, <c>"6.0"</c> → <c>CSharp6</c>.</summary>
    private static LanguageVersion? LanguageVersionNamed(string? version)
    {
        if (version is null || !System.Version.TryParse(version, out var parsed) || parsed.Build != -1)
        {
            return null;
        }

        foreach (var name in new[] { $"CSharp{parsed.Major}_{parsed.Minor}", parsed.Minor == 0 ? $"CSharp{parsed.Major}" : null })
        {
            if (name is not null && Enum.TryParse<LanguageVersion>(name, out var languageVersion))
            {
                return languageVersion;
            }
        }

        return null;
    }

    private static JsonObject Identity(AssemblyIdentity identity) =>
        new()
        {
            ["name"] = identity.Name,
            ["version"] = identity.Version,
            ["culture"] = identity.Culture,
            ["publicKeyToken"] = identity.PublicKeyToken,
        };

    /// <summary><c>ManagedAssembly</c> → <c>managed-assembly</c>.</summary>
    private static string WireName<T>(T value)
        where T : struct, Enum =>
        string.Concat(value.ToString().Select((c, i) => char.IsUpper(c) && i > 0 ? $"-{char.ToLowerInvariant(c)}" : $"{char.ToLowerInvariant(c)}"));

    private static bool TryParseRequest(
        string line,
        out JsonNode? id,
        out string command,
        out JsonObject parameters,
        out string problem)
    {
        id = null;
        command = "";
        parameters = [];

        JsonNode? request;
        try
        {
            request = JsonNode.Parse(line);
        }
        catch (JsonException exception)
        {
            problem = $"The request is not valid JSON: {exception.Message}";
            return false;
        }

        if (request is not JsonObject body)
        {
            problem = "The request must be a JSON object.";
            return false;
        }

        if (body["id"] is JsonValue idValue && idValue.TryGetValue(out long _))
        {
            id = idValue.DeepClone();
        }
        else
        {
            problem = "The request needs an integer \"id\".";
            return false;
        }

        if (body["command"] is not JsonValue commandValue || !commandValue.TryGetValue(out string? name))
        {
            problem = "The request needs a string \"command\".";
            return false;
        }

        switch (body["params"])
        {
            case null:
                break;
            case JsonObject given:
                parameters = given;
                break;
            default:
                problem = "\"params\", when present, must be a JSON object.";
                return false;
        }

        command = name;
        problem = "";
        return true;
    }

    private static string InformationalVersion(Assembly assembly) =>
        assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? assembly.GetName().Version?.ToString()
        ?? "unknown";

    private static string Result(JsonNode? id, JsonObject result) =>
        new JsonObject { ["id"] = id, ["result"] = result }.ToJsonString(WireFormat);

    private static string Progress(JsonNode? id, JsonObject progress) =>
        new JsonObject { ["id"] = id?.DeepClone(), ["progress"] = progress }.ToJsonString(WireFormat);

    private static string Error(JsonNode? id, string code, string message) =>
        new JsonObject
        {
            ["id"] = id,
            ["error"] = new JsonObject { ["code"] = code, ["message"] = message },
        }.ToJsonString(WireFormat);
}
