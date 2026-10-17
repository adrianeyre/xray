using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using Generics.Collections;
using Generics.Variance;

namespace Generics;

/// <summary>A word, ordered by its length alone.</summary>
public readonly struct Word : IComparable<Word>
{
    public Word(string text)
    {
        Text = text;
    }

    public string Text { get; }

    public int CompareTo(Word other) => Text.Length.CompareTo(other.Text.Length);

    public override string ToString() => Text;
}

/// <summary>
/// Puts its operands through generic types and methods and prints what they
/// did, and which types they did it with. Constraints and variance are read
/// back by reflection, so a Recovered Solution that dropped one would
/// describe itself differently, if it compiled at all.
/// </summary>
internal static class Program
{
    private const int Succeeded = 0;
    private const int InvalidInput = 1;
    private const int Failed = 2;

    private const string Usage =
        "Usage: Generics <stack|max|longest|pairs|sum|concat|format|variance|constraints|statics|defaults> [operands...]";

    private static int Main(string[] args)
    {
        // The output must not depend on the culture of the machine running it.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

        if (args.Length == 0)
        {
            Console.Error.WriteLine(Usage);
            return InvalidInput;
        }

        var operands = args[1..];
        try
        {
            switch (args[0])
            {
                case "stack":
                    Stack(operands);
                    break;
                case "max":
                    var numbers = Ints(operands);
                    Console.WriteLine($"max of {string.Join(", ", numbers)} is {Algorithms.Max(numbers[0], numbers[1..])}");
                    break;
                case "longest":
                    Longest(operands);
                    break;
                case "pairs":
                    Pairs(operands);
                    break;
                case "sum":
                    Sum(operands);
                    break;
                case "concat":
                    Concat(operands);
                    break;
                case "format":
                    Format(Ints(operands));
                    break;
                case "variance":
                    Variance();
                    break;
                case "constraints":
                    Constraints();
                    break;
                case "statics":
                    Statics();
                    break;
                case "defaults":
                    Defaults();
                    break;
                default:
                    Console.Error.WriteLine($"Unknown command \"{args[0]}\".");
                    Console.Error.WriteLine(Usage);
                    return InvalidInput;
            }
        }
        catch (FormatException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return InvalidInput;
        }
        catch (InvalidOperationException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return Failed;
        }

        return Succeeded;
    }

    /// <summary>A type's name with its type arguments, e.g. Pair&lt;String, Int32&gt;.</summary>
    internal static string TypeName(Type type)
    {
        if (!type.IsGenericType)
        {
            return type.Name;
        }

        var name = type.Name;
        var tick = name.IndexOf('`');
        var arguments = type.GetGenericArguments();
        var names = new string[arguments.Length];
        for (var i = 0; i < arguments.Length; i++)
        {
            names[i] = TypeName(arguments[i]);
        }

        return $"{(tick < 0 ? name : name.Substring(0, tick))}<{string.Join(", ", names)}>";
    }

    private static void Stack(string[] items)
    {
        var stack = new ArrayStack<string>();
        foreach (var item in items)
        {
            stack.Push(item);
        }

        // Through IEnumerable<string>, then through the struct enumerator.
        Console.WriteLine($"{stack.Count} pushed, top first: [{string.Join(", ", stack)}]");
        var characters = 0;
        foreach (var item in stack)
        {
            characters += item.Length;
        }

        Console.WriteLine($"{characters} characters in all");
        var lengths = stack.ConvertAll(Length);
        Console.WriteLine($"{TypeName(lengths.GetType())} of lengths, top first: [{string.Join(", ", lengths)}]");
        Console.WriteLine($"popped {stack.Pop()}, leaving {Algorithms.TopOrNull(stack) ?? "nothing"} on top");
    }

    private static int Length(string text) => text.Length;

    private static void Longest(string[] words)
    {
        if (words.Length == 0)
        {
            throw new FormatException("Give at least one word.");
        }

        var wrapped = new Word[words.Length];
        for (var i = 0; i < words.Length; i++)
        {
            wrapped[i] = new Word(words[i]);
        }

        Console.WriteLine($"the longest is {Algorithms.Max(wrapped[0], wrapped[1..])}");
    }

    private static void Pairs(string[] operands)
    {
        if (operands.Length != 2)
        {
            throw new FormatException("Usage: Generics pairs <first> <second>");
        }

        var first = operands[0];
        var second = operands[1];
        Algorithms.Swap(ref first, ref second);
        Console.WriteLine($"swapped: {first} {second}");

        var pair = Pair.Of(first, second.Length);
        Console.WriteLine($"{TypeName(pair.GetType())} {pair}");
        var swapped = pair.Swap();
        Console.WriteLine($"{TypeName(swapped.GetType())} {swapped}");
        var with = pair.With(second.Length > first.Length);
        Console.WriteLine($"{TypeName(with.GetType())} {with}");
        var nested = Pair.Of(pair, swapped);
        Console.WriteLine($"{TypeName(nested.GetType())} {nested}");
    }

    /// <summary>The operands summed as each numeric type they all parse as.</summary>
    private static void Sum(string[] operands)
    {
        Console.WriteLine($"int: {SumAs<int>(operands)}");
        Console.WriteLine($"long: {SumAs<long>(operands)}");
        Console.WriteLine($"double: {SumAs<double>(operands)}");
        Console.WriteLine($"decimal: {SumAs<decimal>(operands)}");
    }

    private static string SumAs<T>(string[] operands)
        where T : System.Numerics.INumber<T>
    {
        var values = new T[operands.Length];
        for (var i = 0; i < operands.Length; i++)
        {
            if (!T.TryParse(operands[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
            {
                return $"\"{operands[i]}\" is not a valid {typeof(T).Name}";
            }

            values[i] = value;
        }

        return Monoid.Sum(values).ToString() ?? "";
    }

    private static void Concat(string[] words)
    {
        var texts = new Text[words.Length];
        var maxima = new Maximum[words.Length];
        for (var i = 0; i < words.Length; i++)
        {
            texts[i] = new Text(words[i]);
            maxima[i] = new Maximum(words[i].Length);
        }

        Console.WriteLine($"concatenated: {Monoid.Concat(texts)}");
        Console.WriteLine($"longest length: {Monoid.Concat(maxima)}");
    }

    private static void Format(int[] numbers)
    {
        Formatter[] formatters = [new HexFormatter(), new FixedFormatter()];
        foreach (var formatter in formatters)
        {
            foreach (var number in numbers)
            {
                Console.WriteLine($"{formatter.GetType().Name}: {formatter.Format(number)}, then {formatter.Format(number * 1000L)}");
            }
        }
    }

    private static void Variance()
    {
        IProducer<string> strings = new Constant<string>("hello");
        IProducer<object> objects = strings;
        Console.WriteLine($"a producer of strings, as a producer of objects, produces {objects.Produce()}");

        IConsumer<object> anything = new Describer<object>();
        IConsumer<string> forStrings = anything;
        Console.WriteLine($"a consumer of objects, as a consumer of strings: {forStrings.Consume("text")}");

        Transform<object, string> describe = Bracket;
        Transform<string, object> narrowed = describe;
        Console.WriteLine($"a Transform<Object, String> as a Transform<String, Object> gives {narrowed("x")}");

        object constant = new Constant<string>("boxed");
        object describer = new Describer<object>();
        object list = new List<string> { "x", "y" };
        Console.WriteLine($"a Constant<String> is an IProducer<Object>: {constant is IProducer<object>}, an IBox<String>: {constant is IBox<string>}, an IBox<Object>: {constant is IBox<object>}");
        Console.WriteLine($"a Describer<Object> is an IConsumer<String>: {describer is IConsumer<string>}; a Describer<String> is an IConsumer<Object>: {(object)new Describer<string>() is IConsumer<object>}");
        Console.WriteLine($"a Describer<String> as an IConsumer<Object> consumes {((object)new Describer<string>() as IConsumer<object>)?.Consume("x") ?? "nothing"}");
        Console.WriteLine($"a List<String> is an IEnumerable<Object>: {list is IEnumerable<object>}, an IReadOnlyList<Object>: {list is IReadOnlyList<object>}, an IList<Object>: {list is IList<object>}");

        object[] array = new string[] { "a", "b" };
        try
        {
            array[0] = 1;
            Console.WriteLine("stored an int in a string[]");
        }
        catch (ArrayTypeMismatchException exception)
        {
            Console.WriteLine($"storing an int in a string[] seen as an object[] throws {exception.GetType().Name}");
        }
    }

    private static string Bracket(object value) => $"<{value}>";

    /// <summary>Every generic parameter of the Fixture's generic types and methods: its variance and constraints.</summary>
    private static void Constraints()
    {
        Type[] types =
        [
            typeof(ArrayStack<>),
            typeof(Pair<,>),
            typeof(IProducer<>),
            typeof(IConsumer<>),
            typeof(Transform<,>),
            typeof(IBox<>),
            typeof(IMonoid<>),
            typeof(Registry<>),
        ];
        foreach (var type in types)
        {
            Console.WriteLine($"{TypeName(type)}: {Parameters(type.GetGenericArguments())}");
        }

        var methods = new List<MethodInfo>();
        foreach (var type in new[] { typeof(Algorithms), typeof(Monoid), typeof(Formatter), typeof(HexFormatter) })
        {
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                if (method.IsGenericMethodDefinition)
                {
                    methods.Add(method);
                }
            }
        }

        methods.Sort(ByName);
        foreach (var method in methods)
        {
            var parameters = method.GetGenericArguments();
            var names = new string[parameters.Length];
            for (var i = 0; i < parameters.Length; i++)
            {
                names[i] = parameters[i].Name;
            }

            Console.WriteLine($"{method.DeclaringType?.Name}.{method.Name}<{string.Join(", ", names)}>: {Parameters(parameters)}");
        }
    }

    private static int ByName(MethodInfo left, MethodInfo right) =>
        string.CompareOrdinal($"{left.DeclaringType?.Name}.{left.Name}", $"{right.DeclaringType?.Name}.{right.Name}");

    private static string Parameters(Type[] parameters)
    {
        var described = new string[parameters.Length];
        for (var i = 0; i < parameters.Length; i++)
        {
            described[i] = Parameter(parameters[i]);
        }

        return string.Join("; ", described);
    }

    private static string Parameter(Type parameter)
    {
        var parts = new List<string>();
        var attributes = parameter.GenericParameterAttributes;
        if ((attributes & GenericParameterAttributes.Covariant) != 0)
        {
            parts.Add("out");
        }

        if ((attributes & GenericParameterAttributes.Contravariant) != 0)
        {
            parts.Add("in");
        }

        if ((attributes & GenericParameterAttributes.ReferenceTypeConstraint) != 0)
        {
            parts.Add("class");
        }

        if ((attributes & GenericParameterAttributes.NotNullableValueTypeConstraint) != 0)
        {
            parts.Add("struct");
        }

        if ((attributes & GenericParameterAttributes.DefaultConstructorConstraint) != 0)
        {
            parts.Add("new()");
        }

        foreach (var attribute in parameter.GetCustomAttributesData())
        {
            if (attribute.AttributeType.Name == "IsUnmanagedAttribute")
            {
                parts.Add("unmanaged");
            }
        }

        var constraints = parameter.GetGenericParameterConstraints();
        var names = new string[constraints.Length];
        for (var i = 0; i < constraints.Length; i++)
        {
            names[i] = TypeName(constraints[i]);
        }

        Array.Sort(names, StringComparer.Ordinal);
        parts.AddRange(names);
        return parts.Count == 0 ? parameter.Name : $"{parameter.Name} ({string.Join(", ", parts)})";
    }

    private static void Statics()
    {
        Console.WriteLine($"{Registry<int>.Name}: {Registry<int>.Register()}");
        Console.WriteLine($"{Registry<int>.Name}: {Registry<int>.Register()}");
        Console.WriteLine($"{Registry<string>.Name}: {Registry<string>.Register()}");
        Console.WriteLine($"{Registry<List<int>>.Name}: {Registry<List<int>>.Register()}");
        Console.WriteLine($"{Registry<int>.Name}: {Registry<int>.Register()}");
        Console.WriteLine(new Outer<int>.Inner<string>().Describe(1, "one"));
        Console.WriteLine(new Outer<string>.Inner<int>().Describe("two", 2));
    }

    private static void Defaults()
    {
        Console.WriteLine(Algorithms.Describe(default(int)));
        Console.WriteLine(Algorithms.Describe(default(string)));
        Console.WriteLine(Algorithms.Describe(default(int?)));
        Console.WriteLine(Algorithms.Describe(default(Pair<int, string>)));
        Console.WriteLine(Algorithms.Describe(Algorithms.OrDefault<int>(null)));
        Console.WriteLine(Algorithms.Describe(Algorithms.OrDefault<int>(5)));
        Console.WriteLine(Algorithms.Describe(Algorithms.Upcast<string, object>("up")));
        Console.WriteLine($"default(Tally) is {default(Tally)}, Make<Tally>() is {Algorithms.Make<Tally>()}, Make<List<int>>() has {Algorithms.Make<List<int>>().Count} items");
        Console.WriteLine($"sizes: int {Algorithms.SizeOf<int>()}, long {Algorithms.SizeOf<long>()}, char {Algorithms.SizeOf<char>()}, decimal {Algorithms.SizeOf<decimal>()}, Pair<Byte, Int32> {Algorithms.SizeOf<Pair<byte, int>>()}");
        Console.WriteLine($"{Algorithms.NameOf(DayOfWeek.Friday)}, {Algorithms.NameOf((DayOfWeek)9)}");
    }

    private static int[] Ints(string[] operands)
    {
        if (operands.Length == 0)
        {
            throw new FormatException("Give at least one int.");
        }

        var numbers = new int[operands.Length];
        for (var i = 0; i < operands.Length; i++)
        {
            numbers[i] = int.TryParse(operands[i], NumberStyles.Integer, CultureInfo.InvariantCulture, out int value)
                ? value
                : throw new FormatException($"\"{operands[i]}\" is not an int.");
        }

        return numbers;
    }
}
