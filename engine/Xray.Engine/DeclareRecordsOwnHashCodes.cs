using System.Reflection.Metadata;
using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.CSharp.Transforms;
using ICSharpCode.Decompiler.TypeSystem;

namespace Xray.Engine;

/// <summary>
/// Declares again a record's own <c>GetHashCode() =&gt; 0</c>, such as one
/// that goes with an <c>Equals</c> of its own. The decompiler leaves out the
/// members the compiler writes for a record, and takes any
/// <c>GetHashCode</c> that returns 0 for one, as it would be for a record
/// struct with no fields; without it, the record hashes as the compiler
/// would have, so a <c>HashSet</c> of them keeps ones its <c>Equals</c> calls
/// equal. The compiler marks what it writes <c>[CompilerGenerated]</c>, which
/// tells the record's own apart.
/// </summary>
internal sealed class DeclareRecordsOwnHashCodes : IAstTransform
{
    public void Run(AstNode rootNode, TransformContext context)
    {
        foreach (var declaration in rootNode.Descendants.OfType<TypeDeclaration>().ToList())
        {
            if (declaration.ClassType is not (ClassType.RecordClass or ClassType.RecordStruct)
                || declaration.GetSymbol() is not ITypeDefinition record
                || record.Methods.FirstOrDefault(method => method is { Name: "GetHashCode", IsStatic: false, IsOverride: true, Parameters.Count: 0 }) is not { } getHashCode
                || getHashCode.HasAttribute(KnownAttribute.CompilerGenerated)
                || declaration.Members.Any(member => getHashCode.Equals(member.GetSymbol()))
                || !ReturnsZero(getHashCode))
            {
                continue;
            }

            var restored = (MethodDeclaration)context.TypeSystemAstBuilder.ConvertEntity(getHashCode);
            restored.Body = new BlockStatement { new ReturnStatement(new PrimitiveExpression(0)) };
            declaration.Members.Add(restored);
        }
    }

    /// <summary>
    /// Whether a method's IL is <c>return 0;</c>, as compiled for Release
    /// (<c>ldc.i4.0; ret</c>) or Debug (after <c>nop</c>s, through a local).
    /// </summary>
    private static bool ReturnsZero(IMethod method)
    {
        if (method.ParentModule?.MetadataFile is not { } module || method.MetadataToken.IsNil)
        {
            return false;
        }

        var definition = module.Metadata.GetMethodDefinition((MethodDefinitionHandle)method.MetadataToken);
        var il = module.GetMethodBody(definition.RelativeVirtualAddress).GetILBytes()?.SkipWhile(code => code == 0x00).ToArray();
        // ldc.i4.0; ret, or ldc.i4.0; stloc.0; br.s +0; ldloc.0; ret.
        return il is [0x16, 0x2A] or [0x16, 0x0A, 0x2B, 0x00, 0x06, 0x2A];
    }
}
