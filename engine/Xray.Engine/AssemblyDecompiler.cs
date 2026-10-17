using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.ExceptionServices;
using System.Runtime.Versioning;
using ICSharpCode.Decompiler;
using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.CSharp.Transforms;
using ICSharpCode.Decompiler.Metadata;
using ICSharpCode.Decompiler.TypeSystem;

namespace Xray.Engine;

/// <summary>
/// A top-level type, decompiled to a compilation unit of its own, with the
/// file-scoped types it uses, which are visible only in their own file.
/// </summary>
/// <param name="Namespace">The type's namespace; <c>""</c> for the global namespace.</param>
/// <param name="Name">The type's metadata name, generic arity included, e.g. <c>List`1</c>.</param>
/// <param name="Code">C# source declaring the type, with its nested types, and the <c>using</c>s it needs.</param>
/// <param name="SourceFile">
/// If the unit declares file-scoped types, the name of the file they were
/// declared in, without its extension, as their names record (<c>Greetings</c>
/// for <c>&lt;Greetings&gt;F1A2B…__Format</c>); otherwise null. A unit of that
/// name makes them the same names again.
/// </param>
/// <param name="SourcePath">
/// The path of the source file the unit's types were declared in, as the
/// Assembly's PDB records it (<c>/src/App/Shapes/Circle.cs</c>, or
/// <c>C:\src\App\Shapes\Circle.cs</c>), when it was decompiled with one that
/// does; otherwise null. Every type the PDB says was declared in that file is
/// declared in this unit.
/// </param>
/// <param name="Declares">
/// Every top-level type the unit declares, in metadata order: this type, and
/// any it shares the unit with.
/// </param>
internal sealed record DecompiledType(
    string Namespace,
    string Name,
    string Code,
    string? SourceFile,
    string? SourcePath,
    IReadOnlyList<DeclaredType> Declares);

/// <summary>A top-level type, by name.</summary>
/// <param name="Namespace"><c>""</c> for the global namespace.</param>
/// <param name="Name">The metadata name, generic arity included.</param>
internal sealed record DeclaredType(string Namespace, string Name);

/// <param name="AssemblyAttributes">
/// C# source declaring the assembly and module attributes a compiler would not
/// generate itself (<c>AssemblyVersion</c>, <c>AssemblyTitle</c>…), for a
/// project that does not generate its own.
/// </param>
/// <param name="Types">Every top-level type a project must declare, in metadata order.</param>
/// <param name="UnsafeCode">
/// Whether the module was compiled with unsafe code allowed, as the
/// <c>[module: UnverifiableCode]</c> the compiler then adds records. The
/// attribute itself is left out of <paramref name="AssemblyAttributes"/>: a
/// project that allows unsafe code gets it from the compiler again.
/// </param>
/// <param name="NullableAnnotations">
/// Whether any of the module's code was compiled in a nullable annotations
/// context, as the <c>NullableAttribute</c> and <c>NullableContextAttribute</c>
/// the compiler applies record. The code's <c>?</c> annotations mean the same
/// only in such a context.
/// </param>
/// <param name="Xaml">
/// The XAML of its WPF resources, decompiled from their BAML (see
/// <see cref="WpfXamlReader"/>); null if it has none. The members the markup
/// compiler generated of each class a document names, which it generates
/// again from that XAML, are left out of <paramref name="Types"/>, and the
/// class is declared <c>partial</c>, as its code-behind is.
/// </param>
internal sealed record DecompiledAssembly(
    string AssemblyAttributes,
    IReadOnlyList<DecompiledType> Types,
    bool UnsafeCode,
    bool NullableAnnotations,
    WpfXaml? Xaml = null);

/// <summary>How far a decompilation has got, reported as it starts on each top-level type.</summary>
/// <param name="Done">
/// How many top-level types are already decompiled. Types are decompiled
/// several at once, so it can stay the same from one report to the next, but
/// never goes down.
/// </param>
/// <param name="Total">How many top-level types there are to decompile.</param>
/// <param name="Current">The full name of the type being started on now, e.g. <c>App.Models.Point`1</c>.</param>
internal sealed record DecompileProgress(int Done, int Total, string Current);

/// <summary>
/// Decompiles a Managed Assembly to C#, one compilation unit per top-level type,
/// on every processor at once, sharing one type system, as ILSpy does when it
/// writes a project. Where those units go, and the project around them, is
/// core's business.
/// </summary>
internal static class AssemblyDecompiler
{
    /// <param name="progress">
    /// Told of each top-level type once, before it is decompiled, from
    /// whichever thread starts on it, but never by two threads at once.
    /// </param>
    /// <param name="pdbPath">
    /// A PDB to decompile with, if it is the Assembly's own (see
    /// <see cref="DebugSymbols"/>): its locals then keep the names they were
    /// given, and the types of each source file it records are decompiled to
    /// one unit, which says where that file was. Any other PDB is ignored.
    /// </param>
    /// <param name="referenceDirectories">
    /// Folders to find the assemblies it references in, after those the
    /// decompiler looks in itself (the Assembly's own folder, and the
    /// framework's where this machine has it), such as a targeting pack's
    /// reference assemblies. Code using a type it cannot find is decompiled
    /// less precisely: a call to a base class's method may lose its
    /// <c>base.</c>, and calls itself instead.
    /// </param>
    public static DecompiledAssembly Decompile(
        string path,
        LanguageVersion languageVersion,
        Action<DecompileProgress>? progress = null,
        string? pdbPath = null,
        IReadOnlyList<string>? referenceDirectories = null)
    {
        // Classified first, so anything without a CLI header is refused with the
        // same error as "inspect", rather than whatever the decompiler throws.
        if (PeClassifier.Classify(path).Kind != InputKind.ManagedAssembly)
        {
            throw new InspectionException(
                Protocol.ErrorCodes.NotAManagedAssembly,
                $"{path} is not a Managed Assembly.");
        }

        var settings = new DecompilerSettings(languageVersion)
        {
            // A reference that cannot be found (Dependency Resolution's concern)
            // makes some code less precise, but must not stop the rest.
            ThrowOnAssemblyResolveErrors = false,
            // default(T), never the bare literal: the literal takes its type
            // from where it stands, and the decompiler does not always place it
            // where that is T. In an interpolation hole it is an object, so
            // `$"{default(Cell)}"` would print nothing.
            DefaultLiterals = false,
        };

        DecompilerTypeSystem typeSystem;
        WpfXaml? xaml;
        try
        {
            // As CSharpDecompiler(path, settings) opens it, with the folders given.
            var file = new PEFile(path, new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete), PEStreamOptions.PrefetchEntireImage);
            var resolver = new UniversalAssemblyResolver(path, settings.ThrowOnAssemblyResolveErrors, file.DetectTargetFrameworkId(), file.DetectRuntimePack());
            foreach (var directory in referenceDirectories ?? [])
            {
                resolver.AddSearchDirectory(directory);
            }

            // One type system for every decompiler, as ILSpy's WholeProjectDecompiler
            // shares one between the threads it decompiles a project's files on.
            typeSystem = new DecompilerTypeSystem(file, resolver, settings);
            xaml = WpfXamlReader.Read(file, resolver);
        }
        catch (BadImageFormatException exception)
        {
            throw new InspectionException(
                Protocol.ErrorCodes.InvalidMetadata,
                $"{path} has a CLI header but its metadata could not be read: {exception.Message}");
        }

        // Read when each type is decompiled, so it may be set once the metadata is open.
        settings.Ranges = HasSystemIndex(AssemblyInspector.TargetFrameworkOf(typeSystem.MainModule.MetadataFile.Metadata));

        using var symbols = pdbPath is null ? null : DebugSymbols.Open(path, pdbPath, out _);

        // The markup compiler generates these members again from the XAML.
        var generated = xaml?.Generated ?? new Dictionary<TypeDefinitionHandle, IReadOnlySet<EntityHandle>>();

        // A decompiler is used by one thread at a time, so each thread decompiling has its own.
        CSharpDecompiler NewDecompiler()
        {
            var decompiler = new CSharpDecompiler(typeSystem, settings);
            if (symbols is not null)
            {
                // The decompiler names each local as the PDB does (DecompilerSettings.UseDebugSymbols).
                decompiler.DebugInfoProvider = symbols;
            }

            foreach (var (type, members) in generated)
            {
                var codeBehind = new PartialTypeInfo(type);
                foreach (var member in members)
                {
                    codeBehind.AddDeclaredMember(member);
                }

                decompiler.AddPartialTypeDefinition(codeBehind);
            }

            // As ILSpy does when it writes a project: names a compiler would reject
            // are escaped, and the attributes a compiler adds itself are left out.
            decompiler.AstTransforms.Add(new EscapeInvalidIdentifiers());
            decompiler.AstTransforms.Add(new RemoveCompilerGeneratedAssemblyAttributes());
            // Fixes code the decompiler writes that C# would refuse.
            decompiler.AstTransforms.Add(new UpcastImpossibleTypeTests());
            decompiler.AstTransforms.Add(new ImplicitlyTypeAnonymousDelegates());
            decompiler.AstTransforms.Add(new WriteClonesAsWith());
            decompiler.AstTransforms.Add(new DeclareRecordsOwnHashCodes());
            // After the decompiler's own CombineQueryExpressions, which writes the continuations.
            decompiler.AstTransforms.Add(new ParenthesizeQueriesBeforeContinuations());
            // Before the decompiler's own transforms that each must precede.
            InsertBefore<TransformFieldAndConstructorInitializers>(decompiler, new MergeThrowsIntoInitializers());
            InsertBefore<IntroduceUsingDeclarations>(decompiler, new InlineThrowHelpers());
            InsertBefore<IntroduceUsingDeclarations>(decompiler, new LeaveConnectorsToMarkupCompiler(generated.Keys));
            InsertBefore<IntroduceUsingDeclarations>(decompiler, new LeaveRegexesToGenerator());
            InsertBefore<EscapeInvalidIdentifiers>(decompiler, new DeclareFileScopedTypes());
            return decompiler;
        }

        var module = typeSystem.MainModule.MetadataFile;
        var metadata = module.Metadata;
        // Chosen first, so progress can say how many there are.
        // An anonymous delegate C# cannot declare is left to the compiler to make
        // again, for each local declared with var (ImplicitlyTypeAnonymousDelegates),
        // and the regex source generator's types to the generator (LeaveRegexesToGenerator).
        var handles = metadata.TypeDefinitions
            .Where(handle => IsDeclaredInSource(module, handle, settings))
            .Where(handle => !ImplicitlyTypeAnonymousDelegates.IsUndeclarable(typeSystem.MainModule.GetDefinition(handle)))
            .Where(handle => !LeaveRegexesToGenerator.IsWrittenByGenerator(typeSystem.MainModule.GetDefinition(handle)))
            .ToList();
        var definitions = handles.Select(handle => typeSystem.MainModule.GetDefinition(handle)).ToList();
        var fileScoped = definitions.Select(DeclareFileScopedTypes.FileOf).ToList();
        // The methods the regex source generator wrote, in a file of its own
        // (RegexGenerator.g.cs), say nothing of where their types were declared.
        var regexes = typeSystem.MainModule.TypeDefinitions
            .SelectMany(type => type.Methods)
            .Where(LeaveRegexesToGenerator.IsWrittenByGenerator)
            .Select(method => (EntityHandle)method.MetadataToken)
            .ToHashSet();
        var documents = handles
            .Select(handle => symbols?.DocumentOf(handle, generated.TryGetValue(handle, out var members) ? [.. members, .. regexes] : regexes))
            .ToList();
        // Types share a unit when they must be declared in one file: those the
        // PDB says were declared in the same source file, as they were written,
        // and a file-scoped type, which is visible only in its own file, with
        // the types that use it, which were declared there too, and the other
        // file-scoped types of its file. Progress counts types, which can be
        // more than the units.
        var units = new UnitSets(handles.Count);
        units.Join(documents);
        var firstOfFile = units.Join(fileScoped);
        var trees = new SyntaxTree?[handles.Count];

        // Told of each type once, as a thread starts on it, or on the unit it
        // is declared in: one at a time, and of how many types are done, which
        // only grows, and counts only types it was told of before.
        var done = 0;
        var reporting = new object();
        void Starting(IEnumerable<int> indexes)
        {
            lock (reporting)
            {
                foreach (var index in indexes)
                {
                    progress?.Invoke(new DecompileProgress(done, handles.Count, definitions[index].ReflectionName));
                }
            }
        }

        void Finished(int count)
        {
            lock (reporting)
            {
                done += count;
            }
        }

        if (firstOfFile.Count > 0)
        {
            // Which file-scoped types a type uses shows only once it is
            // decompiled, so the units are known only after every type is.
            var ordinary = Enumerable.Range(0, handles.Count).Where(index => fileScoped[index] is null).ToList();
            InParallel(ordinary, NewDecompiler, (decompiler, index) =>
            {
                Starting([index]);
                trees[index] = Decompiled(definitions[index].ReflectionName, () => decompiler.DecompileTypes([handles[index]]));
                Finished(1);
            });
            foreach (var index in ordinary)
            {
                foreach (var file in DeclareFileScopedTypes.FilesUsedBy(trees[index]!))
                {
                    if (firstOfFile.TryGetValue(file, out var first))
                    {
                        units.Union(index, first);
                    }
                }
            }
        }

        // Every unit is known now: each is decompiled, in the place of its first type.
        var sets = units.Sets();
        var decompiled = new (int Row, DecompiledType Type)[sets.Count];
        InParallel(Enumerable.Range(0, sets.Count).ToList(), NewDecompiler, (decompiler, unit) =>
        {
            var members = sets[unit];
            // Named as, and in the place of, its first ordinary type, if it has one.
            var first = members[Math.Max(members.FindIndex(member => fileScoped[member] is null), 0)];
            var alone = members.Count == 1 ? trees[first] : null;
            // Those decompiled alone to find the file-scoped types they use were told of then.
            var untold = members.Where(member => trees[member] is null).ToList();
            Starting(untold);

            var tree = alone ?? Decompiled(definitions[first].ReflectionName, () => decompiler.DecompileTypes(members.Select(member => handles[member])));
            var (ns, name) = Named(metadata, handles[first]);
            decompiled[unit] = (
                MetadataTokens.GetRowNumber(handles[first]),
                new DecompiledType(
                    ns,
                    name,
                    Write(tree, settings),
                    SourceFile: members.Select(member => fileScoped[member]).FirstOrDefault(file => file is not null)?.Name,
                    SourcePath: documents[first] ?? members.Select(member => documents[member]).FirstOrDefault(document => document is not null),
                    Declares: [.. members.Select(member => Named(metadata, handles[member]))]));
            Finished(untold.Count);
        });

        var types = decompiled.OrderBy(unit => unit.Row).Select(unit => unit.Type).ToList();

        var attributes = Decompiled("the assembly attributes", NewDecompiler().DecompileModuleAndAssemblyAttributes);
        return new DecompiledAssembly(
            Write(attributes, settings),
            types,
            UnsafeCode: metadata.GetModuleDefinition().GetCustomAttributes().Any(attribute =>
                AssemblyInspector.IsAttribute(metadata, metadata.GetCustomAttribute(attribute), "System.Security", "UnverifiableCodeAttribute")),
            NullableAnnotations: metadata.CustomAttributes.Any(attribute =>
                AssemblyInspector.IsAttribute(metadata, metadata.GetCustomAttribute(attribute), "System.Runtime.CompilerServices", "NullableAttribute")
                || AssemblyInspector.IsAttribute(metadata, metadata.GetCustomAttribute(attribute), "System.Runtime.CompilerServices", "NullableContextAttribute")),
            xaml);
    }

    /// <summary>
    /// Whether the framework an Assembly targets, as its
    /// <c>TargetFrameworkAttribute</c> names it, has <c>System.Index</c>, which
    /// C#'s index from the end (<c>values[^1]</c>) needs: .NET Core 3.0 and
    /// later, and .NET Standard 2.1. .NET Framework, which an Assembly without
    /// the attribute is, has not; nor has .NET Standard 2.0. Where the
    /// decompiler cannot find the framework's own assemblies, as for .NET
    /// Framework on any OS, it supposes one with every type, and would write
    /// <c>values[^1]</c> for <c>values[values.Length - 1]</c> all the same.
    /// </summary>
    internal static bool HasSystemIndex(string? targetFramework)
    {
        if (targetFramework is null)
        {
            return false;
        }

        FrameworkName framework;
        try
        {
            framework = new FrameworkName(targetFramework);
        }
        catch (ArgumentException)
        {
            return false;
        }

        return framework.Identifier.ToUpperInvariant() switch
        {
            ".NETCOREAPP" => framework.Version >= new Version(3, 0),
            ".NETSTANDARD" => framework.Version >= new Version(2, 1),
            _ => false,
        };
    }

    /// <summary>
    /// Whether a type is a top-level one that a project declares, rather than
    /// one the compiler adds: not <c>&lt;Module&gt;</c>, nothing ILSpy hides (such
    /// as <c>&lt;PrivateImplementationDetails&gt;</c>), and no attribute the
    /// compiler embeds for its own use (<c>NullableAttribute</c>,
    /// <c>IsReadOnlyAttribute</c>…), each of which it marks
    /// <c>[Microsoft.CodeAnalysis.Embedded]</c>. Other compiler-generated types,
    /// such as <c>&lt;&gt;z__ReadOnlyArray&lt;T&gt;</c>, stay: the decompiled
    /// code can still use them.
    /// </summary>
    private static bool IsDeclaredInSource(MetadataFile module, TypeDefinitionHandle handle, DecompilerSettings settings)
    {
        var metadata = module.Metadata;
        var definition = metadata.GetTypeDefinition(handle);
        if (!definition.GetDeclaringType().IsNil
            || metadata.StringComparer.Equals(definition.Name, "<Module>")
            || CSharpDecompiler.MemberIsHidden(module, handle, settings))
        {
            return false;
        }

        // The marker itself is embedded too, but does not mark itself.
        if (metadata.StringComparer.Equals(definition.Namespace, "Microsoft.CodeAnalysis")
            && metadata.StringComparer.Equals(definition.Name, "EmbeddedAttribute"))
        {
            return false;
        }

        return !definition.GetCustomAttributes().Any(attribute =>
            AssemblyInspector.IsAttribute(metadata, metadata.GetCustomAttribute(attribute), "Microsoft.CodeAnalysis", "EmbeddedAttribute"));
    }

    /// <summary>Runs one decompilation, reporting a failure as the protocol error <c>decompilation-failed</c>.</summary>
    private static SyntaxTree Decompiled(string what, Func<SyntaxTree> decompile)
    {
        try
        {
            return decompile();
        }
        catch (Exception exception) when (exception is not (OutOfMemoryException or InspectionException))
        {
            throw new InspectionException(
                Protocol.ErrorCodes.DecompilationFailed,
                $"Could not decompile {what}: {exception.Message}");
        }
    }

    /// <summary>
    /// Runs <paramref name="run"/> on each of <paramref name="items"/>, on as
    /// many threads as there are processors, each with a decompiler of its own
    /// from <paramref name="create"/>. Should any fail, those after it not yet
    /// started are not, and the first to fail in the order given is rethrown,
    /// as decompiling them one by one would.
    /// </summary>
    private static void InParallel(IReadOnlyList<int> items, Func<CSharpDecompiler> create, Action<CSharpDecompiler, int> run)
    {
        var failures = new Exception?[items.Count];
        Parallel.For(
            0,
            items.Count,
            // No more threads than processors, as ILSpy's own default, though the
            // thread pool would add more as each runs long, to take turns on them.
            new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount },
            create,
            (position, loop, decompiler) =>
            {
                try
                {
                    run(decompiler, items[position]);
                }
                catch (Exception exception)
                {
                    failures[position] = exception;
                    // Every item before this one still runs, so the first failure is known.
                    loop.Break();
                }

                return decompiler;
            },
            _ => { });
        if (failures.FirstOrDefault(failure => failure is not null) is { } first)
        {
            ExceptionDispatchInfo.Throw(first);
        }
    }

    private static DeclaredType Named(MetadataReader metadata, TypeDefinitionHandle handle)
    {
        var definition = metadata.GetTypeDefinition(handle);
        return new DeclaredType(metadata.GetString(definition.Namespace), metadata.GetString(definition.Name));
    }

    /// <summary>
    /// Which top-level types, by their place in the list decompiled, share a
    /// unit: sets that are joined, each known by its first member.
    /// </summary>
    private sealed class UnitSets(int count)
    {
        private readonly int[] parents = Enumerable.Range(0, count).ToArray();

        /// <summary>Joins every type that has a key with the first that has the same, and returns those firsts.</summary>
        public Dictionary<TKey, int> Join<TKey>(IReadOnlyList<TKey?> keys)
            where TKey : class
        {
            var firsts = new Dictionary<TKey, int>();
            for (var index = 0; index < keys.Count; index++)
            {
                if (keys[index] is { } key && !firsts.TryAdd(key, index))
                {
                    Union(firsts[key], index);
                }
            }

            return firsts;
        }

        public void Union(int one, int other)
        {
            var (a, b) = (Find(one), Find(other));
            if (a != b)
            {
                parents[Math.Max(a, b)] = Math.Min(a, b);
            }
        }

        /// <summary>Every set, each by its members in order, in the order of their first.</summary>
        public List<List<int>> Sets()
        {
            var sets = new Dictionary<int, List<int>>();
            for (var index = 0; index < parents.Length; index++)
            {
                var set = Find(index);
                if (!sets.TryGetValue(set, out var members))
                {
                    sets[set] = members = [];
                }

                members.Add(index);
            }

            return [.. sets.OrderBy(set => set.Key).Select(set => set.Value)];
        }

        private int Find(int index)
        {
            while (parents[index] != index)
            {
                index = parents[index] = parents[parents[index]];
            }

            return index;
        }
    }

    /// <summary>Adds a transform just before the decompiler's own transform of type <typeparamref name="T"/>.</summary>
    private static void InsertBefore<T>(CSharpDecompiler decompiler, IAstTransform transform)
        where T : IAstTransform
    {
        var transforms = decompiler.AstTransforms;
        for (var index = 0; index < transforms.Count; index++)
        {
            if (transforms[index] is T)
            {
                transforms.Insert(index, transform);
                return;
            }
        }

        throw new InvalidOperationException($"The decompiler has no {typeof(T).Name} to run {transform.GetType().Name} before.");
    }

    /// <summary>Lines end in "\n" on every OS, so the same Assembly always yields the same source.</summary>
    private static string Write(SyntaxTree tree, DecompilerSettings settings)
    {
        using var writer = new StringWriter { NewLine = "\n" };
        tree.AcceptVisitor(new DeclareFileScopedTypes.OutputVisitor(writer, settings.CSharpFormattingOptions));
        return writer.ToString();
    }
}
