using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using ICSharpCode.Decompiler.DebugInfo;
using Mono.Cecil.Pdb;
using Cecil = Mono.Cecil;
using SequencePoint = ICSharpCode.Decompiler.DebugInfo.SequencePoint;

namespace Xray.Engine;

/// <summary>The two formats a PDB can be in.</summary>
internal enum PdbFormat
{
    /// <summary>The cross-platform format the .NET SDK writes by default: ECMA-335 metadata tables.</summary>
    Portable,

    /// <summary>The older MSF format, written only on Windows (<c>DebugType</c> <c>full</c> or <c>pdbonly</c>).</summary>
    Windows,
}

/// <summary>Why a PDB beside an Assembly is not its own, so is not used.</summary>
internal enum PdbMismatch
{
    /// <summary>The Assembly records no PDB at all: it was built without debug information.</summary>
    Unrecorded,

    /// <summary>The Assembly records a PDB, but not this one: this is another build's.</summary>
    OtherBuild,

    /// <summary>The file is a PDB of neither format, or cannot be read as one.</summary>
    Unreadable,
}

/// <summary>What a PDB beside an Assembly is, and whether it is the Assembly's own.</summary>
/// <param name="Format">null when the file is a PDB of neither format.</param>
/// <param name="Mismatch">null when it is the Assembly's own PDB.</param>
internal sealed record PdbCheck(PdbFormat? Format, PdbMismatch? Mismatch);

/// <summary>
/// The PDB an Assembly was built with, portable or Windows, read without
/// loading or running anything: the names of each method's locals, which the
/// decompiler gives them, and the source file each top-level type was declared
/// in. Only the Assembly's own PDB opens: one whose ID differs from the one
/// the Assembly's CodeView debug directory entry records is another build's,
/// whose names and lines would be wrong.
/// </summary>
internal abstract class DebugSymbols : IDebugInfoProvider, IDisposable
{
    private static readonly byte[] PortableSignature = "BSJB"u8.ToArray();
    private static readonly byte[] WindowsSignature = "Microsoft C/C++ MSF 7.00\r\n\u001aDS\0\0\0"u8.ToArray();

    private readonly PEReader assembly;

    private protected DebugSymbols(PEReader assembly, string pdbPath)
    {
        this.assembly = assembly;
        SourceFileName = pdbPath;
    }

    public abstract string Description { get; }

    /// <summary>The PDB, as the path it was opened from.</summary>
    public string SourceFileName { get; }

    /// <summary>The Assembly's own metadata, read apart from the decompiler's.</summary>
    private protected MetadataReader Metadata => assembly.GetMetadataReader();

    /// <summary>Whether the PDB at <paramref name="pdbPath"/> is the Assembly's own, and in which format.</summary>
    public static PdbCheck Check(string assemblyPath, string pdbPath)
    {
        using var symbols = Open(assemblyPath, pdbPath, out var check);
        return check;
    }

    /// <summary>
    /// The PDB at <paramref name="pdbPath"/>, if it is the Assembly's own;
    /// otherwise null, with <paramref name="check"/> saying why not.
    /// </summary>
    public static DebugSymbols? Open(string assemblyPath, string pdbPath, out PdbCheck check)
    {
        byte[] pdb;
        try
        {
            pdb = File.ReadAllBytes(pdbPath);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            check = new PdbCheck(null, PdbMismatch.Unreadable);
            return null;
        }

        PdbFormat? format = pdb.AsSpan().StartsWith(PortableSignature) ? PdbFormat.Portable
            : pdb.AsSpan().StartsWith(WindowsSignature) ? PdbFormat.Windows
            : null;
        if (format is not { } known)
        {
            check = new PdbCheck(null, PdbMismatch.Unreadable);
            return null;
        }

        var image = File.ReadAllBytes(assemblyPath);
        var assembly = new PEReader(ImmutableArray.Create(image));
        DebugSymbols? symbols = null;
        try
        {
            var codeView = assembly.ReadDebugDirectory().Where(entry => entry.Type == DebugDirectoryEntryType.CodeView).ToList();
            if (codeView.Count == 0)
            {
                check = new PdbCheck(known, PdbMismatch.Unrecorded);
                return null;
            }

            symbols = known == PdbFormat.Portable
                ? PortableSymbols.Open(assembly, codeView, pdb, pdbPath)
                : WindowsSymbols.Open(assembly, image, pdb, pdbPath);
            check = new PdbCheck(known, symbols is null ? PdbMismatch.OtherBuild : null);
            return symbols;
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            // Whatever a corrupt PDB makes either reader throw.
            check = new PdbCheck(known, PdbMismatch.Unreadable);
            return null;
        }
        finally
        {
            if (symbols is null)
            {
                assembly.Dispose();
            }
        }
    }

    /// <summary>
    /// The source file a top-level type was declared in, as the PDB records
    /// its path: the one most of its own methods were compiled from, the first
    /// of them on a tie (a partial type can be declared in several); failing
    /// that, the one most of its nested types' methods were, which is where a
    /// type whose code is all in those, such as lambdas, iterators and nested
    /// classes, was declared; failing that, for a type with no code at all,
    /// such as an interface or an enum, the documents a portable PDB records
    /// for such types. null if the PDB records none. Methods among
    /// <paramref name="generated"/>, which a generator wrote into a file of
    /// its own, and writes again (the markup compiler a WPF class's, in
    /// <c>obj/…/MainWindow.g.cs</c>; the regex source generator a
    /// <c>[GeneratedRegex]</c> method's body, in <c>RegexGenerator.g.cs</c>),
    /// are not counted, of the type or of its nested types.
    /// </summary>
    public string? DocumentOf(TypeDefinitionHandle type, IReadOnlySet<EntityHandle>? generated = null)
    {
        var nested = TypesWithin(type).Skip(1);
        return MostCommonDocument(Metadata.GetTypeDefinition(type).GetMethods().Where(method => generated?.Contains(method) != true))
            ?? MostCommonDocument(nested.SelectMany(within => Metadata.GetTypeDefinition(within).GetMethods()).Where(method => generated?.Contains(method) != true))
            ?? TypesWithin(type).SelectMany(DocumentsOfType).FirstOrDefault();
    }

    /// <summary>The document most of the methods were compiled from, the first of them on a tie.</summary>
    private string? MostCommonDocument(IEnumerable<MethodDefinitionHandle> methods)
    {
        var counts = new List<(string Document, int Methods)>();
        foreach (var method in methods)
        {
            foreach (var document in DocumentsOf(method).Distinct())
            {
                var index = counts.FindIndex(count => count.Document == document);
                if (index < 0)
                {
                    counts.Add((document, 1));
                }
                else
                {
                    counts[index] = (document, counts[index].Methods + 1);
                }
            }
        }

        return counts.Count == 0 ? null : counts.MaxBy(count => count.Methods).Document;
    }

    public abstract IList<SequencePoint> GetSequencePoints(MethodDefinitionHandle method);

    public abstract IList<Variable> GetVariables(MethodDefinitionHandle method);

    public bool TryGetName(MethodDefinitionHandle method, int index, out string name)
    {
        foreach (var variable in GetVariables(method))
        {
            if (variable.Index == index)
            {
                name = variable.Name;
                return true;
            }
        }

        name = null!;
        return false;
    }

    /// <summary>Tuple element names and <c>dynamic</c> are left to the decompiler to infer, as without a PDB.</summary>
    public bool TryGetExtraTypeInfo(MethodDefinitionHandle method, int index, out PdbExtraTypeInfo extraTypeInfo)
    {
        extraTypeInfo = default;
        return false;
    }

    public virtual void Dispose() => assembly.Dispose();

    /// <summary>The documents a method's sequence points lie in, as the PDB records their paths.</summary>
    private protected abstract IEnumerable<string> DocumentsOf(MethodDefinitionHandle method);

    /// <summary>The documents the PDB records a type was declared in apart from its methods'.</summary>
    private protected virtual IEnumerable<string> DocumentsOfType(TypeDefinitionHandle type) => [];

    /// <summary>The type and every type nested in it, however deep.</summary>
    private IEnumerable<TypeDefinitionHandle> TypesWithin(TypeDefinitionHandle type) =>
        Metadata.GetTypeDefinition(type).GetNestedTypes().SelectMany(TypesWithin).Prepend(type);

    /// <summary>A portable PDB, read with System.Reflection.Metadata.</summary>
    private sealed class PortableSymbols : DebugSymbols
    {
        private readonly MetadataReaderProvider provider;
        private readonly MetadataReader pdb;

        private PortableSymbols(PEReader assembly, MetadataReaderProvider provider, string pdbPath)
            : base(assembly, pdbPath)
        {
            this.provider = provider;
            pdb = provider.GetMetadataReader();
        }

        public override string Description => "portable PDB";

        /// <summary>
        /// The PDB, if its ID is the one a portable CodeView entry of the
        /// Assembly records: the entry's GUID and time stamp.
        /// </summary>
        public static PortableSymbols? Open(PEReader assembly, List<DebugDirectoryEntry> codeView, byte[] pdb, string pdbPath)
        {
            var provider = MetadataReaderProvider.FromPortablePdbImage(ImmutableArray.Create(pdb));
            try
            {
                var header = provider.GetMetadataReader().DebugMetadataHeader
                    ?? throw new BadImageFormatException("The metadata has no #Pdb stream.");
                var id = new BlobContentId(header.Id);
                var recorded = codeView
                    .Where(entry => entry.IsPortableCodeView)
                    .Select(entry => new BlobContentId(assembly.ReadCodeViewDebugDirectoryData(entry).Guid, entry.Stamp));
                if (recorded.Contains(id))
                {
                    return new PortableSymbols(assembly, provider, pdbPath);
                }
            }
            catch
            {
                provider.Dispose();
                throw;
            }

            provider.Dispose();
            return null;
        }

        public override IList<SequencePoint> GetSequencePoints(MethodDefinitionHandle method)
        {
            var information = pdb.GetMethodDebugInformation(method);
            if (information.SequencePointsBlob.IsNil)
            {
                return [];
            }

            return [
                .. information.GetSequencePoints().Select(point => new SequencePoint
                {
                    Offset = point.Offset,
                    StartLine = point.StartLine,
                    StartColumn = point.StartColumn,
                    EndLine = point.EndLine,
                    EndColumn = point.EndColumn,
                    DocumentUrl = point.Document.IsNil ? "" : pdb.GetString(pdb.GetDocument(point.Document).Name),
                }),
            ];
        }

        /// <summary>Every local the PDB names, in every scope, but those it hides from the debugger, which the compiler made.</summary>
        public override IList<Variable> GetVariables(MethodDefinitionHandle method) =>
        [
            .. pdb.GetLocalScopes(method)
                .SelectMany(scope => pdb.GetLocalScope(scope).GetLocalVariables())
                .Select(pdb.GetLocalVariable)
                .Where(variable => (variable.Attributes & LocalVariableAttributes.DebuggerHidden) == 0)
                .Select(variable => new Variable(variable.Index, pdb.GetString(variable.Name))),
        ];

        public override void Dispose()
        {
            provider.Dispose();
            base.Dispose();
        }

        private protected override IEnumerable<string> DocumentsOf(MethodDefinitionHandle method)
        {
            var information = pdb.GetMethodDebugInformation(method);
            if (!information.Document.IsNil)
            {
                return [Name(information.Document)];
            }

            // A method compiled from several documents records each in its sequence points.
            return information.SequencePointsBlob.IsNil
                ? []
                : information.GetSequencePoints().Where(point => !point.Document.IsNil).Select(point => Name(point.Document));
        }

        /// <summary>The C# compiler records the documents of a type that has no code of its own to find them by.</summary>
        private protected override IEnumerable<string> DocumentsOfType(TypeDefinitionHandle type)
        {
            foreach (var handle in pdb.GetCustomDebugInformation(type))
            {
                var information = pdb.GetCustomDebugInformation(handle);
                if (pdb.GetGuid(information.Kind) != KnownGuids.TypeDefinitionDocuments)
                {
                    continue;
                }

                var blob = pdb.GetBlobReader(information.Value);
                while (blob.RemainingBytes > 0)
                {
                    yield return Name(MetadataTokens.DocumentHandle(blob.ReadCompressedInteger()));
                }
            }
        }

        private string Name(DocumentHandle document) => pdb.GetString(pdb.GetDocument(document).Name);
    }

    /// <summary>A Windows PDB, read with Mono.Cecil's managed reader, which needs no Windows to run on.</summary>
    private sealed class WindowsSymbols : DebugSymbols
    {
        private readonly Cecil.ModuleDefinition module;
        private readonly Cecil.Cil.ISymbolReader reader;
        private readonly Dictionary<MethodDefinitionHandle, Cecil.Cil.MethodDebugInformation?> methods = [];

        private WindowsSymbols(PEReader assembly, Cecil.ModuleDefinition module, Cecil.Cil.ISymbolReader reader, string pdbPath)
            : base(assembly, pdbPath)
        {
            this.module = module;
            this.reader = reader;
        }

        public override string Description => "Windows PDB";

        /// <summary>The PDB, if its GUID is the one the Assembly's CodeView entry records.</summary>
        public static WindowsSymbols? Open(PEReader assembly, byte[] image, byte[] pdb, string pdbPath)
        {
            var module = Cecil.ModuleDefinition.ReadModule(new MemoryStream(image), new Cecil.ReaderParameters(Cecil.ReadingMode.Deferred));
            Cecil.Cil.ISymbolReader? reader = null;
            try
            {
                reader = new NativePdbReaderProvider().GetSymbolReader(module, new MemoryStream(pdb));
                if (module.HasDebugHeader && reader.ProcessDebugHeader(module.GetDebugHeader()))
                {
                    return new WindowsSymbols(assembly, module, reader, pdbPath);
                }
            }
            catch
            {
                reader?.Dispose();
                module.Dispose();
                throw;
            }

            reader.Dispose();
            module.Dispose();
            return null;
        }

        public override IList<SequencePoint> GetSequencePoints(MethodDefinitionHandle method) =>
        [
            .. (Read(method)?.SequencePoints ?? []).Select(point => new SequencePoint
            {
                Offset = point.Offset,
                StartLine = point.StartLine,
                StartColumn = point.StartColumn,
                EndLine = point.EndLine,
                EndColumn = point.EndColumn,
                DocumentUrl = point.Document?.Url ?? "",
            }),
        ];

        public override IList<Variable> GetVariables(MethodDefinitionHandle method)
        {
            var variables = new List<Variable>();
            var scopes = new Stack<Cecil.Cil.ScopeDebugInformation>();
            if (Read(method)?.Scope is { } outermost)
            {
                scopes.Push(outermost);
            }

            while (scopes.TryPop(out var scope))
            {
                variables.AddRange(scope.Variables
                    .Where(variable => !variable.IsDebuggerHidden)
                    .Select(variable => new Variable(variable.Index, variable.Name)));
                foreach (var inner in scope.Scopes)
                {
                    scopes.Push(inner);
                }
            }

            return variables.OrderBy(variable => variable.Index).ToList();
        }

        public override void Dispose()
        {
            reader.Dispose();
            module.Dispose();
            base.Dispose();
        }

        private protected override IEnumerable<string> DocumentsOf(MethodDefinitionHandle method) =>
            (Read(method)?.SequencePoints ?? []).Select(point => point.Document?.Url).OfType<string>();

        /// <summary>
        /// Reads a method's debug information, once. Types are decompiled on
        /// several threads at once, and neither Cecil nor the cache may be
        /// read by two at a time.
        /// </summary>
        private Cecil.Cil.MethodDebugInformation? Read(MethodDefinitionHandle method)
        {
            lock (methods)
            {
                if (!methods.TryGetValue(method, out var information))
                {
                    information = module.LookupToken(MetadataTokens.GetToken(method)) is Cecil.MethodDefinition definition
                        ? reader.Read(definition)
                        : null;
                    methods[method] = information;
                }

                return information;
            }
        }
    }
}
