using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace Tally;

/// <summary>
/// Interaction logic for MainWindow.xaml
/// </summary>
public partial class MainWindow : Window
{
    private int step = 1;

    public MainWindow()
    {
        InitializeComponent();
    }

    private void Window_Loaded(object sender, RoutedEventArgs e)
    {
        // A GUI Fixture crashes, rather than shows a window, unless App.xaml's
        // Startup handler ran and the dictionary it merges was found.
        if (!App.Started)
        {
            throw new InvalidOperationException("App.xaml's Startup handler did not run.");
        }

        if (FindResource("AccentBrush") is not SolidColorBrush)
        {
            throw new InvalidOperationException("Themes/Palette.xaml's AccentBrush was not found.");
        }

        Title = $"Tally ({badge.countText.Text})";
    }

    private void IncrementButton_Click(object sender, RoutedEventArgs e)
    {
        badge.Count += step;
    }

    private void DecrementButton_Click(object sender, RoutedEventArgs e)
    {
        badge.Count -= step;
    }

    private void ResetButton_Click(object sender, RoutedEventArgs e)
    {
        badge.Count = 0;
    }

    private void StepBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        var valid = int.TryParse(stepBox.Text, out var parsed) && parsed > 0;
        if (valid)
        {
            step = parsed;
        }

        incrementButton.IsEnabled = valid;
        decrementButton.IsEnabled = valid;
    }

    private void StepButton_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        // A double click is two steps, not a gesture of its own.
        e.Handled = true;
    }
}
