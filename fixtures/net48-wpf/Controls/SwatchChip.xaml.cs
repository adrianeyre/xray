using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Swatches.Controls
{
    /// <summary>
    /// Interaction logic for SwatchChip.xaml
    /// </summary>
    public partial class SwatchChip : UserControl
    {
        public static readonly DependencyProperty ColorProperty = DependencyProperty.Register(
            nameof(Color),
            typeof(Color),
            typeof(SwatchChip),
            new PropertyMetadata(Colors.Transparent));

        public SwatchChip()
        {
            InitializeComponent();
        }

        public Color Color
        {
            get { return (Color)GetValue(ColorProperty); }
            set { SetValue(ColorProperty, value); }
        }
    }
}
