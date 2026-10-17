using System;
using Newtonsoft.Json;

namespace NuGetDependencies;

/// <summary>An order as its JSON names it, which is not as C# would.</summary>
[JsonObject(MemberSerialization.OptIn)]
internal sealed class Order
{
    [JsonProperty("id", Required = Required.Always)]
    public int Id { get; set; }

    [JsonProperty("items")]
    public string[] Items { get; set; } = [];

    [JsonProperty("placed")]
    public DateTime Placed { get; set; }

    [JsonProperty("gift", DefaultValueHandling = DefaultValueHandling.Ignore)]
    public bool Gift { get; set; }

    /// <summary>Not serialized: the class opts its members in.</summary>
    public string Summary => $"{Id}: {string.Join(", ", Items)}";
}
