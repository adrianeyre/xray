namespace Greeter;

internal static class Program
{
    /// <summary>The main entry point for the application, as the template writes it.</summary>
    [STAThread]
    private static void Main()
    {
        // A GUI Fixture lets an exception crash it, rather than show a dialog.
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
