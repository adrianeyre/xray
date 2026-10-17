using ICSharpCode.Decompiler.CSharp;

namespace Xray.Engine.Tests;

public sealed class WpfXamlTests
{
    /// <summary>The WPF app of Xray.Engine.Tests.WpfSubject, built beside the tests.</summary>
    internal static readonly string Subject = Path.Combine(AppContext.BaseDirectory, "WpfSubject", "Swatch.dll");

    internal static readonly string SubjectPdb = Path.ChangeExtension(Subject, ".pdb");

    private static readonly Lazy<DecompiledAssembly> Decompiled =
        new(() => AssemblyDecompiler.Decompile(Subject, LanguageVersion.CSharp12_0, referenceDirectories: WindowsDesktopReferences()));

    private static readonly Lazy<DecompiledAssembly> DecompiledWithPdb =
        new(() => AssemblyDecompiler.Decompile(Subject, LanguageVersion.CSharp12_0, pdbPath: SubjectPdb, referenceDirectories: WindowsDesktopReferences()));

    /// <summary>
    /// Where WPF's reference assemblies are, which the BAML decompiler needs to
    /// tell the types and properties BAML names: none on Windows, which has
    /// them; elsewhere, the Windows Desktop framework's targeting pack, which
    /// building the subject restored into the global-packages folder.
    /// </summary>
    internal static IReadOnlyList<string> WindowsDesktopReferences()
    {
        if (OperatingSystem.IsWindows())
        {
            return [];
        }

        var packages = Environment.GetEnvironmentVariable("NUGET_PACKAGES") is { Length: > 0 } configured
            ? configured
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".nuget", "packages");
        var versions = Directory.GetDirectories(Path.Combine(packages, "microsoft.windowsdesktop.app.ref"), "8.0.*");
        return [Path.Combine(versions.OrderBy(version => Version.Parse(Path.GetFileName(version))).Last(), "ref", "net8.0")];
    }

    private static DecompiledXaml Document(string entry) =>
        Assert.Single(Decompiled.Value.Xaml!.Documents, document => document.Entry == entry);

    private static string Code(string name) =>
        Assert.Single(Decompiled.Value.Types, type => type.Namespace == "Swatch" && type.Name == name).Code;

    [Fact]
    public void DecompilesEachBamlDocumentOfTheWpfResourcesToXaml()
    {
        var xaml = Decompiled.Value.Xaml;

        Assert.NotNull(xaml);
        Assert.Equal("Swatch.g.resources", xaml.Resource);
        Assert.Null(xaml.NotDecompiled);
        Assert.Equal(["app.baml", "mainwindow.baml"], xaml.Documents.Select(document => document.Entry).Order());
        Assert.Equal("Swatch.App", Document("app.baml").Class);
        Assert.Equal("Swatch.MainWindow", Document("mainwindow.baml").Class);
        Assert.StartsWith("<Window x:Class=\"Swatch.MainWindow\"", Document("mainwindow.baml").Code);
        Assert.EndsWith("</Window>\n", Document("mainwindow.baml").Code);
        Assert.DoesNotContain("\r", Document("mainwindow.baml").Code);
        Assert.DoesNotContain("<?xml", Document("mainwindow.baml").Code);
    }

    [Fact]
    public void TellsTheApplicationDefinitionWhoseMainTheMarkupCompilerGenerated()
    {
        Assert.True(Document("app.baml").ApplicationDefinition);
        Assert.False(Document("mainwindow.baml").ApplicationDefinition);
    }

    [Fact]
    public void RecoversTheAppsEventsAndStartupUriWhichItsInitializeComponentSets()
    {
        var app = Document("app.baml").Code;

        Assert.Contains("StartupUri=\"MainWindow.xaml\"", app);
        Assert.Contains("Startup=\"App_Startup\"", app);
        Assert.Contains("Exit=\"App_Exit\"", app);
        Assert.Contains("<SolidColorBrush x:Key=\"Ink\" Color=\"Navy\" />", app);
    }

    [Fact]
    public void NamesElementsAndHooksTheirEventsAndStylesEventSettersAsTheXamlDid()
    {
        var window = Document("mainwindow.baml").Code;

        Assert.Contains("Name=\"label\"", window);
        Assert.Contains("Name=\"chip\"", window);
        Assert.Contains("Click=\"Chip_Click\"", window);
        Assert.Contains("<EventSetter Event=\"MouseDoubleClick\" Handler=\"Chip_MouseDoubleClick\" />", window);
        Assert.Contains("Style=\"{StaticResource Chip}\"", window);
        Assert.DoesNotContain("Unknown connection ID", window);
    }

    [Fact]
    public void NamesMscorlibForACoreTypeRatherThanTheRuntimesOwnLibrary()
    {
        var window = Document("mainwindow.baml").Code;

        // Declared once, by the prefix the XAML gave it.
        Assert.Contains("<sys:Double x:Key=\"Size\">24</sys:Double>", window);
        Assert.Single(window.Split("\"clr-namespace:System;assembly=mscorlib\"").Skip(1));
        Assert.DoesNotContain("System.Private.CoreLib", window);
    }

    [Fact]
    public void WritesXClassFirstThenTheNamespaceDeclarationsThenTheRest()
    {
        Assert.StartsWith(
            "<Window x:Class=\"Swatch.MainWindow\" xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" xmlns:x=\"http://schemas.microsoft.com/winfx/2006/xaml\" xmlns:sys=\"clr-namespace:System;assembly=mscorlib\"",
            Document("mainwindow.baml").Code);
    }

    [Fact]
    public void LeavesOutOfTheCodeBehindWhatTheMarkupCompilerGeneratesAgain()
    {
        var window = Code("MainWindow");
        var app = Code("App");

        Assert.Contains("public partial class MainWindow : Window\n", window);
        Assert.Contains("\t\tInitializeComponent();\n", window);
        Assert.Contains("private void Chip_Click(object sender, RoutedEventArgs e)", window);
        Assert.Contains("public partial class App : Application\n", app);
        Assert.Contains("private void App_Startup(object sender, StartupEventArgs e)", app);
        foreach (var generated in new[] { "void InitializeComponent()", "Connect(", "_contentLoaded", "_CreateDelegate", "IComponentConnector", "IStyleConnector", "TextBlock label", "Button chip", "GeneratedCode", "System.Windows.Markup" })
        {
            Assert.DoesNotContain(generated, window);
            Assert.DoesNotContain(generated, app);
        }

        Assert.DoesNotContain("Main(", app);
    }

    [Fact]
    public void PlacesTheCodeBehindInItsOwnFileRatherThanTheOneTheMarkupCompilerGenerated()
    {
        var types = DecompiledWithPdb.Value.Types;

        Assert.Equal("MainWindow.xaml.cs", Path.GetFileName(Assert.Single(types, type => type.Name == "MainWindow").SourcePath));
        Assert.Equal("App.xaml.cs", Path.GetFileName(Assert.Single(types, type => type.Name == "App").SourcePath));
    }

    [Fact]
    public void FindsNoXamlInAnAssemblyWithoutWpfResources()
    {
        Assert.Null(AssemblyDecompiler.Decompile(PeClassifierTests.ManagedAssembly, LanguageVersion.CSharp12_0).Xaml);
    }
}
