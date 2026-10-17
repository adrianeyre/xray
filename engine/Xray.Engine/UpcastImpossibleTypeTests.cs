using ICSharpCode.Decompiler.CSharp;
using ICSharpCode.Decompiler.CSharp.Resolver;
using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.CSharp.Transforms;
using ICSharpCode.Decompiler.Semantics;
using ICSharpCode.Decompiler.TypeSystem;

namespace Xray.Engine;

/// <summary>
/// Puts back the upcast to <c>object</c> that a type test needs where C# can
/// tell the test is impossible: <c>(object)new Sealed() is IUnrelated</c>,
/// which IL records only as <c>isinst IUnrelated</c>, since the upcast is no
/// instruction. The decompiler writes it as <c>new Sealed() is IUnrelated</c>,
/// which C# refuses (CS0184; CS0039 for <c>as</c>). Upcasting to object never
/// changes what a type test does, so the cast is added wherever C# has no
/// explicit conversion from the operand's type to the tested type.
/// </summary>
internal sealed class UpcastImpossibleTypeTests : IAstTransform
{
    public void Run(AstNode rootNode, TransformContext context)
    {
        var conversions = CSharpConversions.Get(context.TypeSystem);
        var objectType = context.TypeSystem.FindType(KnownTypeCode.Object);
        foreach (var node in rootNode.Descendants.ToList())
        {
            (Expression? operand, IType? testedType) = node switch
            {
                IsExpression test when test.GetResolveResult() is TypeIsResolveResult result => (test.Expression, result.TargetType),
                AsExpression test => (test.Expression, test.GetResolveResult().Type),
                _ => (null, null),
            };
            var operandType = operand?.GetResolveResult().Type;
            if (operand is null
                || testedType is null
                || operandType is null
                || operandType.Kind is TypeKind.Unknown or TypeKind.Null
                || testedType.Kind == TypeKind.Unknown
                || operandType.IsKnownType(KnownTypeCode.Object)
                || conversions.ExplicitConversion(operandType, testedType).IsValid)
            {
                continue;
            }

            var upcast = new CastExpression(context.TypeSystemAstBuilder.ConvertType(objectType), operand.Detach());
            upcast.AddAnnotation(new ConversionResolveResult(
                objectType,
                operand.GetResolveResult(),
                operandType.IsReferenceType == false ? Conversion.BoxingConversion : Conversion.ImplicitReferenceConversion));
            switch (node)
            {
                case IsExpression test:
                    test.Expression = upcast;
                    break;
                case AsExpression test:
                    test.Expression = upcast;
                    break;
            }
        }
    }
}
