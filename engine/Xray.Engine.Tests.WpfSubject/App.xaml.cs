using System.Windows;

namespace Swatch;

public partial class App : Application
{
    internal static int Starts { get; private set; }

    private void App_Startup(object sender, StartupEventArgs e)
    {
        Starts++;
    }

    private void App_Exit(object sender, ExitEventArgs e)
    {
        Starts--;
    }
}
