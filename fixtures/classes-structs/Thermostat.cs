using System;

namespace ClassesStructs;

public sealed class TemperatureChangedEventArgs : EventArgs
{
    public TemperatureChangedEventArgs(int from, int to)
    {
        From = from;
        To = to;
    }

    public int From { get; }

    public int To { get; }
}

/// <summary>Raises an event on each change, and an alarm, with accessors of its own, when too hot.</summary>
public sealed class Thermostat
{
    public const int Limit = 30;

    private int temperature = 20;
    private Action<string>? alarm;

    public event EventHandler<TemperatureChangedEventArgs>? Changed;

    public event Action<string> Alarm
    {
        add
        {
            alarm += value;
            Console.WriteLine("  alarm armed");
        }

        remove
        {
            alarm -= value;
            Console.WriteLine("  alarm disarmed");
        }
    }

    public int Temperature
    {
        get => temperature;
        set
        {
            if (value == temperature)
            {
                return;
            }

            var from = temperature;
            temperature = value;
            Changed?.Invoke(this, new TemperatureChangedEventArgs(from, value));
            if (value > Limit)
            {
                alarm?.Invoke($"too hot at {value}");
            }
        }
    }
}
