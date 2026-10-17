# Fixtures

A **Fixture** is a C# project used as the source of a Round-trip: it is compiled
to an Assembly, Xray reconstructs that Assembly, and the Recovered Solution is
rebuilt and compared with the original (PRD §10). Each Fixture exercises one rung
of the ladder: arithmetic → control flow → classes/structs → generics →
closures/LINQ → async/await → records/pattern matching → … → WPF.

| Fixture                 | Kind                                                                | Exercises                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arithmetic`            | .NET 8 console (Exe)                                                | `int`, `long`, `double` and `decimal` operators; checked and unchecked overflow; conversions; `Math` rounding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `async-await`           | .NET 8 console (Exe)                                                | Async methods returning `Task`, `Task<T>` and `ValueTask<T>`, an `async Task<int> Main`, async lambdas and local functions over captured variables, a generic async method, and awaiting an awaitable of its own; exceptions stored in a task until it is awaited, `await` in `catch` and `finally`, an exception filter, `Task.WhenAll` holding two exceptions; cancellation, by a token checked in a loop and of an endless delay; `ConfigureAwait(true)` and `ConfigureAwait(false)`; async streams (`async IAsyncEnumerable<T>`, `await foreach`, `[EnumeratorCancellation]` with `WithCancellation`, `ConfigureAwait(false)` on a stream, breaking off early) and `await using`. Its continuations run on a single-threaded `SynchronizationContext` of its own, so their order is the same every run, and it prints whether each resumed on that context, so a Recovered Solution that dropped a `ConfigureAwait` behaves differently. The compiler turns each async method and iterator into a state machine, which a Reconstruction must turn back into `async`/`await`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `benchmark`             | .NET 8 console (Exe)                                                | Performance (PRD §8): an Assembly of about 2,000 top-level types and 5 MB, its source generated as it is built, whose Reconstruction is timed; eight kinds of type, from a class with LINQ, a `switch` and `try`/`catch`/`finally` to a record, a generic class, `async`/`await`, an event and an iterator, every one computed from the program's argument                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `classes-structs`       | .NET 8 console (Exe)                                                | Classes, structs and interfaces: an abstract base, `virtual`, `override`, `sealed override`, `new` hiding, a default interface method, an interface re-implemented by a derived class and one implemented explicitly; constructor chaining, static constructors, and field initializers that run before the base constructor calls a virtual method; a mutable struct with a parameterless constructor, copied, boxed and passed by `ref`; operators, conversions, properties, indexers, events with and without accessors of their own, and a nested class                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `closures-linq`         | .NET 8 console (Exe)                                                | Lambdas and local functions, and the variables they capture: shared between two lambdas, changed after capture, one variable for a whole `for` loop against one per `foreach` iteration, closure scopes nested in one another, `this`; static lambdas and local functions, a lambda with a default parameter (C# 12), method groups, multicast delegates; LINQ in query syntax (`let`, `orderby`, `group … into`, `join`, `join … into` and a left outer join, a second `from`, anonymous types) and method syntax, and when a query runs; `Select`s nested in one another before a `Where`, as BundlerMinifier's `Minimatcher` parses globs, which the decompiler writes as a query continuation following a query; iterators, with `yield break`, `finally` blocks run when their consumer stops early, argument checks made when enumerated rather than when called, endless and recursive iterators; expression trees, printed and compiled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `control-flow`          | .NET 8 console (Exe)                                                | Loops (`for`, `while`, `do`, `foreach`, `break`, `continue`, a `goto` out of nested loops); `switch` lowered as a jump table, as comparisons, as a string hash and on an enum, with `goto case` and `goto default`; `try`/`catch`/`finally`, exception filters (which run before the `finally` blocks they unwind), rethrow, wrapping, `using` and a `return` from `try`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `copied-binary`         | .NET 8 console (Exe) and a third party's class library              | Copied binaries (FR-10.4): a program using `Kestrelwood.Checksums`, a netstandard2.0 library no NuGet package holds, strong-named with its vendor's key (`Kestrelwood/Kestrelwood.snk`) rather than the program's (which has none), and built beside it. Across the two, an abstract class the program derives a checksum of its own from, an interface, an enum, a factory, a constant, an extension method, and an exception the library throws and the program catches. Not the application's own, the library is not reconstructed: its binary is copied into the Recovered Solution's `Dependencies/` and referenced with a `HintPath`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `cyclic-reference`      | .NET 8 console (Exe) and a class library                            | Negative: a program and its `Plugin` library reference one another, as no two projects can: `Plugin` is built against `HostContract`, a stand-in with the program's assembly name. The cycle is reported, `Plugin`'s reference back to the program is left out, and the Reconstruction is Partial, with `Plugin`'s errors at their file and line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `debug-symbols`         | .NET 8 console (Exe)                                                | PDB use (FR-4): source files laid out unlike the namespaces they declare (`Accounts/` holds `Ledger.Banking`), a file of three types, a file named after none of its types declaring two namespaces and a file-scoped type, an interface alone in its file, which has no code of its own for a PDB to place it by but the type documents a portable PDB records, and a partial class split across `Statement.cs` and `Statement.Totals.cs`; locals worth naming. It is built with `DebugType` `full`, so the PDB beside it is a Windows PDB on Windows and a portable one elsewhere. Reconstructed with it, its files are laid out as its source is (the partial class once, in `Statement.cs`, where most of its methods are) and its locals keep their names; with another build's PDB beside it, that PDB is ignored with a warning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `generated-regex`       | .NET 8 console (Exe)                                                | Source generators (FR-7): `Lexicon`, whose regular expressions are `[GeneratedRegex]` methods, each declared `partial` for the regex source generator to implement as it is built, which writes its body, and a `Regex` of its own, file-scoped, in `RegexGenerator.g.cs`: static and instance methods, public and private, in a static class, a sealed class with a primary constructor, a `readonly record struct`, and a class nested in a generic one; with options (`IgnoreCase`, `RightToLeft`, `CultureInvariant`), a timeout, and a culture (`tr-TR`, whose case-insensitive `i` matches a dotted `I` and not `I`); and one the generator writes no matching code for, `NonBacktracking`, but constructs at runtime. A file holding nothing but such methods, named unlike the class it declares, so only its PDB says where that class was declared. It reads back by reflection how each method was declared and what the generator made of it, so a Recovered Solution that implemented one itself, or constructed it at runtime, describes itself differently                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `generics`              | .NET 8 console (Exe)                                                | Generic classes, structs, interfaces and delegates, nested generic types, and generic methods whose type arguments are inferred; `class`, `struct`, `new()`, `unmanaged`, base-type, interface, naked and self-referencing constraints, and an override that inherits its constraint; static abstract interface members and generic math; covariance and contravariance, against invariance and array covariance, including type tests C# accepts only on an upcast to `object`; per-instantiation static fields and `default(T)`. It reads its variance and constraints back by reflection, so a Recovered Solution that dropped one describes itself differently                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `native`                | Native Executable                                                   | Negative: a prebuilt Windows x64 C program Xray must classify as a Native Executable and reject (ADR 0002)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `microsoft-packages`    | .NET 8 console (Exe)                                                | Microsoft's NuGet packages (FR-10.1, FR-10.2): System.CommandLine 2.0.5 and NuGet.Versioning 7.3.0, which .NET 8 does not provide, signed with the key (`31bf3856ad364e35`) Microsoft signs some of .NET's own assemblies with, and System.Collections.Immutable 9.0.0, whose assembly, `9.0.0.0`, is newer than the `8.0.0.0` .NET 8 provides, signed with `System.Runtime`'s own key (`b03f5f7f11d50a3a`), each copied beside it by `dotnet build`; a root command and three subcommands, with arguments of one and of many values and an option with an alias, each handled by a lambda, and System.CommandLine's own parse errors and help; `NuGetVersion` and `VersionRange` parsed, compared, normalized and matched; an `ImmutableArray` builder, an `ImmutableSortedSet` with a comparer, an `ImmutableSortedDictionary` of `ImmutableList`s and an `ImmutableHashSet`. A Reconstruction must tell them from the framework's, by what the reference assemblies of .NET 8 hold, and reference all three as packages, neither leave them to the framework nor reconstruct them as Sibling Assemblies                                                                                                                                                                                                                                                                                                                                                                                                     |
| `missing-reference`     | .NET 8 console (Exe)                                                | Negative: its class library, `Greetings`, is left out of its build output, so nothing satisfies its reference to it, an Unresolved Dependency (FR-10.5), and the Reconstruction is Partial, naming it, with the build's error at its file and line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `multi-assembly`        | .NET 8 console (Exe) and two class libraries                        | Sibling Assemblies (FR-10.3, FR-11): a program and two class libraries it references, `Inventory` and `Pricing`, which references `Inventory` too, built beside it; across the Assemblies, a record, a record struct and its `==`, an enum, an interface, an abstract class whose protected members the program overrides, an extension method, an event, a custom exception caught by the program, a generic class closed over another Assembly's type, a constant and a default parameter value from another Assembly, and an internal class `Inventory` lets `Pricing` see (`InternalsVisibleTo`); `Pricing` has a root namespace (`Shop.Pricing`) unlike its name. Each library becomes a project of its own, wired with `ProjectReference`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `net35-library`         | .NET 8 console (Exe) and a .NET Framework 3.5 class library, C# 7.3 | Best-effort target frameworks (FR-8): `Gradebook`, a `net35` library whose Assembly, like everything built before .NET Framework 4.0, records no `TargetFrameworkAttribute`, so its CLR (`v2.0.50727`) and its reference to `System.Core` 3.5.0.0 say what it was built for. In it, LINQ query expressions with `let`, `group … into`, `orderby` and anonymous types; extension methods; iterators, one that validates its argument only once it is enumerated and one that stops with `yield break`; a closure over a parameter; nullable value types; a `[Flags]` enum, printed by name; a struct with operators, `IComparable<T>` and `IEquatable<T>`; an interface with two schemes; an event raised with `EventHandler<T>`; `params`, `out`, and auto-properties with private setters. The program, built beside it, prints the library's CLR and `System.Core` version, so a Recovered Solution that built `Gradebook` for another framework behaves differently                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `net48-console`         | .NET Framework 4.8 console (Exe), C# 7.3                            | An SDK-style `net48` project, which builds on every OS and runs only on Windows; it prints its `TargetFrameworkAttribute`, and formats doubles as only .NET Framework does (`0.1 + 0.2 = 0.3`), so a Recovered Solution for another framework behaves differently                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `net48-winforms`        | .NET Framework 4.8 Windows Forms app (WinExe), C# 7.3               | Windows Forms (FR-12, FR-14) for .NET Framework, written as Visual Studio's designer writes it in C# 7.3: `Stopwatch`, whose `LapForm.Designer.cs` builds the form in `InitializeComponent` (`this.`-qualified, fully qualified types, `new System.EventHandler(…)`), a `Timer` and a `ToolTip` in its components container, and whose `LapForm.resx` holds its icon and a `PictureBox`'s image, a `System.Drawing.Icon` and a `System.Drawing.Bitmap`. `dotnet build` builds that `.resx` only for `System.Resources.Extensions` to read (`GenerateResourceUsePreserializedResources`), so it references its package, which is copied beside it with a binding redirect in `Stopwatch.exe.config`. A GUI Fixture (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `net48-wpf`             | .NET Framework 4.8 WPF app (WinExe), C# 7.3                         | WPF (FR-12, FR-14) for .NET Framework, written as Visual Studio writes it in C# 7.3: `Swatches`, a colour mixer, whose XAML the markup compiler compiles to BAML in `Swatches.g.resources`. Its windows bind to a view model rather than handle events: `MainWindow.xaml` makes a `MixerViewModel` (`INotifyPropertyChanged`) its `DataContext`, binds sliders to it both ways, a `TextBox` as each key is typed (`UpdateSourceTrigger=PropertyChanged`), a `Button` to its `ICommand`, a `ListBox` to its `ObservableCollection` through a `DataTemplate` with a `DataType`, a preview's brush through `ColorToBrushConverter`, which `App.xaml` declares from the app's own namespace, and text by `ElementName`, `StringFormat` and its title by a `StringFormat` with a space; and on `Loaded` shows `PreviewWindow.xaml`, a second window it owns, with the same `DataContext`. `Controls/SwatchChip.xaml` is a `UserControl` binding to its own dependency property by `RelativeSource`. `Themes/Styles.xaml`, merged by `App.xaml`, holds brushes, a `Thickness`, an implicit `Style`, keyed ones, one `BasedOn` another with a `DataTrigger`, and one whose `ControlTemplate` uses `TemplateBinding` and `Trigger`s on a named part. `Assets/swatches.png`, the windows' icon, named by a pack URI, is a `Resource`; `Properties/AssemblyInfo.cs` holds the template's `ThemeInfo`. It builds on every OS against the framework's reference assemblies, as `net48-console` does. A GUI Fixture (below) |
| `netcoreapp31-console`  | .NET Core 3.1 console (Exe), C# 8                                   | An out-of-support `netcoreapp3.1` project, run on a later .NET where 3.1 is not installed; it prints its `TargetFrameworkAttribute`, and formats doubles as .NET Core 3.0 and later do (`0.1 + 0.2 = 0.30000000000000004`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `netstandard20-library` | .NET 8 console (Exe) and a .NET Standard 2.0 class library, C# 7.3  | Best-effort target frameworks (FR-8): `Measures`, a `netstandard2.0` library of quantities and units. In it, tuples with named elements, returned, deconstructed and of an `IEnumerable<(…)>`; `switch` on type patterns with `when`, `case null`, and a `case int at when` on a value; a local function; `out var`; a `readonly struct` with a deconstructor and an `in` parameter, whose attributes the compiler declares in the Assembly itself, as netstandard2.0 has none; a throw expression; an `async Task<T>` method that yields; an iterator that validates its argument only once it is enumerated; and an exception deriving from `InvalidOperationException`. The program, built beside it, prints the library's `TargetFrameworkAttribute`, so a Recovered Solution that built `Measures` for another framework behaves differently                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `newer-features`        | .NET 8 console (Exe), C# 12                                         | Primary constructors on classes and a struct: a parameter that is captured, kept in a field of the compiler's and changed, one that only initializes a property, one checked by a throw expression in a field initializer, one with a default, another constructor that calls the primary one, and a derived class passing its parameters to its base's; collection expressions as an array, an empty array, a `List`, a `HashSet`, an `ImmutableArray`, a read-only `IEnumerable<T>` and `IReadOnlyList<T>`, a mutable `IList<T>`, a span on the stack and one of constants, a collection with a `[CollectionBuilder]` of its own, and spreads, evaluated in order; file-scoped types (`file class`, `file interface`), two of the same name in two files. It reads back by reflection the fields a primary constructor keeps its parameters in and which types are file-scoped, and in which file, so a Recovered Solution that rewrote either describes itself differently                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `nuget-dependencies`    | .NET 8 console (Exe)                                                | NuGet packages (FR-10.2): Newtonsoft.Json 13.0.3, whose assembly, `13.0.0.0`, every 13.0.x release shares, and Serilog 3.1.1, whose assembly is versioned `2.0.0.0`, as its 2.x releases' are, both strong-named and copied beside it by `dotnet build`; a class opting its members into JSON with attributes (`JsonObject`, `JsonProperty` with `Required` and `DefaultValueHandling`), `JsonConvert` both ways, `JObject` and a JSONPath query, and an exception it throws, caught; a Serilog logger configured fluently, enriched, with a context of its own and a sink of the Fixture's own, an `ILogEventSink` writing through a `MessageTemplateTextFormatter`, destructuring an object (`{@Order}`). A Reconstruction must reference both as packages, not reconstruct them as Sibling Assemblies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `obfuscated`            | .NET 8 console (Exe)                                                | Negative: obfuscation (FR-3). A recipe scaler (a few namespaces and files, an interface, an enum, an iterator, an exception it throws and catches, and strings throughout) that Obfuscar renames and whose strings it hides as it is built (see below). It runs as its source says, and is flagged as obfuscated, by the names Obfuscar gave it and the strings it hid, and reconstructed as it is: nothing is renamed back, and no string decoded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `records-patterns`      | .NET 8 console (Exe)                                                | Records and record structs, positional and `readonly`, in a hierarchy (abstract, derived and sealed records, equal only to their own type), with `with` expressions (an empty one too, and one made through the base type), deconstruction, value equality (arrays compared by reference), a property that replaces its positional parameter, and an `Equals`, `GetHashCode` and `PrintMembers` of their own; `init` accessors, one that checks its value; patterns: type, property, extended property (`{ Customer.Address.City: … }`), positional, tuple, relational, `and`/`or`/`not`, `NaN`, and list patterns with slices on an array, a `List`, a string and a span; switch expressions with guards, a switch statement with patterns, and a switch expression that matches nothing and throws `SwitchExpressionException`. It reads back by reflection the members each record declares and which setters are init-only, so a Recovered Solution that turned a record into a class, or an `init` into a `set`, describes itself differently                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `resources`             | .NET 8 console (Exe)                                                | Embedded resources (FR-12): `Phrasebook`, whose `.resx` files of strings (`Strings.resx`, and `Phrases/Menu.resx`, which a resource manager finds by its type's full name) have French and German satellite assemblies (`fr/Phrasebook.resources.dll`, `de/…`), each with only some of the strings, so others fall back to the neutral ones, of an `fr-CA` lookup too; strings with a format, spaces at either end, markup, `\r\n` and a tab, non-ASCII characters and none at all; a `.resx` holding an image as a `byte[]` and a stream, each a `ResXFileRef`; files embedded as they are: an image, one under a logical name of its own (`motd`), one private, and one for French only; and `Limits.resources`, a `.resources` file holding an `int` and a `bool`, which no `.resx` built by the .NET SDK can hold without `System.Resources.Extensions` (see below). It prints every manifest resource of its Assembly and each satellite assembly, with its size, and reads each back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `unsafe-nullable`       | .NET 8 console (Exe)                                                | Project properties (FR-9): unsafe code (pointers, a fixed-size buffer, `stackalloc`, a function pointer) and nullable annotations; an assembly name (`Xray.UnsafeNullable`) and root namespace (`Fixtures.Pointers`) unlike its project's name; version and assembly attributes set in the project. It prints its full name and every assembly and module attribute, and reads back the nullability of its members, so a Recovered Solution that lost any of them behaves differently                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `winforms`              | .NET 8 Windows Forms app (WinExe)                                   | Windows Forms (FR-12, FR-14) for .NET 8, laid out as Visual Studio's template and designer lay it out: `Greeter`, whose `MainForm.Designer.cs` builds the form in `InitializeComponent`, a `ToolTip` in its components container and the event handlers it calls, and whose `MainForm.resx` holds its icon and a `PictureBox`'s image, a `System.Drawing.Icon` and a `System.Drawing.Bitmap`; its `Program.Main` calls `ApplicationConfiguration.Initialize()`, which the Windows Forms source generator writes as it is built. `net8.0-windows`, recorded as Windows 7.0, built on every OS (`EnableWindowsTargeting`). A GUI Fixture (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `wpf`                   | .NET 8 WPF app (WinExe)                                             | WPF (FR-12, FR-14) for .NET 8, laid out as Visual Studio's template lays it out: `Tally`, a counter, whose XAML the markup compiler compiles to BAML in `Tally.g.resources` and completes with code of its own (each named element's field, `InitializeComponent`, the `Connect` methods hooking events, and `Main`). `App.xaml`, its `ApplicationDefinition`, sets `StartupUri` and a `Startup` handler, which the markup compiler writes into `App`'s `InitializeComponent` rather than its BAML, and merges `Themes/Palette.xaml`, a `ResourceDictionary` of a colour, a brush, sizes (a `sys:Double` among them) and a keyed `Style`, beside an implicit `Style` of its own; `MainWindow.xaml` has named elements and their events, its own `Loaded`, and a `Style` `BasedOn` the implicit one with an `EventSetter`, and uses `Controls/CountBadge.xaml`, a `UserControl` in `Tally.Controls` with a dependency property and an `x:FieldModifier="public"` field; `Assets/tally.png`, the window's icon, is a `Resource`, in `Tally.g.resources` too. `net8.0-windows`, recorded as Windows 7.0, built on every OS (`EnableWindowsTargeting`). A GUI Fixture (below)                                                                                                                                                                                                                                                                                                                                      |

## Convention

```text
fixtures/
  Directory.Build.props     how every Fixture is built for testing
  <name>/                   one Fixture; <name> is lower-kebab-case
    <Name>.csproj           exactly one SDK-style project at the top
    *.cs                    its source
    inputs.json             console Fixtures: what to run it with, and what it does;
                            a GUI Fixture has none
```

- **One project per Fixture folder.** A folder directly under `fixtures/` holding
  exactly one `.csproj` is a Fixture, named after the folder. A Fixture that needs
  more projects (Sibling Assemblies) keeps them in subfolders and references them
  from that top-level project, leaving their sources out of its own
  (`<Compile Remove="Inventory/**" />`); it never references anything outside its
  folder. Their Assemblies are built beside the Fixture's, as `multi-assembly`'s
  are, so a Round-trip of it reconstructs them too.
- **The `.csproj` says what is under test.** Target framework, output type,
  nullable context, language version — anything a Reconstruction should recover —
  is set in the Fixture's own project. `Directory.Build.props` holds only how
  Fixtures are built for testing (warnings as errors, no native apphost, no
  warning that a target framework is out of support).
- **Deterministic.** A console Fixture's stdout, stderr and exit code depend only
  on its arguments: no clock, randomness, environment, file system or machine
  culture, and nothing whose result differs between OSes or CPUs. Keep output
  ASCII. Read operands from the arguments so the compiler cannot fold the code
  under test into constants.
- **`inputs.json`** lists the runs a Round-trip compares, each with what the
  Fixture compiled from source does:

  ```json
  [
    {
      "args": ["int", "7", "0"],
      "expected": {
        "stdout": ["7 + 0 = 7", "…"],
        "stderr": ["Cannot divide by zero."],
        "exitCode": 2
      }
    }
  ]
  ```

  `stdout` and `stderr` are lines without their line endings, so one file holds
  for every OS. Cover failures (bad input, exceptions, non-zero exit codes) as
  well as successes.

## Negative Fixtures

A negative Fixture is input Xray must refuse rather than reconstruct. One that
cannot be compiled from C# — `native`, a Native Executable — is committed
prebuilt, beside its source and a `README.md` giving the exact command that built
it. It has no `.csproj`, so `listFixtures` and `pnpm build:fixtures` skip it; tests
reach it through its path:

```ts
import { NATIVE_EXECUTABLE_FIXTURE } from "@xray/fixtures";
```

`.gitattributes` keeps `*.exe` and `*.dll` byte for byte on every OS.

A negative Fixture that is compiled from C#, such as `missing-reference` or
`cyclic-reference`, is built like any other but has no `inputs.json`: it is not
meant to pass a Round-trip.
`missing-reference` references its `Greetings/` library with `Private="false"`,
so `Greetings.dll` is not copied beside `MissingReference.dll`; reconstructed on
its own, it is an Assembly whose reference is not there, an Unresolved
Dependency, and `dotnet build` of its Recovered Solution fails with `CS0246` in
`MissingReference/Program.cs`.
`cyclic-reference`'s program references its `Plugin/` library, and `Plugin` is
built against `HostContract/`, a stand-in with the program's assembly name, which
is neither copied nor passed on to the program; so `Plugin.dll` references the
program's Assembly, which references it, and the build output holds two
Assemblies in a cycle, which run all the same.

`obfuscated` is built like any other Fixture, then obfuscated: a target in its
project (`Obfuscate`, after the build copies its output) runs
[Obfuscar](https://github.com/obfuscar/obfuscar)'s .NET tool, version 2.2.50,
which restore downloads (`PackageDownload`, so nothing references it) and which
runs on every OS, on the Assembly the compiler wrote into `obj/`, and puts what
it writes in its place in the build output. With its defaults, spelled out in
the configuration the target writes, Obfuscar renames every type, member and
parameter (to `A`, `a`, `B`…), and hides every string, each literal replaced by
a call that decodes it from an array of bytes. The map of what it renamed,
`Mapping.txt`, stays in `obj/`; and it is built without a PDB, which would
name what was renamed. Its `inputs.json` holds what the program does, run
obfuscated, which is what its source says, so its build is checked like any
other's; but a Round-trip is not expected of it.

## Libraries for other frameworks

`net35-library` and `netstandard20-library` each test a class library built for
a framework Xray supports only on a best-effort basis (PRD FR-8), which cannot
be run on its own. So each is a .NET 8 program with its library in a subfolder,
built beside it as a Sibling Assembly, as `multi-assembly`'s are: a Round-trip
reconstructs both, the library into a project for its own framework again,
rebuilds them, and runs the program, so the library's behaviour is compared on
every OS. .NET 8 loads an Assembly built for .NET Framework 2.0 to 4.8 that uses
only what .NET 8 has, so `Gradebook`, the `net35` library, runs on Linux and
macOS too; `net35-library`'s project turns off NuGet's warning that a .NET 8
project referencing a .NET Framework one may not be compatible (`NU1702`).
Core's tests reconstruct each library on its own, too, as an Assembly given
without the program that uses it.

## Resources

`resources` embeds every kind of resource a Reconstruction must recover (PRD
FR-12), and reads each back at runtime, so a Recovered Solution that lost,
renamed or changed any of them prints something else: its `manifest` command
lists the manifest resources of `Phrasebook.dll` and of each satellite
assembly, with their sizes. Its `.resx` files are the .NET SDK's defaults, each
an `EmbeddedResource` named after the root namespace and its folder
(`Phrasebook.Strings.resources`), a culture's (`Strings.fr.resx`) going to that
culture's satellite assembly. `Limits.resources` holds an `int` and a `bool` as
.NET's own `ResourceWriter` writes them, as a `.resources` file built from a
`.resx` by .NET Framework would: the .NET SDK builds a `.resx` holding anything
but strings, and `byte[]`s and streams read from files, only with
`System.Resources.Extensions`. Rather than commit it as a binary, the Fixture's
project writes it as it is built, with an inline task (`WriteLimits`) that runs
on every OS.

## The benchmark Fixture

`benchmark` is the Assembly a Reconstruction is timed on (PRD §8): one of
about 2,000 top-level types and 5 MB, `Ledgerworks.dll`. Its source is not
committed but generated as it is built, by an inline task in its project
(`GenerateModules`) whose code is `Generator/GenerateModules.cs`, into
`obj/`: 40 namespaces, `Ledgerworks.Module00` to `Module39`, of 40 files
each, one of eight kinds of type in turn, the interface and the enum each
with a class of its own beside it; a `Catalog` in each namespace; and
`Modules`, which `Program.cs` runs. Every type has the same rules too,
methods switching on strings and returning messages, as most of an
application's size is. Each type differs from the others of its kind only by
the constants its number gives it, so the same source is generated on every
build and every OS. The program computes every type from its argument, a
seed, and prints what each namespace's came to, so a Recovered Solution that
changed what any one of them does prints something else; its `inputs.json`
holds what it prints for three seeds, and the usage it prints otherwise. How
the benchmark times it is [`docs/reference/benchmark.md`](../docs/reference/benchmark.md).

## GUI Fixtures

A GUI Fixture is a WinForms or WPF app: a Fixture whose project's `OutputType`
is `WinExe` (`buildFixture` reports it as `outputType`, and `isGuiFixture`
says whether a built Fixture is one). It has no `inputs.json`; its Round-trip
rebuilds it on every OS and, on Windows, launches it (below). So that holds:

- **It builds on every OS.** One for .NET (`net8.0-windows`) sets
  `EnableWindowsTargeting`, which lets the .NET SDK build a Windows app on
  Linux and macOS; one for .NET Framework builds against its reference
  assemblies, as `net48-console` does.
- **It stays open until it is closed**, with no arguments and nothing on stdin,
  and never exits by itself.
- **What it shows is built as its designer builds it.** `winforms` and
  `net48-winforms` each have a form whose `InitializeComponent` reads its icon
  and an image from its `.resx`, so a Recovered Solution that lost or changed
  either fails as the form is built, and the app crashes. A `.resx` holding
  them builds, with `dotnet build`, only into a `.resources` file read by
  `System.Resources.Extensions`: .NET's Windows Desktop framework holds it, but
  a .NET Framework Fixture references its package. `wpf`'s window checks, as
  it loads, that `App.xaml`'s `Startup` handler ran and that a brush of the
  dictionary it merges is found, and its icon is a `Resource`, so a Recovered
  Solution that lost any of them crashes as the window is shown.
  `net48-wpf`'s window checks, as it loads, that its `DataContext` is its view
  model, that `App.xaml`'s converter is found, and that its preview's brush is
  bound through it to the colour, then shows its second window, whose XAML is
  loaded as it is built, as each saved swatch's `UserControl` is as its list
  is laid out; so a Recovered Solution that lost any of them crashes too.
- **It lets an exception crash it.** A WinForms Fixture calls
  `Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException)`
  before it shows a form, so an exception in an event handler ends it rather
  than showing WinForms' dialog, which would keep it alive. WPF ends an app on
  an exception it does not handle anyway.

## PDBs

Every Fixture but `obfuscated` is built with the PDB the .NET SDK writes beside
its Assembly (a portable one, unless its project asks otherwise, as
`debug-symbols` does), so a Round-trip reconstructs it with its local names and
source layout (FR-4).
`packages/core/src/reconstruct/reconstruct.engine.test.ts` also Round-trips
the ladder's Fixtures from a copy of their build output without the PDB, as an
Assembly is often given.

## Building Fixtures in tests

`@xray/fixtures` builds a Fixture by name and returns its Assembly:

```ts
import { buildFixture, readFixtureInputs, runAssembly } from "@xray/fixtures";

const { assemblyPath, targetFramework } = await buildFixture("arithmetic");
for (const { args, expected } of await readFixtureInputs("arithmetic")) {
  const { stdout, stderr, exitCode } = await runAssembly(assemblyPath, args, {
    targetFramework,
  });
}
```

A test that needs a Fixture's NuGet packages in the global-packages folder, as
one reconstructing `nuget-dependencies` offline does, restores them first, as a
cached build would not:

```ts
import { restoreFixture } from "@xray/fixtures";

await restoreFixture("nuget-dependencies");
```

`runAssembly` starts a program as `dotnet <assembly> <args…>`, on a later .NET
if the one it targets is not installed (`netcoreapp3.1` runs on .NET 8). A
.NET Framework program (`targetFramework` `net48`, say) is started as itself,
which only Windows can do: `runsOn(targetFramework)` says whether this OS can,
and elsewhere its inputs are skipped, though it is still built.

Builds run `dotnet build --configuration Release` into `fixtures/.cache/`, never
beside the source, and are cached between runs: a Fixture is rebuilt only when a
file in its folder, a shared build file here, or the .NET SDK version changes.
Concurrent test workers asking for the same Fixture share one build.

`pnpm build:fixtures` builds every Fixture (CI does this before `pnpm test`, so a
Fixture that does not compile fails on its own). Delete `fixtures/.cache/` to
start afresh.

## The Round-trip harness

`roundTrip` runs the Round-trip of a Fixture: it builds the Fixture, reconstructs
its Assembly, rebuilds the Recovered Solution with `dotnet build`, then runs the
original and the rebuilt program over every input in `inputs.json` and compares
their stdout, stderr and exit code (PRD §10). The Reconstruction is passed in,
so the harness does not depend on core. Core's tests pass in its own
(`packages/core/src/reconstruct/reconstruct.engine.test.ts`), which fails the
Round-trip unless it is a Full Reconstruction:

```ts
import { formatRoundTrip, roundTrip } from "@xray/fixtures";

const result = await roundTrip(
  "arithmetic",
  async (assemblyPath, outputDirectory) => {
    const reconstruction = await reconstruct(assemblyPath, outputDirectory);
    // …throw unless reconstruction.accepted and reconstruction.outcome === "full".
  },
);
expect(result.passed, formatRoundTrip(result)).toBe(true);
```

- **Where it runs.** A Round-trip runs both programs, so a .NET Framework
  Fixture's Round-trip runs only on Windows; elsewhere `roundTrip` rejects
  before reconstructing it. Core's tests still reconstruct and build it on
  every OS, and check the rebuilt Assembly targets the same framework.
- **A GUI Fixture** (above) is reconstructed and rebuilt on every OS, and fails
  its Round-trip there if its Recovered Solution does not rebuild. Then, on
  Windows only, its rebuilt app is launched (as `launchAssembly` launches an
  Assembly: by the `dotnet` host, or as itself for .NET Framework), and must
  still be running `aliveForMs` later (5 s unless given), when it is closed
  by being killed: nothing drives its window. If it exits, by crashing or by
  itself, before then, or cannot be started, the Round-trip fails. Its result
  holds this as `smokeTest`, and has no `runs`:

  ```text
  Round-trip of the window Fixture passed: the Recovered Solution rebuilt, and its app stayed alive for 5 s once launched, then was closed.
  ```

  ```text
  Round-trip of the window Fixture FAILED: the rebuilt app did not stay alive for 5 s: 1.4 s after it was launched, it crashed with 0xE0434352, as .NET ends a program that throws an unhandled exception.

  It wrote to stderr:
    Unhandled exception. System.InvalidOperationException: The window crashed.
       at Window.Program.Tick()
  ```

  On Linux and macOS, where WinForms and WPF do not run, the rebuild is the
  whole Round-trip, and it says so:

  ```text
  Round-trip of the window Fixture passed, build only: the Recovered Solution rebuilt, and its app was not launched, as a GUI Fixture is launched only on Windows, and this is linux.
  ```

- **The Reconstruction** gets the Fixture's Assembly and a folder that does not
  exist yet, and writes a Recovered Solution there with exactly one `.sln` at
  its top. The harness builds that `.sln` and runs the Assembly in its output
  that has the original's file name.
- **The result** says whether the Round-trip passed and, for each input, both
  runs and how they differ: each differing stdout or stderr line, the exit
  codes, or a rebuilt program that hung, was killed or could not start. A Reconstruction that throws
  or does not rebuild is a failed Round-trip, with the error or the compiler
  output. `formatRoundTrip` turns the result into a report. This one is for a
  Reconstruction made wrong on purpose (int subtraction adds; division by zero
  prints another message and exits 4), with two of its inputs left out:

  ```text
  Round-trip of the arithmetic Fixture FAILED: 5 of 17 inputs behaved differently.

  Given int 7 2:
    stdout line 2:
      original: "7 - 2 = 5"
      rebuilt:  "7 - 2 = 9"

  Given int -7 2:
    stdout line 2:
      original: "-7 - 2 = -9"
      rebuilt:  "-7 - 2 = -5"
  ...

  Given int 7 0:
    stderr line 1:
      original: "Cannot divide by zero."
      rebuilt:  "Division by zero."
    exit code: original 2, rebuilt 4
  ```

- **The work** happens in a temporary folder, deleted afterwards. Pass
  `workDirectory` to keep the Recovered Solution (`recovered/`) and its build
  output (`rebuilt/`) for a look.

## Adding a Fixture

1. Create `fixtures/<name>/<Name>.csproj` and its source.
2. For a console Fixture, add `inputs.json`; check every expectation by hand
   rather than pasting the program's output unread. A GUI Fixture has none, and
   follows [GUI Fixtures](#gui-fixtures).
3. `pnpm test` runs it against its inputs on every OS in CI.
