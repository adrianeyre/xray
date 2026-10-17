using System.Windows.Media;

namespace Swatches
{
    /// <summary>A colour saved under a name.</summary>
    public class Swatch
    {
        public Swatch(string name, Color color)
        {
            Name = name;
            Color = color;
        }

        public string Name { get; private set; }

        public Color Color { get; private set; }
    }
}
