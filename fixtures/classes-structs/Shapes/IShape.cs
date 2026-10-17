namespace ClassesStructs.Shapes;

public interface IShape
{
    string Name { get; }

    double Area { get; }

    double Perimeter { get; }

    /// <summary>A default implementation, which a class may keep or replace.</summary>
    string Describe() => $"{Name}: area {Area:0.###}, perimeter {Perimeter:0.###}";
}

public interface IScalable
{
    IShape Scale(double factor);
}
