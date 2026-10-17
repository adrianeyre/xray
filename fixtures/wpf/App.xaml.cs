using System.Windows;

namespace Tally;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
    /// <summary>Whether the Startup handler App.xaml names has run, which the window checks.</summary>
    internal static bool Started { get; private set; }

    private void App_Startup(object sender, StartupEventArgs e)
    {
        Started = true;
    }
}
