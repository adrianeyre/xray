using System;
using System.IO;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting;
using Serilog.Formatting.Display;

namespace NuGetDependencies;

/// <summary>
/// A Serilog sink of the Fixture's own, writing each event to stdout without
/// a timestamp or stack trace, so its output is the same from run to run.
/// </summary>
internal sealed class StdoutSink : ILogEventSink
{
    private readonly ITextFormatter formatter = new MessageTemplateTextFormatter(
        "[{Level:u3}] {Message:lj} {Properties}{NewLine}");

    public void Emit(LogEvent logEvent)
    {
        using var writer = new StringWriter();
        formatter.Format(logEvent, writer);
        Console.Out.Write(writer.ToString());
    }
}
