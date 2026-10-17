using System.Reflection.Metadata;
using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.CSharp.Transforms;
using ICSharpCode.Decompiler.TypeSystem;

namespace Xray.Engine;

/// <summary>
/// Leaves out of a WPF class's code-behind the interfaces through which the
/// BAML of its XAML hooks its elements' fields and events,
/// <c>IComponentConnector</c> and <c>IStyleConnector</c>, as Visual Studio's
/// code-behind leaves them: the markup compiler declares them on the half of
/// the class it generates, with the <c>Connect</c> methods that implement them,
/// which the decompiled half leaves out (see <see cref="WpfXamlReader"/>). Were
/// it to declare one the markup compiler no longer implements, it would not
/// compile.
/// </summary>
internal sealed class LeaveConnectorsToMarkupCompiler(IEnumerable<TypeDefinitionHandle> classes) : IAstTransform
{
    private static readonly string[] Connectors = ["System.Windows.Markup.IComponentConnector", "System.Windows.Markup.IStyleConnector"];

    private readonly HashSet<TypeDefinitionHandle> classes = [.. classes];

    public void Run(AstNode rootNode, TransformContext context)
    {
        foreach (var declaration in rootNode.Descendants.OfType<TypeDeclaration>())
        {
            if (declaration.GetSymbol() is not ITypeDefinition { MetadataToken: { IsNil: false } token }
                || !classes.Contains((TypeDefinitionHandle)token))
            {
                continue;
            }

            foreach (var baseType in declaration.BaseTypes.ToList())
            {
                if (baseType.GetSymbol() is IType { FullName: var name } && Connectors.Contains(name))
                {
                    baseType.Remove();
                }
            }
        }
    }
}
