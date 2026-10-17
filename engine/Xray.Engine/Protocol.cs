namespace Xray.Engine;

/// <summary>
/// The wire contract shared with <c>packages/core</c>. Bump <see cref="Version"/>
/// whenever a command is added or a request or response changes shape; the
/// handshake refuses a client that speaks a different version.
/// </summary>
internal static class Protocol
{
    public const int Version = 11;

    /// <summary>Error codes the engine reports in a response's <c>error.code</c>.</summary>
    public static class ErrorCodes
    {
        /// <summary>The line was not a JSON object with a numeric <c>id</c> and a string <c>command</c>.</summary>
        public const string InvalidRequest = "invalid-request";

        /// <summary>The client asked for a protocol version this engine does not speak.</summary>
        public const string ProtocolMismatch = "protocol-mismatch";

        /// <summary>A command other than <c>handshake</c> arrived before a successful handshake.</summary>
        public const string HandshakeRequired = "handshake-required";

        /// <summary>The command name is not one this engine knows.</summary>
        public const string UnknownCommand = "unknown-command";

        /// <summary>The command's <c>params</c> are missing something it needs, or have the wrong type.</summary>
        public const string InvalidParams = "invalid-params";

        /// <summary>Nothing exists at the path a command was given.</summary>
        public const string FileNotFound = "file-not-found";

        /// <summary>The path a command was given is a folder, not a file.</summary>
        public const string NotAFile = "not-a-file";

        /// <summary>The file a command was given exists but could not be read.</summary>
        public const string FileUnreadable = "file-unreadable";

        /// <summary>The file a command was given has no CLI header, so it has no .NET metadata to read.</summary>
        public const string NotAManagedAssembly = "not-a-managed-assembly";

        /// <summary>The file has a CLI header, but its metadata is corrupt or holds no assembly manifest.</summary>
        public const string InvalidMetadata = "invalid-metadata";

        /// <summary>The decompiler failed on a type, or on the assembly's attributes.</summary>
        public const string DecompilationFailed = "decompilation-failed";

        /// <summary>The command failed unexpectedly inside the engine.</summary>
        public const string InternalError = "internal-error";
    }
}
