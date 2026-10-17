using System.Windows;
using System.Windows.Input;

namespace Swatch;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    private void Chip_Click(object sender, RoutedEventArgs e)
    {
        label.Text = "Picked";
    }

    private void Chip_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
    }
}
