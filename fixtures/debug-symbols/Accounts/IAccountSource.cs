namespace Ledger.Banking;

/// <summary>
/// A type with no code of its own, alone in its file: only a portable PDB
/// records which file that was.
/// </summary>
public interface IAccountSource
{
    string Name { get; }

    IReadOnlyList<Transaction> History { get; }
}
