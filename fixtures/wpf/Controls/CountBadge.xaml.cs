using System.Windows;
using System.Windows.Controls;

namespace Tally.Controls;

/// <summary>
/// Interaction logic for CountBadge.xaml
/// </summary>
public partial class CountBadge : UserControl
{
    public static readonly DependencyProperty CountProperty = DependencyProperty.Register(
        nameof(Count),
        typeof(int),
        typeof(CountBadge),
        new PropertyMetadata(0));

    public CountBadge()
    {
        InitializeComponent();
    }

    public int Count
    {
        get => (int)GetValue(CountProperty);
        set => SetValue(CountProperty, value);
    }
}
