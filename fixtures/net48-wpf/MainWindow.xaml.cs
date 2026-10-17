using System;
using System.Windows;
using System.Windows.Media;

namespace Swatches
{
    /// <summary>
    /// Interaction logic for MainWindow.xaml
    /// </summary>
    public partial class MainWindow : Window
    {
        public MainWindow()
        {
            InitializeComponent();
        }

        private void Window_Loaded(object sender, RoutedEventArgs e)
        {
            // A GUI Fixture crashes, rather than shows its windows, unless its
            // view model, the converter App.xaml declares and the binding
            // through it were recovered.
            var mixer = DataContext as MixerViewModel;
            if (mixer == null)
            {
                throw new InvalidOperationException("MainWindow's DataContext is not a MixerViewModel.");
            }

            if (!(FindResource("ColorToBrush") is ColorToBrushConverter))
            {
                throw new InvalidOperationException("App.xaml's ColorToBrush converter was not found.");
            }

            var brush = preview.Background as SolidColorBrush;
            if (brush == null || brush.Color != mixer.Color)
            {
                throw new InvalidOperationException("The preview's Background is not bound to the colour being mixed.");
            }

            var window = new PreviewWindow { Owner = this, DataContext = mixer };
            window.Show();
        }
    }
}
