namespace Xray.Engine;

/// <summary>
/// Reads newline-delimited JSON requests until end of input, answering each
/// with one newline-delimited JSON response, preceded by any progress lines the
/// command sends while it runs. End of input is the client's request to shut
/// down, so the host then returns exit code 0.
/// </summary>
internal static class EngineHost
{
    public static async Task<int> RunAsync(TextReader input, TextWriter output, CancellationToken cancellationToken)
    {
        // Flushed at once, so the client sees progress while the command runs.
        var session = new Session(progress =>
        {
            output.Write(progress + "\n");
            output.Flush();
        });
        while (await input.ReadLineAsync(cancellationToken) is { } line)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            // "\n" rather than WriteLine, whose Environment.NewLine is "\r\n" on Windows.
            await output.WriteAsync(session.Handle(line) + "\n");
            await output.FlushAsync(cancellationToken);
        }

        return 0;
    }
}
