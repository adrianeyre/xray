using System.Text;
using Xray.Engine;

var utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
using var input = new StreamReader(Console.OpenStandardInput(), utf8);
using var output = new StreamWriter(Console.OpenStandardOutput(), utf8);

// stdout carries the protocol and nothing else. Point Console.Out at stderr so a
// stray Console.WriteLine (ours or a library's) is logged instead of corrupting it.
Console.SetOut(Console.Error);

return await EngineHost.RunAsync(input, output, CancellationToken.None);
